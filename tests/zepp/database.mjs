// Runs in an isolated PostgreSQL instance; never touches the hosted diary.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create schema auth;
  create table auth.users(id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;`);
await db.exec(readFileSync(new URL('../../supabase/zepp.sql', import.meta.url), 'utf8'));
await db.exec(readFileSync(new URL('../../supabase/zepp.sql', import.meta.url), 'utf8')); // safe re-run
const user = '00000000-0000-4000-8000-000000000001', other = '00000000-0000-4000-8000-000000000002';
await db.query('insert into auth.users values ($1),($2)', [user, other]);
async function as(role, id='') { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]); await db.exec(`set role ${role}`); }
async function fails(sql, args=[]) { await assert.rejects(db.query(sql,args)); }
const token = 'a'.repeat(64), replacement = 'b'.repeat(64);
await as('anon'); await fails('select public.pair_zepp($1)',[token]);
await as('authenticated',user);
await db.query('select public.pair_zepp($1)',[token]);
await fails('select token_hash from public.zepp_connections');
await fails('select public.set_zepp_enabled(true)');
await fails('update public.zepp_connections set enabled=true');
await as('anon'); await fails('select * from public.zepp_step_days');
const now = new Date(), date = new Date(now.getTime()+120*60000).toISOString().slice(0,10);
const ingest = 'select public.ingest_zepp_steps($1,$2,$3,$4,$5) as result';
const input=[token,date,801,now.toISOString(),120];
assert.equal((await db.query(ingest,input)).rows[0].result.accepted,true);
assert.equal((await db.query(ingest,input)).rows[0].result.accepted,false);
assert.equal((await db.query(ingest,[token,date,706,new Date(now.getTime()-60000).toISOString(),120])).rows[0].result.accepted,false);
await fails(ingest,[token,date,-1,now.toISOString(),120]);
await fails(ingest,[token,date,802,new Date(now.getTime()+3600000).toISOString(),120]);
await fails(ingest,[token,'2000-01-01',802,now.toISOString(),120]);
await fails(ingest,[token,date,802,now.toISOString(),999]);
await fails(ingest,['c'.repeat(64),date,802,now.toISOString(),120]);
await as('authenticated',other);
assert.equal((await db.query('select steps from public.zepp_step_days')).rows.length,0);
assert.equal((await db.query('select device_id from public.zepp_connections')).rows.length,0);
await as('authenticated',user);
assert.equal((await db.query('select steps from public.zepp_step_days')).rows[0].steps,801);
await db.query('select public.set_zepp_enabled(true)');
assert.equal((await db.query('select enabled from public.zepp_connections')).rows[0].enabled,true);
await db.query('select public.pair_zepp($1)',[replacement]);
await fails('select public.set_zepp_enabled(true)');
await as('anon'); await fails(ingest,input);
await db.query(ingest,[replacement,date,810,new Date(now.getTime()+1000).toISOString(),120]);
// Delayed previous-day snapshot retains the capture day's timezone, not today's.
const old = new Date(now.getTime()-86400000), oldDate = new Date(old.getTime()-300*60000).toISOString().slice(0,10);
await db.query(ingest,[replacement,oldDate,1000,old.toISOString(),-300]);
await as('authenticated',user); await db.query('select public.revoke_zepp()');
await as('anon'); await fails(ingest,[replacement,date,900,now.toISOString(),120]);
await db.close(); console.log('PASS: migration rerun, owner isolation, token scope/rotation/revocation, activation gate, duplicates, out-of-order, bounds, delayed-day offsets.');
