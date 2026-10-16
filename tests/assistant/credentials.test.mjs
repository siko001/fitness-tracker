import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { assistantHttp } from '../../server/assistant-http.mjs';
import { encryptCredential, decryptCredential } from '../../server/assistant-credentials.mjs';

const owner = '00000000-0000-4000-8000-000000000001', other = '00000000-0000-4000-8000-000000000002';
const key = 'gsk_fake_test_only_never_a_real_key';
const env = { STEADY_CREDENTIAL_ENCRYPTION_KEY: randomBytes(32).toString('base64'), VITE_SUPABASE_URL: 'https://test.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'public-test-key' };
function service() {
  const rows = new Map();
  const fetcher = async (url, options) => {
    const id = options.headers.Authorization === 'Bearer owner' || options.headers.Authorization === 'Bearer owner-refreshed' ? owner : options.headers.Authorization === 'Bearer other' ? other : null;
    if (!id) return Response.json({ error: 'private upstream message' }, { status: 401 });
    if (url.endsWith('/auth/v1/user')) return Response.json({ id });
    assert(url.startsWith(env.VITE_SUPABASE_URL + '/rest/v1/assistant_credentials'));
    assert.equal(options.headers.apikey, env.VITE_SUPABASE_PUBLISHABLE_KEY);
    if (options.method === 'POST') { const body = JSON.parse(options.body); assert.equal(body.user_id, id); assert(!options.body.includes(key)); rows.set(id, body.encrypted_key); }
    else { assert.equal(new URL(url).searchParams.get('user_id'), `eq.${id}`); if (options.method === 'DELETE') rows.delete(id); }
    return options.method === 'GET' ? Response.json(rows.has(id) ? [{ encrypted_key: rows.get(id) }] : []) : new Response(null, { status: 204 });
  };
  return { rows, fetcher };
}
async function request(options = {}, method = 'GET', body, token = 'owner') {
  const req = { method, headers: { host: 'test.local', ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' }, body };
  const headers = {}, res = { setHeader(k, v) { headers[k] = v; }, end(value) { this.body = JSON.parse(value); } };
  await assistantHttp(req, res, { env, ...options });
  assert.equal(headers['Cache-Control'], 'no-store');
  assert(!JSON.stringify(res.body).includes(key));
  return { status: res.statusCode, ...res.body };
}
test('AES-GCM uses random nonces, rejects tampering, wrong account, project and encryption key', () => {
  const a = encryptCredential(key, owner, env), b = encryptCredential(key, owner, env);
  assert.notEqual(a, b); assert(!a.includes(key)); assert.equal(decryptCredential(a, owner, env), key);
  for (const [value, id, config] of [[a, other, env], [a, owner, { ...env, VITE_SUPABASE_URL: 'https://other.supabase.co' }], [a, owner, { ...env, STEADY_CREDENTIAL_ENCRYPTION_KEY: randomBytes(32).toString('base64') }], [a.slice(0, -4) + 'abcd', owner, env], ['plain-text-key', owner, env]]) {
    assert.throws(() => decryptCredential(value, id, config), /could not be unlocked/);
  }
  assert.throws(() => encryptCredential(key, owner, {}), /needs server setup/);
});
test('save on one device, use on another: credentials stay encrypted and scoped to verified identity', async () => {
  const store = service();
  assert.equal((await request(store)).savedKey, false);
  const saved = await request(store, 'POST', { action: 'save_key', apiKey: key, user_id: other });
  assert.equal(saved.status, 200); assert.equal(saved.savedKey, true); assert(store.rows.has(owner)); assert(!store.rows.has(other));
  assert.equal((await request(store, 'GET', undefined, 'owner-refreshed')).configured, true);
  assert.equal((await request(store, 'GET', undefined, 'other')).savedKey, false);
  assert.equal((await request(store, 'GET', undefined, null)).configured, false);
  let used = false;
  const sent = await request({ ...store, assistant: async (input, options) => { assert.equal(input.apiKey, undefined); assert.equal(options.apiKey, key); used = true; return { reply: 'Hello', items: [], draft: [], warnings: [] }; } }, 'POST', { messages: [{ role: 'user', content: 'Hello' }] });
  assert.equal(sent.status, 200); assert(used);
  const scan = await request({ ...store, scanner: async (input, options) => { assert.equal(input.apiKey, undefined); assert.equal(options.apiKey, key); return { unit: 'ml' }; } }, 'POST', { operation: 'scan_label', images: ['data:image/jpeg;base64,/9j/AA=='] }, 'owner-refreshed');
  assert.equal(scan.status, 200); assert.equal(scan.unit, 'ml');
  const removed = await request(store, 'POST', { action: 'remove_key' });
  assert.equal(removed.savedKey, false); assert.equal((await request(store, 'GET', undefined, 'owner-refreshed')).configured, false);
});
test('auth, storage and encryption failures never fall back to unencrypted persistence', async () => {
  const store = service();
  for (const token of [null, 'forged']) {
    for (const action of ['save_key', 'remove_key']) assert.equal((await request(store, 'POST', { action, apiKey: key }, token)).status, 401);
  }
  assert.equal((await request({ ...store, env: { ...env, STEADY_CREDENTIAL_ENCRYPTION_KEY: '' } }, 'POST', { action: 'save_key', apiKey: key })).status, 503);
  assert.equal(store.rows.size, 0);
  assert.equal((await request(store, 'POST', { action: 'save_key', apiKey: 'wrong-format-but-long-enough' })).status, 400);
  for (const status of [404, 500]) {
    const response = await request({ fetcher: async url => url.endsWith('/auth/v1/user') ? Response.json({ id: owner }) : new Response(key, { status }) }, 'POST', { action: 'save_key', apiKey: key });
    assert.equal(response.status, 503);
  }
  store.rows.set(owner, encryptCredential(key, other, env));
  let used = false;
  assert.equal((await request({ ...store, assistant: async () => { used = true; } }, 'POST', { messages: [] })).status, 503);
  assert(!used);
  // Removal works even if the server encryption secret is lost.
  assert.equal((await request({ ...store, env: { ...env, STEADY_CREDENTIAL_ENCRYPTION_KEY: '' } }, 'POST', { action: 'remove_key' })).status, 200);
});
test('local pairing and temporary BYOK keep working without account credential setup', async () => {
  let used;
  assert.equal((await request({ env: { GROQ_API_KEY: key }, localAuthorized: true, assistant: async (_, options) => { used = options.apiKey; return {}; } }, 'POST', { messages: [] }, 'pairing')).status, 200);
  assert.equal(used, key);
  assert.equal((await request({ env: {}, assistant: async input => { assert.equal(input.apiKey, key); return {}; } }, 'POST', { apiKey: key }, null)).status, 200);
});
test('credential migration is rerunnable; RLS denies anonymous and cross-account read/write/delete', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;`);
    const sql = readFileSync(new URL('../../supabase/assistant-credentials.sql', import.meta.url), 'utf8');
    await db.exec(sql); await db.exec(sql);
    await db.query('insert into auth.users values ($1), ($2)', [owner, other]);
    async function as(role, id = '') { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]); await db.exec(`set role ${role}`); }
    const encrypted = encryptCredential(key, owner, env);
    await as('anon');
    for (const sql of ['select * from public.assistant_credentials', 'delete from public.assistant_credentials', "insert into public.assistant_credentials values (null, 'plaintext', now())"]) await assert.rejects(db.query(sql));
    await as('authenticated', owner);
    await assert.rejects(db.query('insert into public.assistant_credentials(user_id,encrypted_key) values ($1,$2)', [owner, key]));
    await db.query('insert into public.assistant_credentials(user_id,encrypted_key) values ($1,$2)', [owner, encrypted]);
    assert.equal((await db.query('select * from public.assistant_credentials')).rows.length, 1);
    await as('authenticated', other);
    assert.equal((await db.query('select * from public.assistant_credentials')).rows.length, 0);
    await assert.rejects(db.query('insert into public.assistant_credentials(user_id,encrypted_key) values ($1,$2)', [owner, encrypted]));
    assert.equal((await db.query('update public.assistant_credentials set encrypted_key=$1 returning user_id', [encrypted])).rows.length, 0);
    assert.equal((await db.query('delete from public.assistant_credentials returning user_id')).rows.length, 0);
    await as('authenticated', owner);
    assert.equal((await db.query('delete from public.assistant_credentials returning user_id')).rows.length, 1);
  } finally { await db.close(); }
});
