-- Run once in your own Supabase project's SQL editor.
-- Only your signed-in user can read or change their diary. No service key is used by the app.
create table if not exists public.diaries (
  user_id uuid primary key references auth.users(id) on delete cascade,
  revision bigint not null default 1 check (revision > 0),
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and payload ->> 'version' = '1'),
  updated_at timestamptz not null default now()
);
alter table public.diaries enable row level security;
revoke all on public.diaries from anon;
grant select, insert, update, delete on public.diaries to authenticated;
drop policy if exists "Own diary only" on public.diaries;
create policy "Own diary only" on public.diaries for all to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Atomic compare-and-swap prevents one device silently overwriting another.
create or replace function public.save_diary(expected_revision bigint, next_payload jsonb)
returns bigint language plpgsql security invoker set search_path = '' as $$
declare new_revision bigint;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if octet_length(next_payload::text) > 20000000 then raise exception 'Diary too large'; end if;
  if expected_revision = 0 then
    insert into public.diaries (user_id, revision, payload)
    values (auth.uid(), 1, next_payload)
    on conflict (user_id) do nothing returning revision into new_revision;
  else
    update public.diaries set payload = next_payload, revision = revision + 1, updated_at = now()
    where user_id = auth.uid() and revision = expected_revision returning revision into new_revision;
  end if;
  return new_revision;
end;
$$;
revoke all on function public.save_diary(bigint, jsonb) from public, anon;
grant execute on function public.save_diary(bigint, jsonb) to authenticated;
