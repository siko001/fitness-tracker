import { Capacitor, registerPlugin } from '@capacitor/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import { activitySchema, type Activity, type State } from './model';
import { loadState, mutateState, readMetadata } from './storage';
import type { LocalConnection } from './local-sync';

export type BackgroundStatus = { available: boolean; granted: boolean; enabled: boolean; lastChecked: string; lastUploaded: string; message: string };
type Snapshot = { records?: unknown[]; lastChecked?: string; session?: { url: string; userId: string; accessToken: string; refreshToken: string; expiresAt: number } };
const native = registerPlugin<{
  status(): Promise<BackgroundStatus>; enable(): Promise<void>; disable(): Promise<void>; clear(): Promise<void>;
  configure(options: { config: Record<string, unknown> }): Promise<void>; snapshot(): Promise<Snapshot>;
  authGet(options: { key: string }): Promise<{ value: string | null }>;
  authSet(options: { key: string; value: string }): Promise<void>; authRemove(options: { key: string }): Promise<void>;
}>('SteadyBackgroundHealth');
export const hasAndroidBackground = Capacitor.getPlatform() === 'android';
// Share the session with the worker so refreshes made while the webview is closed
// are visible before Supabase initializes. Migrate the existing login once.
export const nativeAuthStorage = hasAndroidBackground ? {
  async getItem(key: string) { const { value } = await native.authGet({ key }); if (value !== null) return value; const legacy = localStorage.getItem(key); if (legacy !== null) { await native.authSet({ key, value: legacy }); localStorage.removeItem(key); } return legacy; },
  async setItem(key: string, value: string) { await native.authSet({ key, value }); localStorage.removeItem(key); },
  async removeItem(key: string) { await native.authRemove({ key }); localStorage.removeItem(key); },
} : undefined;
export const backgroundStatus = () => hasAndroidBackground ? native.status() : Promise.resolve(null);
export const disableBackground = () => hasAndroidBackground ? native.disable() : Promise.resolve();
export const clearBackground = () => hasAndroidBackground ? native.clear() : Promise.resolve();
export async function configureBackground(client: SupabaseClient | null) {
  if (!hasAndroidBackground) return;
  const mode = await readMetadata<string>('syncMode');
  let config: Record<string, unknown> = { mode: 'off' };
  if (mode === 'cloud' && client) {
    const { data: { session } } = await client.auth.getSession();
    const owner = await readMetadata<{ userId: string }>('sync');
    if (session && owner && owner.userId !== session.user.id) {
      await native.configure({ config });
      throw new Error('This diary belongs to another account. Export it and clear local data before switching accounts.');
    }
    if (session) config = { mode, url: import.meta.env.VITE_SUPABASE_URL, key: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      userId: session.user.id, accessToken: session.access_token, refreshToken: session.refresh_token, expiresAt: session.expires_at ?? 0 };
  } else if (mode === 'local') {
    const local = await readMetadata<LocalConnection>('localConnection');
    if (local) config = { mode, ...local };
  }
  await native.configure({ config });
}
export async function enableBackground(client: SupabaseClient | null) {
  await configureBackground(client); await native.enable();
}
let adopting: Promise<void> | undefined;
export function adoptBackgroundSession(client: SupabaseClient) {
  if (!hasAndroidBackground) return Promise.resolve();
  return adopting ??= (async () => {
    const snapshot = await native.snapshot(), stored = snapshot.session;
    const { data: { session } } = await client.auth.getSession();
    if (stored && session && stored.url === import.meta.env.VITE_SUPABASE_URL && stored.userId === session.user.id && stored.expiresAt > (session.expires_at ?? 0)) {
      const { error } = await client.auth.setSession({ access_token: stored.accessToken, refresh_token: stored.refreshToken });
      if (error) throw new Error('Sign in again on your phone to resume sync.');
    }
  })().finally(() => { adopting = undefined; });
}
export function mergeHealthRecords(state: State, records: Activity[], checked?: string): State {
  const byDate = new Map(records.map(r => [r.date, r]));
  for (const old of state.activities.filter(a => a.source === 'health')) {
    const fresh = byDate.get(old.date);
    if (!fresh || Date.parse(old.updatedAt) > Date.parse(fresh.updatedAt)) byDate.set(old.date, old);
    else byDate.set(old.date, { ...fresh, steps: fresh.steps ?? (fresh.stepSource === old.stepSource ? old.steps : null), activeKcal: fresh.activeKcal ?? old.activeKcal, distanceKm: fresh.distanceKm ?? old.distanceKm });
  }
  const lastHealthSync = checked && (!state.lastHealthSync || Date.parse(checked) > Date.parse(state.lastHealthSync)) ? checked : state.lastHealthSync;
  return { ...state, activities: [...state.activities.filter(a => a.source !== 'health'), ...byDate.values()], lastHealthSync };
}
export async function consumeBackground(): Promise<State> {
  if (!hasAndroidBackground) return loadState();
  let snapshot: Snapshot;
  try { snapshot = await native.snapshot(); }
  catch { return loadState(); } // An optional native service must not block the offline diary.
  const records = (snapshot.records ?? []).map(r => activitySchema.safeParse(r)).filter(r => r.success).map(r => r.data!);
  const checked = snapshot.lastChecked && Number.isFinite(Date.parse(snapshot.lastChecked)) ? new Date(snapshot.lastChecked).toISOString() : undefined;
  return records.length ? mutateState(state => mergeHealthRecords(state, records, checked)) : loadState();
}
