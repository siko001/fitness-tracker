import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as protocol from '../../zepp/steady/shared/protocol.js';
import * as transport from '../../zepp/steady/shared/transport.js';
const sample = { v: 1, type: 'steps', date: '2026-09-29', steps: 801, at: Date.parse('2026-09-29T06:00:00Z'), offset: 120 };
test('small BLE packets round trip with Zepp routing header', () => {
  const encoded = protocol.encode(sample); assert.ok(encoded.byteLength < 256);
  const frame = transport.frame(4, 123, 77, encoded);
  const received = transport.unframe(frame, frame.byteLength, 123);
  assert.deepEqual(protocol.decode(received.payload), sample); assert.equal(received.port, 77);
  assert.equal(transport.unframe(frame, 2, 123), null);
  assert.equal(transport.unframe(frame, frame.byteLength, 456), null);
});
test('queues coalesce a day and acknowledgements cannot erase newer readings', () => {
  let q = protocol.enqueue([], sample);
  q = protocol.enqueue(q, { ...sample, at: sample.at + 1000, steps: 810 });
  q = protocol.enqueue(q, sample);
  assert.equal(q[0].steps, 810);
  assert.equal(protocol.acknowledge(q, { v: 1, type: 'ack', date: sample.date, at: sample.at }).length, 1);
  q = protocol.enqueue(q, { ...sample, date: '2026-09-30', at: sample.at + 86400000, steps: 0 });
  assert.equal(q.length, 2);
  assert.equal(protocol.acknowledge(q, { v: 1, type: 'ack', date: sample.date, at: sample.at + 1000 }).length, 1);
});
test('pairing rejects insecure endpoints and malformed credentials', () => {
  const config = { version: 1, url: 'https://abcdefghijklmnopqrst.supabase.co', key: 'public', token: 'a'.repeat(64) };
  assert.deepEqual(protocol.parsePairing(JSON.stringify(config)), config);
  assert.throws(() => protocol.parsePairing(JSON.stringify({ ...config, url: 'http://example.com' })));
  assert.throws(() => protocol.parsePairing(JSON.stringify({ ...config, token: 'short' })));
});
test('watch sends changed totals on the next minute, keeps quiet totals at 15 minutes, retries and handles rollover without timers', () => {
  let service, minute, changed, receive, reconnect, now = sample.at, steps = 801;
  let connected = true, sent = [], writes = 0, activePort = 77;
  const date = () => new Date(now + 120 * 60000);
  class Time {
    getTime() { return now; } getFullYear() { return date().getUTCFullYear(); } getMonth() { return date().getUTCMonth() + 1; }
    getDate() { return date().getUTCDate(); } getHours() { return date().getUTCHours(); } getMinutes() { return date().getUTCMinutes(); } getSeconds() { return date().getUTCSeconds(); }
    onPerMinute(fn) { minute = fn; } offPerMinute() {}
  }
  class Step { getCurrent() { return steps; } onChange(fn) { changed = fn; } offChange() {} }
  const code = readFileSync(new URL('../../zepp/steady/app-service/steps.js', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '');
  vm.runInNewContext(code, { ...protocol, ...transport, Time, Step, AppService: s => { service = s; },
    log: { getLogger: () => ({ log() {} }) },
    getPackageInfo: () => ({ appId: 123 }), createConnect: fn => { receive = fn; }, disConnect() {},
    addListener: fn => { reconnect = fn; }, removeListener() {}, connectStatus: () => connected,
    send: buf => { sent.push(transport.unframe(buf, buf.byteLength, 123)); },
    readFileSync() { throw Error('No file yet'); }, writeFileSync() { writes++; }, renameSync: () => 0,
  });
  const incoming = (type, payload) => { const buf = transport.frame(type, 123, activePort, payload); receive(0, buf, buf.byteLength); };
  const confirm = (type = 4) => { const s = protocol.decode(sent.at(-1).payload); incoming(type, protocol.encode({ v: 1, type: 'ack', date: s.date, at: s.at })); };
  service.onInit(); assert.equal(sent[0].type, 1); // runtime handshake
  incoming(1); assert.equal(protocol.decode(sent.at(-1).payload).steps, 801); confirm();
  sent = [];
  // Zepp restarts its Side Service while Bluetooth stays connected. Never reuse
  // its old port forever: the next batch must negotiate the replacement route.
  activePort = 88;
  steps += 3; changed(); assert.equal(sent.length, 0);
  now += 60000; minute(); assert.equal(sent.at(-1).type, 1); assert.equal(sent.at(-1).port, 0);
  incoming(1); assert.equal(sent.at(-1).port, 88); assert.equal(protocol.decode(sent.at(-1).payload).steps, 804); confirm(5); sent = [];
  for (let i = 0; i < 14; i++) { now += 60000; minute(); }
  assert.equal(sent.length, 0); now += 60000; minute(); assert.equal(sent.length, 1);
  incoming(1); const beforeRetry = sent.length;
  now += 60000; minute(); assert.equal(sent.length, beforeRetry + 1); assert.equal(sent.at(-1).type, 1); // no acknowledgement, reopen route
  incoming(1);
  confirm(); sent = []; connected = false; reconnect(false);
  now = Date.parse('2026-09-29T21:59:00Z'); steps = 1000; changed(); minute();
  now += 60000; steps = 0; changed(); minute();
  connected = true; reconnect(true); incoming(1);
  assert.equal(protocol.decode(sent.at(-1).payload).date, '2026-09-29'); confirm();
  assert.equal(protocol.decode(sent.at(-1).payload).date, '2026-09-30');
  assert.equal(protocol.decode(sent.at(-1).payload).steps, 0); confirm();
  assert.ok(writes > 0); service.onDestroy();
});

test('phone relay releases a stalled fetch, retries queued steps and ignores late results', async () => {
  const values = new Map([['pairing', JSON.stringify({ version: 1, url: 'https://abcdefghijklmnopqrst.supabase.co', key: 'public', token: 'a'.repeat(64) })]]);
  let service, message, retry, deadline, oldResolve, calls = 0;
  const sent = [];
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), addListener() {}, removeListener() {} };
  const code = readFileSync(new URL('../../zepp/steady/app-side/index.js', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '');
  vm.runInNewContext(code, { ...protocol, AppSideService: s => { service = s; }, settings: { settingsStorage: storage },
    console: { log() {} }, Date: class extends Date { static now() { return sample.at + 60000; } },
    messaging: { peerSocket: { addListener: (_event, fn) => { message = fn; }, removeListener() {}, send: data => sent.push(protocol.decode(data)) } },
    setInterval: fn => { retry = fn; return 1; }, clearInterval() {},
    setTimeout: fn => { deadline = fn; return 2; }, clearTimeout() {},
    fetch: () => { calls++; return calls === 1 ? new Promise(resolve => { oldResolve = resolve; }) : Promise.resolve({ body: { ok: true } }); },
  });
  const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
  service.onInit(); message(protocol.encode(sample)); await settle();
  assert.equal(calls, 1); assert.equal(sent.length, 0);
  deadline(); await settle();
  assert.equal(JSON.parse(values.get('pending')).length, 1);
  assert.match(values.get('status'), /Waiting to upload/);
  retry(); await settle(); assert.equal(calls, 2); assert.equal(sent.length, 1);
  assert.equal(JSON.parse(values.get('pending')).length, 0);
  oldResolve({ body: { ok: true } }); await settle(); assert.equal(sent.length, 1);
  assert.ok(values.get('lastWatchContact')); service.onDestroy();
});

