import { useCallback, useEffect, useRef, useState } from 'react';
import { App } from '@capacitor/app';
import { cloud } from './cloud';
import { isNative } from './health';
import { readMetadata, writeMetadata } from './storage';
import { emptyZepp, zeppDataSchema, type ZeppData } from './zepp';

export function useZepp(mode: string) {
  const [data, setData] = useState<ZeppData>(emptyZepp), [error, setError] = useState('');
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [pairing, setPairing] = useState('');
  const [checkedAt, setCheckedAt] = useState(0);
  const generation = useRef(0), currentUser = useRef(''), requestNumber = useRef(0);
  const refresh = useCallback(async () => {
    if (!cloud || mode !== 'cloud') return;
    const request = generation.current;
    const sequence = ++requestNumber.current;
    const { data: { session } } = await cloud.auth.getSession();
    if (request !== generation.current) return;
    if (!session) { currentUser.current = ''; setData(emptyZepp); setReady(false); return; }
    const user = session.user.id;
    const owner = await readMetadata<{ userId: string }>('sync');
    if (owner && owner.userId !== user) { setData(emptyZepp); setReady(false); return; }
    if (currentUser.current !== user) {
      currentUser.current = user; setData(emptyZepp); setPairing('');
      const cached = zeppDataSchema.safeParse(await readMetadata(`zepp:${user}`));
      if (cached.success && request === generation.current) setData(cached.data);
    }
    const [connection, snapshots] = await Promise.all([
      cloud.from('zepp_connections').select('device_id,enabled,revoked_at,last_received_at').eq('user_id', user).maybeSingle(),
      cloud.from('zepp_step_days').select('device_id,date,steps,captured_at,received_at').eq('user_id', user).order('date', { ascending: false }).limit(3660),
    ]);
    if (request !== generation.current || sequence !== requestNumber.current || currentUser.current !== user) return;
    if (connection.error || snapshots.error) {
      setError('Direct watch readings are unavailable. Existing health and diary sync continue.'); setReady(false); return;
    }
    const next = zeppDataSchema.parse({ connection: connection.data, snapshots: snapshots.data });
    setData(next); setError(''); setReady(true); setCheckedAt(Date.now()); await writeMetadata(`zepp:${user}`, next);
  }, [mode]);
  useEffect(() => {
    generation.current++; currentUser.current = ''; setData(emptyZepp); setPairing(''); setError(''); setReady(false); setCheckedAt(0);
    const run = () => { void refresh().catch(() => setError('Could not check direct watch readings. Saved readings remain available.')); };
    run(); const timer = setInterval(() => { if (document.visibilityState === 'visible') run(); }, 10000);
    const foreground = () => { if (document.visibilityState === 'visible') run(); };
    document.addEventListener('visibilitychange', foreground); window.addEventListener('focus', foreground); window.addEventListener('online', run);
    const auth = cloud?.auth.onAuthStateChange((_event, session) => {
      if (session?.user.id !== currentUser.current) { generation.current++; currentUser.current = ''; setData(emptyZepp); setPairing(''); setReady(false); setCheckedAt(0); }
      // Avoid calling other Supabase methods inside the auth lock.
      setTimeout(run, 0);
    });
    const native = isNative ? App.addListener('appStateChange', ({ isActive }) => { if (isActive) run(); }) : null;
    return () => { generation.current++; clearInterval(timer); document.removeEventListener('visibilitychange', foreground); window.removeEventListener('focus', foreground); window.removeEventListener('online', run); auth?.data.subscription.unsubscribe(); void native?.then(h => h.remove()); };
  }, [refresh]);
  async function action(type: 'pair' | 'enable' | 'disable' | 'revoke') {
    if (!cloud || mode !== 'cloud') return;
    setBusy(true); setError('');
    const actionGeneration = generation.current;
    try {
      const owner = await readMetadata<{ userId: string }>('sync');
      const { data: { session } } = await cloud.auth.getSession();
      if (!session || owner && owner.userId !== session.user.id) throw new Error('Sign in and sync this diary first.');
      if (type === 'pair') {
        const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, '0')).join('');
        const { error } = await cloud.rpc('pair_zepp', { pairing_token: token });
        if (error) throw new Error('Pairing could not be created. Check your connection and the Zepp server setup.');
        if (actionGeneration !== generation.current) return;
        setPairing(JSON.stringify({ version: 1, url: import.meta.env.VITE_SUPABASE_URL, key: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, token }));
      } else {
        const { error } = await cloud.rpc(type === 'revoke' ? 'revoke_zepp' : 'set_zepp_enabled', type === 'revoke' ? undefined : { use_direct: type === 'enable' });
        if (error) throw new Error(type === 'enable' ? 'Receive a watch reading from the last hour and verify it first.' : 'Could not update the connection. Try again when online.');
        if (type === 'revoke') setPairing('');
      }
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not update direct sync.'); }
    finally { setBusy(false); }
  }
  return { data: mode === 'cloud' ? data : emptyZepp, error, ready, busy, pairing, checkedAt, mode, action, refresh, hidePairing: () => setPairing('') };
}
export type ZeppController = ReturnType<typeof useZepp>;
