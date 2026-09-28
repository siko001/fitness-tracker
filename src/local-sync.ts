import { stateSchema, type State } from './model';
import { initialState, loadState, mutateState, readMetadata, writeMetadata } from './storage';
import { mergeStates, type ConflictChoice } from './merge';

export type LocalConnection = { url: string; key: string };
export function validateLocalUrl(value: string) {
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Enter a server origin, such as http://localhost:4173, without a path.');
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Use HTTPS for a server on your home network. Localhost also works over USB; see the setup guide.');
  return url.origin;
}
export async function saveLocalConnection(value: LocalConnection) {
  const config = { url: validateLocalUrl(value.url), key: value.key.trim() };
  if (config.key.length < 24) throw new Error('Enter the pairing key printed by your local server.');
  await request(config); // Verify before saving or enabling sync.
  await writeMetadata('localConnection', config);
}
async function request(config: LocalConnection, payload?: unknown) {
  const response = await fetch(`${config.url}/api/diary`, { method: payload ? 'POST' : 'GET', headers: { Authorization: `Bearer ${config.key}`, ...(payload ? { 'Content-Type': 'application/json' } : {}) }, body: payload ? JSON.stringify(payload) : undefined, signal: AbortSignal.timeout(15000) });
  if (response.status === 409) return null;
  if (response.status === 401) throw new Error('The local pairing key is incorrect.');
  if (!response.ok) throw new Error('Could not sync with your local server. Check that it is running and reachable.');
  return response.json();
}
let active: Promise<State> | null = null;
export async function syncLocal(choice?: ConflictChoice) {
  if (active) return active;
  active = performSync(choice).finally(() => { active = null; }); return active;
}
async function performSync(choice?: ConflictChoice) {
  const config = await readMetadata<LocalConnection>('localConnection');
  if (!config) throw new Error('Connect your local server in Settings first.');
  const metadata = await readMetadata<{ server: string; base: State; syncedAt: string }>('localSync');
  const base = metadata?.server === config.url ? metadata.base : initialState();
  for (let attempt = 0; attempt < 3; attempt++) {
    const remote = await request(config);
    const remoteState = remote.payload ? stateSchema.parse(remote.payload) : initialState();
    const local = await loadState();
    const merged = mergeStates(base, local, remoteState, choice);
    if (JSON.stringify(merged) === JSON.stringify(remoteState) && remote.revision > 0) {
      const result = await mutateState(current => mergeStates(local, current, merged), { key: 'localSync', value: { server: config.url, base: merged, syncedAt: new Date().toISOString() } });
      return result;
    }
    const uploaded = await request(config, { expectedRevision: remote.revision, payload: merged });
    if (!uploaded) continue;
    const result = await mutateState(current => mergeStates(local, current, merged), { key: 'localSync', value: { server: config.url, base: merged, syncedAt: new Date().toISOString() } });
    return result;
  }
  throw new Error('Another device is syncing. Try again in a moment.');
}
