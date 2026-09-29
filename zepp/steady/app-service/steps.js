import { Step, Time } from '@zos/sensor';
import { createConnect, disConnect, send, addListener, removeListener, connectStatus } from '@zos/ble';
import { readFileSync, writeFileSync, renameSync } from '@zos/fs';
import { encode, decode, enqueue, acknowledge, validSnapshot } from '../shared/protocol';
import { frame, unframe } from '../shared/transport';
import { getPackageInfo } from '@zos/app';

const step = new Step(), time = new Time();
let queue = [], dirty = false, lastAttempt = 0, lastScheduled = 0, awaitingDelivery = false, port = 0;
const appId = getPackageInfo().appId;
function capture() {
  // Read date before AND after the counter to avoid labeling yesterday's steps as today.
  const date = `${time.getFullYear()}-${String(time.getMonth()).padStart(2, '0')}-${String(time.getDate()).padStart(2, '0')}`;
  const steps = step.getCurrent(), at = time.getTime();
  const again = `${time.getFullYear()}-${String(time.getMonth()).padStart(2, '0')}-${String(time.getDate()).padStart(2, '0')}`;
  if (date !== again) return;
  const local = Date.UTC(time.getFullYear(), time.getMonth() - 1, time.getDate(), time.getHours(), time.getMinutes(), time.getSeconds());
  const offset = Math.round((local - at) / 60000);
  queue = enqueue(queue.filter(s => at - s.at < 32 * 86400000), { v: 1, type: 'steps', date, steps, at, offset }); dirty = true;
}
function persist() {
  if (!dirty) return;
  // Zepp only permits service writes with the screen off/AOD. Failures keep the
  // in-memory queue dirty for the next minute; never discard an unacknowledged day.
  try {
    writeFileSync({ path: 'pending.tmp', data: JSON.stringify(queue), options: { encoding: 'utf8' } });
    if (renameSync({ oldPath: 'pending.tmp', newPath: 'pending.json' }) === 0) dirty = false;
  } catch (_) { /* retry when the screen is off */ }
}
function transmit() {
  if (!queue.length) { awaitingDelivery = false; return; }
  if (!connectStatus()) return;
  const buffer = port ? frame(4, appId, port, encode(queue[0])) : frame(1, appId, 0);
  lastAttempt = time.getTime();
  try { send(buffer, buffer.byteLength); } catch (_) { /* retry on the next minute */ }
}
function receive(_index, buffer, size) {
  try {
    const packet = unframe(buffer, size, appId);
    if (!packet) return;
    if (packet.type === 1) { port = packet.port; if (port) transmit(); return; }
    if (packet.type !== 4 || packet.port !== port) return;
    const ack = decode(packet.payload), next = acknowledge(queue, ack);
    if (next.length !== queue.length) { queue = next; dirty = true; persist(); transmit(); }
  } catch (_) { /* unrelated/malformed packet */ }
}
function minute() {
  const now = time.getTime();
  // Keep each day's last observed counter, even while phone/Internet is offline.
  capture(); persist();
  if (now - lastScheduled >= 15 * 60000 || now < lastScheduled) { lastScheduled = now; awaitingDelivery = true; transmit(); }
  else if (awaitingDelivery && now - lastAttempt >= 60000) transmit();
}
function reconnect(connected) { port = 0; if (connected) { capture(); awaitingDelivery = true; transmit(); } }
function changed() { capture(); }
AppService({
  onInit() {
    try { const saved = JSON.parse(readFileSync({ path: 'pending.json', options: { encoding: 'utf8' } })); queue = Array.isArray(saved) ? saved.filter(validSnapshot).slice(-32) : []; } catch (_) {}
    createConnect(receive); addListener(reconnect);
    time.onPerMinute(minute); step.onChange(changed);
    capture(); lastScheduled = time.getTime(); awaitingDelivery = true; transmit();
  },
  onDestroy() { persist(); step.offChange(changed); time.offPerMinute(minute); removeListener(); disConnect(); },
});