test('Bip Max page renders centred controls without device-information permission', () => {
  const code = readFileSync(new URL('../../zepp/steady/page/index.js', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '');
  for (const granted of [false, true]) {
    const width = 390, height = 450;
    let page; const widgets = [];
    // The native runtime rejects undeclared device-info access before the first
    // widget. Simulate that permission boundary, including first-install state.
    vm.runInNewContext(code, { Page: p => { page = p; }, getDeviceInfo: () => { throw Error('Device-information permission denied'); },
      createWidget: (_kind, options) => { widgets.push(options); return { setProperty() {} }; }, widget: {}, prop: {}, align: {},
      Step: class { getCurrent() { return 100; } onChange() {} offChange() {} },
      getAllAppServices: () => granted ? ['app-service/steps'] : [], queryPermission: () => [granted ? 2 : 0],
      readFileSync() { throw Error('No diagnostic file'); },
    });
    page.build();
    assert.equal(widgets.length, 5);
    assert.ok(widgets.some(w => w.text === 'Start sync')); assert.ok(widgets.some(w => w.text === 'Stop sync'));
    for (const w of widgets) { assert.ok(Math.abs(w.x + w.w / 2 - width / 2) <= 0.5); assert.ok(w.x >= 0 && w.x + w.w <= width); assert.ok(w.y >= 0 && w.y + w.h <= height); }
    page.onDestroy();
  }
});
