import { Step, Time } from '@zos/sensor';
import { createConnect, disConnect, send, addListener, removeListener, connectStatus } from '@zos/ble';
import { readFileSync, writeFileSync, renameSync } from '@zos/fs';
import { encode, decode, enqueue, acknowledge, validSnapshot } from '../shared/protocol';
import { frame, unframe } from '../shared/transport';
import { getPackageInfo } from '@zos/app';
import { log } from '@zos/utils';

const step = new Step(), time = new Time();
let queue = [], dirty = false, lastAttempt = 0, lastScheduled = 0, awaitingDelivery = false, port = 0;
let scheduledDate = '', scheduledSteps = -1;
const appId = getPackageInfo().appId;
const logger = log.getLogger('steady-relay');
let lastTick = 0, lastDelivered = 0, phase = 'Starting';
function capture() {
  // Read date before AND after the counter to avoid labeling yesterday's steps as today.
  const date = `${time.getFullYear()}-${String(time.getMonth()).padStart(2, '0')}-${String(time.getDate()).padStart(2, '0')}`;
  const steps = step.getCurrent(), at = time.getTime();
  const again = `${time.getFullYear()}-${String(time.getMonth()).padStart(2, '0')}-${String(time.getDate()).padStart(2, '0')}`;
  if (date !== again) return;
  const local = Date.UTC(time.getFullYear(), time.getMonth() - 1, time.getDate(), time.getHours(), time.getMinutes(), time.getSeconds());
  const offset = Math.round((local - at) / 60000);
  const snapshot = { v: 1, type: 'steps', date, steps, at, offset };
  if (!validSnapshot(snapshot)) return;
  queue = enqueue(queue.filter(s => at - s.at < 32 * 86400000), snapshot); dirty = true;
  return snapshot;
}
function persist() {
  if (!dirty) return;
  // Zepp only permits service writes with the screen off/AOD. Failures keep the
  // in-memory queue dirty for the next minute; never discard an unacknowledged day.
  try {
    writeFileSync({ path: 'pending.tmp', data: JSON.stringify(queue), options: { encoding: 'utf8' } });
    if (renameSync({ oldPath: 'pending.tmp', newPath: 'pending.json' }) !== 0) return;
    writeFileSync({ path: 'relay-status.tmp', data: JSON.stringify({ lastTick, lastDelivered, phase }), options: { encoding: 'utf8' } });
    if (renameSync({ oldPath: 'relay-status.tmp', newPath: 'relay-status.json' }) === 0) dirty = false;
  } catch (_) { /* retry when the screen is off */ }
}
function transmit() {
  if (!queue.length) { awaitingDelivery = false; return; }
  if (!connectStatus()) { phase = 'Phone disconnected'; dirty = true; return; }
  const buffer = port ? frame(4, appId, port, encode(queue[0])) : frame(1, appId, 0);
  phase = port ? 'Waiting for delivery' : 'Connecting to Zepp'; dirty = true;
  lastAttempt = time.getTime();
  try { send(buffer, buffer.byteLength); } catch (_) { logger.log('Send failed; will reconnect'); port = 0; }
}
function receive(_index, buffer, size) {
  try {
    const packet = unframe(buffer, size, appId);
    if (!packet) return;
    if (packet.type === 1) { port = packet.port; if (port) { logger.log('Zepp connected'); transmit(); } return; }
    if (packet.type === 2) { port = 0; awaitingDelivery = true; return; }
    if ((packet.type !== 4 && packet.type !== 5) || packet.port !== port) return;
    const ack = decode(packet.payload), next = acknowledge(queue, ack);
    if (ack.v === 1 && ack.type === 'ack' && typeof ack.at === 'number') {
      lastDelivered = time.getTime(); phase = 'Delivered'; dirty = true; logger.log('Server confirmed delivery');
    }
    if (next.length !== queue.length) { queue = next; transmit(); }
    persist();
  } catch (_) { /* unrelated/malformed packet */ }
}
function minute() {
  const now = time.getTime();
  lastTick = now; dirty = true; logger.log('Background minute');
  // Keep each day's last observed counter, even while phone/Internet is offline.
  const snapshot = capture(); persist();
  if (!snapshot) return;
  if (snapshot.date !== scheduledDate || snapshot.steps !== scheduledSteps || now - lastScheduled >= 15 * 60000 || now < lastScheduled) schedule(snapshot);
  else if (awaitingDelivery && now - lastAttempt >= 60000) { port = 0; transmit(); }
  persist();
}
function schedule(snapshot) {
  if (!snapshot) return;
  lastScheduled = time.getTime(); scheduledDate = snapshot.date; scheduledSteps = snapshot.steps;
  // A continuous watch service outlives the Zepp Side Service's routing session.
  // Re-establish it for every batch/retry, even when Bluetooth never disconnected.
  port = 0; awaitingDelivery = true; transmit();
}
function reconnect(connected) { port = 0; if (connected) schedule(capture()); }
function changed() { capture(); }
AppService({
  onInit() {
    logger.log('Background service started 0.1.3');
    try { const saved = JSON.parse(readFileSync({ path: 'pending.json', options: { encoding: 'utf8' } })); queue = Array.isArray(saved) ? saved.filter(validSnapshot).slice(-32) : []; } catch (_) {}
    createConnect(receive); addListener(reconnect);
    time.onPerMinute(minute); step.onChange(changed);
    schedule(capture());
  },
  onDestroy() { logger.log('Background service stopped'); persist(); step.offChange(changed); time.offPerMinute(minute); removeListener(); disConnect(); },
});
