import { createHash } from 'node:crypto';
import { foodAssistant } from './food-assistant.mjs';
import { CredentialError, credentialUser, credentialStore, credentialsEnabled, decryptCredential } from './assistant-credentials.mjs';

const budgets = new Map();
function json(res, status, body) { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); }
export async function assistantHttp(req, res, { localAuthorized = false, env = process.env, fetcher = fetch, assistant = foodAssistant } = {}) {
  res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
  const origin = req.headers.origin;
  const allowed = new Set(['https://fitness-tracker-one-steel.vercel.app', 'https://localhost', 'http://localhost', 'capacitor://localhost', ...(env.STEADY_ALLOWED_ORIGINS || '').split(',')]);
  const own = [`https://${req.headers.host}`, `http://${req.headers.host}`];
  if (origin && !allowed.has(origin) && !own.includes(origin)) return json(res, 403, { error: 'Origin not allowed' });
  if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
  if (req.method === 'OPTIONS') { res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS'); res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type'); res.statusCode = 204; return res.end(); }
  if (!['GET', 'POST'].includes(req.method)) return json(res, 405, { error: 'Method not allowed' });
  try {
    let input;
    if (req.method === 'POST') {
      if (!req.headers['content-type']?.startsWith('application/json')) return json(res, 415, { error: 'JSON required' });
      if (Number(req.headers['content-length']) > 2_000_000) return json(res, 413, { error: 'Food library is too large for this request.' });
      if (req.body !== undefined) input = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      else {
        let size = 0; const chunks = [];
        for await (const chunk of req) { size += Buffer.byteLength(chunk); if (size > 2_000_000) return json(res, 413, { error: 'Food library is too large for this request.' }); chunks.push(Buffer.from(chunk)); }
        input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      }
      if (JSON.stringify(input).length > 2_000_000) return json(res, 413, { error: 'Food library is too large for this request.' });
    }
    const suppliedKey = typeof input?.apiKey === 'string' && input.apiKey.trim().length >= 20 && input.apiKey.length <= 250;
    const userId = localAuthorized ? null : await credentialUser(req.headers.authorization, env, fetcher);
    const serverAllowed = localAuthorized || !!userId && (env.GROQ_ALLOWED_USER_IDS || '').split(',').map(s => s.trim()).includes(userId);
    const canSaveKey = !localAuthorized && !!userId && credentialsEnabled(env);
    const serverConfigured = !!env.GROQ_API_KEY && serverAllowed;
    if (input?.action) {
      if (!['save_key', 'remove_key'].includes(input.action)) return json(res, 400, { error: 'Unknown action.' });
      if (!userId) return json(res, 401, { error: 'Sign in with Hosted sync to save a key across your devices.' });
      if (input.action === 'save_key' && !canSaveKey) throw new CredentialError('Encrypted key storage needs server setup. Your key has not been saved.');
      if (input.action === 'save_key' && (!suppliedKey || !/^gsk_[A-Za-z0-9_-]{16,246}$/.test(input.apiKey.trim()))) return json(res, 400, { error: 'Enter a valid Groq API key beginning with gsk_.' });
      await credentialStore(input.action === 'save_key' ? 'POST' : 'DELETE', userId, req.headers.authorization, env, input.apiKey?.trim(), fetcher);
      return json(res, 200, { configured: input.action === 'save_key' || serverConfigured, savedKey: input.action === 'save_key', canSaveKey, signedIn: true });
    }
    // A caller's verified Supabase identity is the only way to select a saved key.
    // RLS independently enforces that same identity at the database boundary.
    let saved = null;
    if (canSaveKey && (req.method === 'GET' || !suppliedKey)) saved = await credentialStore('GET', userId, req.headers.authorization, env, undefined, fetcher);
    if (req.method === 'GET') return json(res, 200, { configured: !!saved || serverConfigured, savedKey: !!saved, canSaveKey, signedIn: !!userId });
    const apiKey = saved ? decryptCredential(saved, userId, env) : serverConfigured ? env.GROQ_API_KEY : undefined;
    if (!suppliedKey && !apiKey) return json(res, 401, { error: 'Add a Groq key in AI settings, or sign in to the account with your saved key.' });
    // Per-instance limit; authenticated identity stays stable across token refreshes.
    // Provider account limits remain authoritative across Vercel instances.
    const identity = createHash('sha256').update(userId || (suppliedKey ? input.apiKey : 'local')).digest('hex');
    const now = Date.now(), budget = budgets.get(identity) || [];
    const recent = budget.filter(t => t > now - 60000);
    if (recent.length >= 6) return json(res, 429, { error: 'Please wait a minute before sending more AI requests.' });
    if (budgets.size > 1000) budgets.clear();
    budgets.set(identity, [...recent, now]);
    return json(res, 200, await assistant(input, { apiKey }));
  } catch (e) {
    // Never return upstream bodies (they can echo food text or credentials).
    if (e instanceof CredentialError) return json(res, e.status, { error: e.message });
    const safe = e.status && [429, 502, 503].includes(e.status);
    return json(res, safe ? e.status : 400, { error: safe ? e.message : 'Could not prepare this meal. Try a shorter message or fewer items. Nothing has been saved.' });
  }
}
