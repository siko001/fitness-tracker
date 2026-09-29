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
test('watch service runs without timers, retries lost delivery, keeps day boundaries and schedules at 15 minutes', () => {
  let service, minute, changed, receive, reconnect, now = sample.at, steps = 801;
  let connected = true, sent = [], writes = 0;
  const date = () => new Date(now + 120 * 60000);
  class Time {
    getTime() { return now; } getFullYear() { return date().getUTCFullYear(); } getMonth() { return date().getUTCMonth() + 1; }
    getDate() { return date().getUTCDate(); } getHours() { return date().getUTCHours(); } getMinutes() { return date().getUTCMinutes(); } getSeconds() { return date().getUTCSeconds(); }
    onPerMinute(fn) { minute = fn; } offPerMinute() {}
  }
  class Step { getCurrent() { return steps; } onChange(fn) { changed = fn; } offChange() {} }
  const code = readFileSync(new URL('../../zepp/steady/app-service/steps.js', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '');
  vm.runInNewContext(code, { ...protocol, ...transport, Time, Step, AppService: s => { service = s; },
    getPackageInfo: () => ({ appId: 123 }), createConnect: fn => { receive = fn; }, disConnect() {},
    addListener: fn => { reconnect = fn; }, removeListener() {}, connectStatus: () => connected,
    send: buf => { sent.push(transport.unframe(buf, buf.byteLength, 123)); },
    readFileSync() { throw Error('No file yet'); }, writeFileSync() { writes++; }, renameSync: () => 0,
  });
  const incoming = (type, payload) => { const buf = transport.frame(type, 123, 77, payload); receive(0, buf, buf.byteLength); };
  const confirm = () => { const s = protocol.decode(sent.at(-1).payload); incoming(4, protocol.encode({ v: 1, type: 'ack', date: s.date, at: s.at })); };
  service.onInit(); assert.equal(sent[0].type, 1); // runtime handshake
  incoming(1); assert.equal(protocol.decode(sent.at(-1).payload).steps, 801); confirm();
  sent = [];
  for (let i = 0; i < 14; i++) { now += 60000; steps++; changed(); minute(); }
  assert.equal(sent.length, 0); now += 60000; minute(); assert.equal(sent.length, 1);
  now += 60000; minute(); assert.equal(sent.length, 2); // no acknowledgement
  confirm(); sent = []; connected = false; reconnect(false);
  now = Date.parse('2026-09-29T21:59:00Z'); steps = 1000; changed(); minute();
  now += 60000; steps = 0; changed(); minute();
  connected = true; reconnect(true); incoming(1);
  assert.equal(protocol.decode(sent.at(-1).payload).date, '2026-09-29'); confirm();
  assert.equal(protocol.decode(sent.at(-1).payload).date, '2026-09-30');
  assert.equal(protocol.decode(sent.at(-1).payload).steps, 0); confirm();
  assert.ok(writes > 0); service.onDestroy();
});
