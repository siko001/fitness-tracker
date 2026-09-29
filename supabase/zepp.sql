-- Additive migration. Existing diary/Health Connect sync is untouched.
begin;
create table if not exists public.zepp_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  device_id uuid not null unique default gen_random_uuid(),
  token_hash text not null,
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  last_received_at timestamptz,
  revoked_at timestamptz
);
create table if not exists public.zepp_step_days (
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid not null,
  date date not null,
  steps integer not null check (steps between 0 and 500000),
  captured_at timestamptz not null,
  utc_offset_minutes integer not null check (utc_offset_minutes between -840 and 840),
  received_at timestamptz not null default now(),
  primary key (user_id, date)
);
alter table public.zepp_connections enable row level security;
alter table public.zepp_step_days enable row level security;
revoke all on public.zepp_connections, public.zepp_step_days from public, anon, authenticated;
-- Hashes are never exposed through the Data API, even to the owner.
grant select (user_id, device_id, enabled, created_at, last_received_at, revoked_at) on public.zepp_connections to authenticated;
grant select on public.zepp_step_days to authenticated;
drop policy if exists "Own Zepp connection" on public.zepp_connections;
create policy "Own Zepp connection" on public.zepp_connections for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Own Zepp steps" on public.zepp_step_days;
create policy "Own Zepp steps" on public.zepp_step_days for select to authenticated using ((select auth.uid()) = user_id);

-- Caller supplies 256 bits from crypto.getRandomValues. Return no persistent secret.
create or replace function public.pair_zepp(pairing_token text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare device uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if pairing_token is null or pairing_token !~ '^[0-9a-f]{64}$' then raise exception 'Invalid pairing token'; end if;
  insert into public.zepp_connections (user_id, token_hash)
  values (auth.uid(), encode(sha256(convert_to(pairing_token, 'UTF8')), 'hex'))
  on conflict (user_id) do update set device_id = gen_random_uuid(), token_hash = excluded.token_hash,
    enabled = false, created_at = now(), last_received_at = null, revoked_at = null
  returning device_id into device;
  return device;
end;
$$;

create or replace function public.set_zepp_enabled(use_direct boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare connection public.zepp_connections;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into connection from public.zepp_connections where user_id = auth.uid() for update;
  if connection.user_id is null or connection.revoked_at is not null then raise exception 'Pair Zepp first'; end if;
  if use_direct and not exists (select 1 from public.zepp_step_days s where s.user_id = auth.uid()
    and s.device_id = connection.device_id and s.captured_at > now() - interval '1 hour') then
    raise exception 'Receive and verify a fresh watch reading first';
  end if;
  update public.zepp_connections set enabled = coalesce(use_direct, false) where user_id = auth.uid();
end;
$$;

create or replace function public.revoke_zepp()
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  update public.zepp_connections set enabled = false, revoked_at = now() where user_id = auth.uid();
end;
$$;

-- The relay may ONLY submit steps for its paired owner. No diary read/write access.
-- Date belongs to the watch at capture time, including travel/DST and delayed delivery.
create or replace function public.ingest_zepp_steps(
  pairing_token text, watch_date date, step_count integer, captured_at timestamptz, utc_offset_minutes integer
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare connection public.zepp_connections; accepted integer; stamp timestamptz := now();
begin
  if pairing_token is null or pairing_token !~ '^[0-9a-f]{64}$' then raise exception 'Invalid pairing'; end if;
  select * into connection from public.zepp_connections
    where token_hash = encode(sha256(convert_to(pairing_token, 'UTF8')), 'hex') and revoked_at is null for update;
  if connection.user_id is null then raise exception 'Invalid pairing'; end if;
  if step_count is null or step_count < 0 or step_count > 500000 or captured_at is null
    or captured_at > stamp + interval '5 minutes' or captured_at < stamp - interval '32 days'
    or utc_offset_minutes is null or utc_offset_minutes < -840 or utc_offset_minutes > 840
    or watch_date is null or watch_date <> (captured_at at time zone 'UTC' + make_interval(mins => utc_offset_minutes))::date
  then raise exception 'Invalid watch snapshot'; end if;
  insert into public.zepp_step_days as saved (user_id, device_id, date, steps, captured_at, utc_offset_minutes, received_at)
  values (connection.user_id, connection.device_id, watch_date, step_count, captured_at, utc_offset_minutes, stamp)
  on conflict (user_id, date) do update set device_id = excluded.device_id, steps = excluded.steps,
    captured_at = excluded.captured_at, utc_offset_minutes = excluded.utc_offset_minutes, received_at = excluded.received_at
  where excluded.captured_at > saved.captured_at;
  get diagnostics accepted = row_count;
  if accepted > 0 then update public.zepp_connections set last_received_at = stamp where user_id = connection.user_id; end if;
  return jsonb_build_object('ok', true, 'accepted', accepted > 0);
end;
$$;
revoke all on function public.pair_zepp(text), public.set_zepp_enabled(boolean), public.revoke_zepp(), public.ingest_zepp_steps(text,date,integer,timestamptz,integer) from public, anon, authenticated;
grant execute on function public.pair_zepp(text), public.set_zepp_enabled(boolean), public.revoke_zepp() to authenticated;
grant execute on function public.ingest_zepp_steps(text,date,integer,timestamptz,integer) to anon, authenticated;
commit;
