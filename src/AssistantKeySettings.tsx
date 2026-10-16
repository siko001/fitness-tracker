import { useCallback, useEffect, useRef, useState } from 'react';
import { cloud } from './cloud';
import { assistantStatus, getAssistantKey, setAssistantKey, updateAssistantKey, type AssistantStatus } from './food-assistant';
import { Field } from './ui';

const empty: AssistantStatus = { configured: false, savedKey: false, canSaveKey: false, signedIn: false };
export function useAssistantCredentials() {
  const [status, setStatus] = useState(empty), [key, updateKey] = useState(getAssistantKey);
  const [checking, setChecking] = useState(true), [working, setWorking] = useState(false), [error, setError] = useState('');
  const generation = useRef(0), mounted = useRef(true), busy = useRef(false);
  const setKey = useCallback((value: string) => { updateKey(value); setAssistantKey(value); }, []);
  const refresh = useCallback(async () => {
    if (busy.current) return;
    const request = ++generation.current;
    try {
      const next = await assistantStatus();
      if (mounted.current && request === generation.current) { setStatus(next); setError(''); }
    } catch (e) {
      if (mounted.current && request === generation.current) { setStatus(empty); setError(e instanceof Error ? e.message : 'Could not check your saved key.'); }
    } finally { if (mounted.current && request === generation.current) setChecking(false); }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    const foreground = () => { if (!document.hidden) void refresh(); };
    window.addEventListener('focus', foreground); window.addEventListener('online', foreground); document.addEventListener('visibilitychange', foreground);
    const timer = window.setInterval(foreground, 30000);
    let account: string | null | undefined;
    const subscription = cloud?.auth.onAuthStateChange((event, session) => {
      const next = session?.user.id ?? null;
      if (event === 'SIGNED_OUT' || account !== undefined && account !== next) { setKey(''); setStatus(empty); generation.current++; }
      account = next;
      // Do not call back into Supabase while its auth callback holds a lock.
      queueMicrotask(() => { if (mounted.current) void refresh(); });
    });
    return () => { mounted.current = false; generation.current++; clearInterval(timer); window.removeEventListener('focus', foreground); window.removeEventListener('online', foreground); document.removeEventListener('visibilitychange', foreground); subscription?.data.subscription.unsubscribe(); };
  }, [refresh, setKey]);
  async function save(remove = false) {
    if (busy.current) return;
    busy.current = true; setWorking(true); setError(''); const request = ++generation.current;
    try {
      const next = await updateAssistantKey(remove ? null : key);
      if (mounted.current && request === generation.current) { setStatus(next); setKey(''); }
    } catch (e) { if (mounted.current && request === generation.current) setError(e instanceof Error ? e.message : 'Could not save your key.'); }
    finally { busy.current = false; if (mounted.current) { setWorking(false); setChecking(false); } }
  }
  return { status, key, setKey, checking, working, error, save };
}
export default function AssistantKeySettings({ access }: { access: ReturnType<typeof useAssistantCredentials> }) {
  const { status, key, setKey, checking, working, error, save } = access;
  return <section className="assistant-setup" aria-label="Assistant settings"><h3>AI settings</h3>
    <p role="status">{checking ? 'Checking your account…' : status.savedKey ? 'Encrypted key saved to your account. Available on your signed-in devices.' : status.configured ? 'AI is ready with the server key.' : status.canSaveKey ? 'Save once to use Groq on your signed-in devices.' : status.signedIn ? 'Encrypted key storage needs server setup.' : 'Sign in with Hosted sync to save a key across devices.'}</p>
    <Field label="Groq API key" hint={status.canSaveKey ? 'Encrypted on the server. Never included in chats or diary backups.' : 'Without account storage, an entered key lasts only for this session.'}>
      <input type="password" autoComplete="off" spellCheck={false} maxLength={250} value={key} placeholder={status.savedKey ? 'Paste a new key to replace it' : 'gsk_…'} disabled={working} onChange={e => setKey(e.target.value)} />
    </Field>
    <div className="assistant-key-actions">
      <button className="button primary" type="button" disabled={checking || working || !status.canSaveKey || key.trim().length < 20} onClick={() => void save()}>{working ? 'Saving…' : status.savedKey ? 'Replace encrypted key' : 'Save encrypted key'}</button>
      {status.savedKey && <button className="button secondary" type="button" disabled={working} onClick={() => void save(true)}>Remove saved key</button>}
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {!!key && <p className="muted">This key is not saved yet.</p>}
    <p className="muted">AI receives this conversation and matching foods. <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer">Get a Groq key ↗</a></p>
  </section>;
}
