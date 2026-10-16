-- Account-scoped Groq credentials. Only AES-256-GCM ciphertext is stored here.
-- The encryption key lives in the server environment, never in Supabase/client JS.
begin;
create table if not exists public.assistant_credentials (
  user_id uuid primary key references auth.users(id) on delete cascade,
  encrypted_key text not null check (
    length(encrypted_key) <= 512 and
    encrypted_key ~ '^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$'
  ),
  updated_at timestamptz not null default now()
);
alter table public.assistant_credentials enable row level security;
revoke all on public.assistant_credentials from public, anon, authenticated;
grant select, insert, update, delete on public.assistant_credentials to authenticated;
drop policy if exists "Own encrypted assistant key" on public.assistant_credentials;
create policy "Own encrypted assistant key" on public.assistant_credentials
for all to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
commit;
