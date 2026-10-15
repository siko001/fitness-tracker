import { createHash } from 'node:crypto';
import { foodAssistant } from './food-assistant.mjs';

const budgets = new Map();
function json(res, status, body) { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); }
export async function assistantHttp(req, res, { localAuthorized = false, env = process.env } = {}) {
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
    let serverAllowed = localAuthorized;
    if (!serverAllowed && env.GROQ_API_KEY && req.headers.authorization?.startsWith('Bearer ')) {
      const url = env.VITE_SUPABASE_URL, publicKey = env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const allowedUsers = (env.GROQ_ALLOWED_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
      if (url && publicKey && allowedUsers.length) {
        const result = await fetch(`${url.replace(/\/$/, '')}/auth/v1/user`, { headers: { Authorization: req.headers.authorization, apikey: publicKey }, signal: AbortSignal.timeout(8000), redirect: 'error' });
        if (result.ok) serverAllowed = allowedUsers.includes((await result.json()).id);
      }
    }
    if (req.method === 'GET') return json(res, 200, { configured: !!env.GROQ_API_KEY && serverAllowed });
    if (!suppliedKey && (!serverAllowed || !env.GROQ_API_KEY)) return json(res, 401, { error: 'Enter your Groq key for this session, or sign in to the account enabled for server AI.' });
    // Limit paid work per credential and per instance. The provider's account limits
    // remain authoritative across Vercel instances. No request/key logging.
    const identity = createHash('sha256').update(suppliedKey ? input.apiKey : req.headers.authorization || 'local').digest('hex');
    const now = Date.now(), budget = budgets.get(identity) || [];
    const recent = budget.filter(t => t > now - 60000);
    if (recent.length >= 6) return json(res, 429, { error: 'Please wait a minute before sending more AI requests.' });
    if (budgets.size > 1000) budgets.clear();
    budgets.set(identity, [...recent, now]);
    return json(res, 200, await foodAssistant(input, { apiKey: serverAllowed ? env.GROQ_API_KEY : undefined }));
  } catch (e) {
    // Never return upstream bodies (they can echo food text or credentials).
    const safe = e.status && [429, 502, 503].includes(e.status);
    return json(res, safe ? e.status : 400, { error: safe ? e.message : 'Could not prepare this meal. Try a shorter message or fewer items. Nothing has been saved.' });
  }
}
