import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export class CredentialError extends Error {
  constructor(message, status = 503) { super(message); this.status = status; }
}
function encryptionKey(env) {
  const value = env.STEADY_CREDENTIAL_ENCRYPTION_KEY || '';
  if (!/^[A-Za-z0-9+/]{43}=$/.test(value) || Buffer.from(value, 'base64').length !== 32) {
    throw new CredentialError('Encrypted key storage needs server setup. Your key has not been saved.');
  }
  return Buffer.from(value, 'base64');
}
export function credentialsEnabled(env) {
  try { encryptionKey(env); return !!env.VITE_SUPABASE_URL && !!env.VITE_SUPABASE_PUBLISHABLE_KEY; }
  catch { return false; }
}
function aad(userId, env) { return Buffer.from(`steady:groq:v1:${env.VITE_SUPABASE_URL}:${userId}`); }
export function encryptCredential(value, userId, env) {
  const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', encryptionKey(env), nonce);
  cipher.setAAD(aad(userId, env));
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return ['v1', nonce.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
}
export function decryptCredential(value, userId, env) {
  const key = encryptionKey(env);
  try {
    if (typeof value !== 'string' || value.length > 512) throw new Error();
    const [version, nonce, tag, content, extra] = value.split('.');
    if (version !== 'v1' || extra || !/^[\w-]{16}$/.test(nonce) || !/^[\w-]{22}$/.test(tag) || !/^[\w-]+$/.test(content)) throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(nonce, 'base64url'));
    decipher.setAAD(aad(userId, env)); decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(content, 'base64url')), decipher.final()]).toString('utf8');
  } catch { throw new CredentialError('Your saved Groq key could not be unlocked. Replace it in AI settings.'); }
}
export async function credentialUser(authorization, env, fetcher = fetch) {
  if (!authorization?.startsWith('Bearer ') || !env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_PUBLISHABLE_KEY) return null;
  let response;
  try {
    response = await fetcher(`${env.VITE_SUPABASE_URL.replace(/\/$/, '')}/auth/v1/user`, {
      headers: { Authorization: authorization, apikey: env.VITE_SUPABASE_PUBLISHABLE_KEY }, signal: AbortSignal.timeout(8000), redirect: 'error',
    });
  } catch { throw new CredentialError('Could not verify your account. Please try again.'); }
  if ([401, 403].includes(response.status)) throw new CredentialError('Your sign-in has expired. Sign in again in Settings.', 401);
  if (!response.ok) throw new CredentialError('Could not verify your account. Please try again.');
  const user = await response.json();
  if (!/^[a-f0-9-]{36}$/i.test(user.id || '')) throw new CredentialError('Could not verify your account.', 401);
  return user.id;
}
export async function credentialStore(method, userId, authorization, env, value, fetcher = fetch) {
  const root = `${env.VITE_SUPABASE_URL.replace(/\/$/, '')}/rest/v1/assistant_credentials`;
  const url = method === 'POST' ? `${root}?on_conflict=user_id` : `${root}?user_id=eq.${encodeURIComponent(userId)}&select=encrypted_key`;
  let response;
  try {
    response = await fetcher(url, {
      method, redirect: 'error', signal: AbortSignal.timeout(8000), headers: {
        Authorization: authorization, apikey: env.VITE_SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json',
        ...(method === 'POST' ? { Prefer: 'resolution=merge-duplicates,return=minimal' } : {}),
      }, ...(method === 'POST' ? { body: JSON.stringify({ user_id: userId, encrypted_key: encryptCredential(value, userId, env), updated_at: new Date().toISOString() }) } : {}),
    });
  } catch { throw new CredentialError('Could not reach encrypted key storage. Please try again.'); }
  if (!response.ok) {
    if ([401, 403].includes(response.status)) throw new CredentialError('Could not access your saved key. Sign in again in Settings.', 401);
    if (response.status === 404) throw new CredentialError('Encrypted key storage needs the Supabase setup. Your key has not been saved.');
    throw new CredentialError('Could not update or read your saved key. Please try again.');
  }
  if (method === 'GET') {
    const rows = await response.json();
    if (!Array.isArray(rows) || rows.length > 1) throw new CredentialError('Could not read your saved key.');
    return rows[0]?.encrypted_key ?? null;
  }
  return null;
}
