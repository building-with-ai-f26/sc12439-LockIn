-- Lock-In Party · Supabase schema (fresh projects: run this once in the SQL editor)
-- Existing projects: run the numbered migrations instead (002, 003, 004, 005).
-- Also enable: Authentication → Sign In / Providers → Anonymous sign-ins.

create extension if not exists pgcrypto;

-- One 90-day challenge per friend group.
create table if not exists challenges (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  starts_on   date not null default current_date,
  invite_code text not null unique,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now()
);

-- A person in a challenge. One row per device identity (anonymous auth user).
create table if not exists players (
  id              uuid primary key default gen_random_uuid(),
  challenge_id    uuid not null references challenges(id) on delete cascade,
  user_id         uuid not null references auth.users(id),
  name            text not null,
  avatar_data_url text,                       -- 15x24 PNG game piece, copied from profiles at lock-in
  avatar_options  jsonb,                      -- Sprite options, so the leaderboard can draw evolved stages
  goal_type       text,                       -- legacy (pre-004); goals now live in the goals table
  goal_per_week   int check (goal_per_week between 1 and 7),   -- legacy (pre-004)
  goal_text       text not null,              -- human summary of all goals, shown on the leaderboard
  tracking        text not null default 'manual' check (tracking in ('manual', 'whoop', 'apple_health')),
  locked_at       timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  unique (challenge_id, user_id)
);

-- What each player locked in. Several per player. Insert-only: that is the lock.
create table if not exists goals (
  id          uuid primary key default gen_random_uuid(),
  player_id   uuid not null references players(id) on delete cascade,
  type        text not null check (type in ('fitness', 'steps', 'reading', 'dry')),
  per_week    int  not null check (per_week between 1 and 7),   -- workouts, or days, per week
  settings    jsonb,                                            -- e.g. {"steps": 10000} or {"minutes": 20}
  text        text not null,                                    -- "Work out 3× per week"
  created_at  timestamptz not null default now()
);

-- One row per check-in: a workout, a 10k-step day, a reading day, a dry day.
-- Source tells us who wrote it; the game rules don't care.
create table if not exists checkins (
  id          uuid primary key default gen_random_uuid(),
  player_id   uuid not null references players(id) on delete cascade,
  goal_id     uuid references goals(id) on delete cascade,     -- null only on rows from before 004
  happened_at timestamptz not null default now(),
  source      text not null default 'manual' check (source in ('manual', 'whoop', 'mcp')),
  external_id text,                                            -- e.g. the Whoop workout id
  note        text,
  created_at  timestamptz not null default now()
);

create index if not exists checkins_player_idx on checkins (player_id, happened_at);
create index if not exists checkins_goal_idx   on checkins (goal_id, happened_at);
create unique index if not exists checkins_external_idx on checkins (player_id, external_id) where external_id is not null;
create index if not exists players_challenge_idx on players (challenge_id);
create index if not exists goals_player_idx on goals (player_id);

-- Your character, built once before you join any group. One row per identity.
create table if not exists profiles (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  name            text not null,
  avatar_data_url text not null,           -- PNG as a data URL
  avatar_options  jsonb,                   -- Sprite options, so the builder can reload them
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Whoop OAuth tokens. Service role only: RLS on, no policies. See 003-whoop.sql.
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

-- Row Level Security. The anon key is public, so these rules are the real gate.
alter table profiles          enable row level security;
alter table challenges        enable row level security;
alter table players           enable row level security;
alter table goals             enable row level security;
alter table checkins          enable row level security;
alter table whoop_connections enable row level security;

-- Anyone signed in (including anonymously) can read everything. Friends only
-- find a challenge through its invite code; that is the social gate for v1.
drop policy if exists "challenges read"   on challenges;
drop policy if exists "challenges insert" on challenges;
create policy "challenges read"   on challenges for select to authenticated using (true);
create policy "challenges insert" on challenges for insert to authenticated with check (created_by = auth.uid());
-- The creator can rename, re-date (before start), and delete their group.
drop policy if exists "challenges update" on challenges;
drop policy if exists "challenges delete" on challenges;
create policy "challenges update" on challenges for update to authenticated
  using (created_by = auth.uid()) with check (created_by = auth.uid());
create policy "challenges delete" on challenges for delete to authenticated
  using (created_by = auth.uid());

drop policy if exists "profiles read"   on profiles;
drop policy if exists "profiles insert" on profiles;
drop policy if exists "profiles update" on profiles;
create policy "profiles read"   on profiles for select to authenticated using (true);
create policy "profiles insert" on profiles for insert to authenticated with check (user_id = auth.uid());
create policy "profiles update" on profiles for update to authenticated using (user_id = auth.uid());

drop policy if exists "players read"   on players;
drop policy if exists "players insert" on players;
drop policy if exists "players update" on players;
create policy "players read"   on players for select to authenticated using (true);
create policy "players insert" on players for insert to authenticated with check (user_id = auth.uid());
create policy "players update" on players for update to authenticated using (user_id = auth.uid());
-- The group's creator can remove a player (cascades to goals and check-ins).
drop policy if exists "players delete" on players;
create policy "players delete" on players for delete to authenticated
  using (exists (select 1 from challenges c where c.id = challenge_id and c.created_by = auth.uid()));

-- Goals: add to your own player only; no update or delete, ever.
drop policy if exists "goals read"   on goals;
drop policy if exists "goals insert" on goals;
create policy "goals read"   on goals for select to authenticated using (true);
create policy "goals insert" on goals for insert to authenticated
  with check (exists (select 1 from players p where p.id = player_id and p.user_id = auth.uid()));

-- You can only add or remove check-ins for a player row you own.
drop policy if exists "checkins read"   on checkins;
drop policy if exists "checkins insert" on checkins;
drop policy if exists "checkins delete" on checkins;
create policy "checkins read"   on checkins for select to authenticated using (true);
create policy "checkins insert" on checkins for insert to authenticated
  with check (exists (select 1 from players p where p.id = player_id and p.user_id = auth.uid()));
create policy "checkins delete" on checkins for delete to authenticated
  using (exists (select 1 from players p where p.id = player_id and p.user_id = auth.uid()));

-- Goals are locked once set: block changes to the legacy goal columns too.
create or replace function players_lock_goal() returns trigger language plpgsql as $$
begin
  if new.goal_per_week is distinct from old.goal_per_week
     or new.goal_text is distinct from old.goal_text
     or new.goal_type is distinct from old.goal_type then
    raise exception 'Goal is locked in and cannot be changed';
  end if;
  return new;
end $$;
drop trigger if exists players_lock_goal_trg on players;
create trigger players_lock_goal_trg before update on players for each row execute function players_lock_goal();

-- Once a group has started its start date is frozen; code and creator never change.
create or replace function challenges_lock() returns trigger language plpgsql as $$
begin
  if new.starts_on is distinct from old.starts_on and old.starts_on <= current_date then
    raise exception 'The group has already started; its start date cannot change';
  end if;
  if new.invite_code is distinct from old.invite_code or new.created_by is distinct from old.created_by then
    raise exception 'Invite code and creator cannot change';
  end if;
  return new;
end $$;
drop trigger if exists challenges_lock_trg on challenges;
create trigger challenges_lock_trg before update on challenges for each row execute function challenges_lock();

create or replace function profiles_touch() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists profiles_touch_trg on profiles;
create trigger profiles_touch_trg before update on profiles for each row execute function profiles_touch();
drop trigger if exists whoop_connections_touch_trg on whoop_connections;
create trigger whoop_connections_touch_trg before update on whoop_connections for each row execute function profiles_touch();
