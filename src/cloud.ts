import { createClient } from '@supabase/supabase-js';
import { stateSchema, type State } from './model';
import { initialState, loadState, mutateState, readMetadata } from './storage';
import { mergeStates, type ConflictChoice } from './merge';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const cloud = url && key ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } }) : null;
export type SyncMetadata = { userId: string; base: State; syncedAt: string };
let active: Promise<State> | null = null;
export async function syncCloud(choice?: ConflictChoice): Promise<State> {
  if (active) return active;
  active = performSync(choice).finally(() => { active = null; }); return active;
}
async function performSync(choice?: ConflictChoice): Promise<State> {
  if (!cloud) throw new Error('Cloud sync is not configured yet. Your records are saved on this device.');
  const { data: { session } } = await cloud.auth.getSession();
  if (!session) throw new Error('Sign in to sync your devices.');
  const userId = session.user.id;
  const metadata = await readMetadata<SyncMetadata>('sync');
  if (metadata && metadata.userId !== userId) throw new Error('This device has data from a different account. Export a backup and clear local data before switching accounts.');
  const base = metadata?.base ?? initialState();
  // The local diary and its merge baseline are committed in one IndexedDB transaction.
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await cloud.from('diaries').select('revision,payload').eq('user_id', userId).maybeSingle();
    if (error) throw new Error('Could not reach your cloud diary. Check your connection and cloud setup. Local changes are safe.');
    const remote = data ? stateSchema.parse(data.payload) : initialState();
    const local = await loadState();
    const merged = mergeStates(base, local, remote, choice);
    if (JSON.stringify(merged) === JSON.stringify(remote)) {
      const result = await mutateState(current => mergeStates(local, current, merged), { key: 'sync', value: { userId, base: merged, syncedAt: new Date().toISOString() } satisfies SyncMetadata });
      return result;
    }
    const { data: revision, error: uploadError } = await cloud.rpc('save_diary', { expected_revision: data?.revision ?? 0, next_payload: merged });
    if (uploadError) throw new Error('Cloud sync failed. Your local records are safe. Check your connection or sign in again.');
    if (revision === null) continue; // Another device won the revision race; re-read and merge.
    const now = new Date().toISOString();
    // Preserve edits made while the network request was in flight.
    const result = await mutateState(current => mergeStates(local, current, merged), { key: 'sync', value: { userId, base: merged, syncedAt: now } satisfies SyncMetadata });
    return result;
  }
  throw new Error('Your other device is syncing too. Wait a moment and try again.');
}
