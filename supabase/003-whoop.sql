-- Lock-In Party · migration 003: Whoop sync
-- Run this in the Supabase SQL editor. Safe to run more than once.

-- Where a workout came from, so re-syncs never double count. Manual rows leave it null.
alter table workouts add column if not exists external_id text;
create unique index if not exists workouts_external_idx
  on workouts (player_id, external_id) where external_id is not null;

-- One Whoop login per identity. Tokens rotate on every refresh, so the sync
-- job rewrites this row each night.
create table if not exists whoop_connections (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  whoop_user_id  bigint,
  access_token   text not null,
  refresh_token  text not null,
  expires_at     timestamptz not null,
  last_synced_at timestamptz,
  last_error     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- RLS on, and deliberately no policies: the browser (anon key) can never read
-- or write tokens. Only the service role used by the GitHub Action can.
alter table whoop_connections enable row level security;

drop trigger if exists whoop_connections_touch_trg on whoop_connections;
create trigger whoop_connections_touch_trg before update on whoop_connections
  for each row execute function profiles_touch();
