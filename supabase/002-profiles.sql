-- Lock-In Party · migration 002: profiles
-- Run this in the Supabase SQL editor if you already ran schema.sql.
-- (schema.sql also includes it, so fresh projects need only that file.)
--
-- A profile is the character you build before you create or join any group:
-- your name, the 24x24 PNG game piece, and the builder choices so it can be
-- edited later. One row per identity (anonymous auth user).

create table if not exists profiles (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  name            text not null,
  avatar_data_url text not null,           -- 24x24 PNG as a data URL
  avatar_options  jsonb,                   -- Sprite options, so the builder can reload them
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table profiles enable row level security;

drop policy if exists "profiles read"   on profiles;
drop policy if exists "profiles insert" on profiles;
drop policy if exists "profiles update" on profiles;
create policy "profiles read"   on profiles for select to authenticated using (true);
create policy "profiles insert" on profiles for insert to authenticated with check (user_id = auth.uid());
create policy "profiles update" on profiles for update to authenticated using (user_id = auth.uid());

create or replace function profiles_touch() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists profiles_touch_trg on profiles;
create trigger profiles_touch_trg before update on profiles for each row execute function profiles_touch();
