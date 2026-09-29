// Deliberately small ASCII packets; one snapshot per BLE frame (< 256 bytes).
export function encode(value) {
  const text = JSON.stringify(value);
  if (text.length > 256) throw new Error('Packet too large');
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  return bytes.buffer;
}
export function decode(buffer, size) {
  const bytes = new Uint8Array(buffer);
  const length = size === undefined ? bytes.length : Math.min(size, bytes.length);
  if (length > 256) throw new Error('Packet too large');
  let text = '';
  for (let i = 0; i < length; i++) text += String.fromCharCode(bytes[i]);
  return JSON.parse(text);
}
export function validSnapshot(s) {
  return !!s && s.v === 1 && s.type === 'steps' && /^\d{4}-\d{2}-\d{2}$/.test(s.date)
    && Number.isInteger(s.steps) && s.steps >= 0 && s.steps <= 500000
    && Number.isSafeInteger(s.at) && s.at > 0 && Number.isInteger(s.offset) && Math.abs(s.offset) <= 840;
}
export function enqueue(queue, snapshot) {
  if (!validSnapshot(snapshot)) return queue;
  const old = queue.find(s => s.date === snapshot.date);
  if (old && old.at >= snapshot.at) return queue;
  return queue.filter(s => s.date !== snapshot.date).concat([snapshot]).sort((a, b) => a.at - b.at).slice(-32);
}
export function acknowledge(queue, ack) {
  if (!ack || ack.v !== 1 || ack.type !== 'ack') return queue;
  return queue.filter(s => !(s.date === ack.date && s.at <= ack.at));
}
export function parsePairing(raw) {
  const config = JSON.parse(raw);
  if (config.version !== 1 || !/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(config.url)
    || typeof config.key !== 'string' || !/^[0-9a-f]{64}$/.test(config.token)) throw new Error('Invalid pairing');
  return config;
}
