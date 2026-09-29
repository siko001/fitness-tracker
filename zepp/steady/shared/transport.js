// Zepp's 16-byte device-side BLE envelope. The phone runtime handles this header
// before delivering the payload to peerSocket; see the official MessageBuilder sample.
// No promise timeouts/global timers: those are unavailable inside AppService.
export function frame(type, appId, port, payload = new Uint8Array([appId & 255]).buffer) {
  const bytes = new Uint8Array(16 + payload.byteLength), header = new DataView(bytes.buffer);
  header.setUint8(0, 1); header.setUint8(1, 1); header.setUint16(2, type, true);
  header.setUint16(4, 20, true); header.setUint16(6, port, true); header.setUint32(8, appId, true);
  bytes.set(new Uint8Array(payload), 16); return bytes.buffer;
}
export function unframe(buffer, size, appId) {
  if (size < 16 || buffer.byteLength < size || size > 272) return null;
  const header = new DataView(buffer);
  if (header.getUint8(0) !== 1 || header.getUint8(1) !== 1 || header.getUint32(8, true) !== appId) return null;
  return { type: header.getUint16(2, true), port: header.getUint16(6, true), payload: buffer.slice(16, size) };
}
