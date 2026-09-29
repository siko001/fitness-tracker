import { encode, decode, enqueue, validSnapshot, parsePairing } from '../shared/protocol';

let pending = [], active = false, retry;
const storage = () => settings.settingsStorage;
function status(text) { storage().setItem('status', text); }
function persist() { storage().setItem('pending', JSON.stringify(pending)); }
function ack(snapshot) { messaging.peerSocket.send(encode({ v: 1, type: 'ack', date: snapshot.date, at: snapshot.at })); }
async function upload(options) {
  let timeout;
  try {
    // Zepp fetch can remain pending after a phone network change. Release the
    // upload lock so persisted readings can retry; late results cannot clear it.
    return await Promise.race([fetch(options), new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error('Upload timed out')), 25000);
    })]);
  } finally { clearTimeout(timeout); }
}
async function flush() {
  if (active || !pending.length) return;
  active = true;
  try {
    const config = parsePairing(storage().getItem('pairing'));
    while (pending.length) {
      const snapshot = pending[0];
      if (Date.now() - snapshot.at > 32 * 86400000) { pending.shift(); persist(); continue; }
      const response = await upload({ url: config.url + '/rest/v1/rpc/ingest_zepp_steps', method: 'POST',
        headers: { apikey: config.key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ pairing_token: config.token, watch_date: snapshot.date, step_count: snapshot.steps,
          captured_at: new Date(snapshot.at).toISOString(), utc_offset_minutes: snapshot.offset }) });
      const body = typeof response.body === 'string' ? JSON.parse(response.body) : response.body;
      if (!body || body.ok !== true) throw new Error('Upload rejected');
      // Keep a newer snapshot that arrived while the request was running.
      pending = pending.filter(s => !(s.date === snapshot.date && s.at <= snapshot.at)); persist();
      status('Server received ' + snapshot.steps + ' steps. Captured ' + new Date(snapshot.at).toISOString());
      try { ack(snapshot); } catch (_) { /* watch retries; server is idempotent */ }
    }
  } catch (_) { status('Waiting to upload. Check pairing, Bluetooth and internet; queued readings will retry.'); }
  finally { active = false; }
}
function message(buffer) {
  try { const snapshot = decode(buffer); if (!validSnapshot(snapshot)) return; storage().setItem('lastWatchContact', new Date().toISOString()); pending = enqueue(pending, snapshot); persist(); console.log('Steady: received watch reading'); void flush(); }
  catch (_) { /* ignore malformed BLE packet */ }
}
function changed(event) { if (event.key === 'pairing') void flush(); }
AppSideService({
  onInit() {
    console.log('Steady: phone relay started 0.1.3');
    try { const saved = JSON.parse(storage().getItem('pending')); pending = Array.isArray(saved) ? saved.filter(validSnapshot).slice(-32) : []; } catch (_) {}
    messaging.peerSocket.addListener('message', message);
    storage().addListener('change', changed);
    // Phone-side timers are allowed; the watch service exclusively uses Time events.
    retry = setInterval(() => void flush(), 60000); void flush();
  },
  onRun() { void flush(); },
  onDestroy() { clearInterval(retry); persist(); storage().removeListener('change', changed); messaging.peerSocket.removeListener('message', message); },
});
