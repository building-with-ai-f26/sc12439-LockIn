-- Lock-In Party · Supabase schema
-- Run this once in the Supabase SQL editor for your project.
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
  avatar_data_url text,                       -- 32x32 PNG from 8-Bit Me, as a data URL
  goal_type       text not null default 'fitness' check (goal_type in ('fitness')),
  goal_per_week   int  not null check (goal_per_week between 1 and 7),
  goal_text       text not null,
  locked_at       timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  unique (challenge_id, user_id)
);

-- One row per workout. Source tells us who wrote it; game rules don't care.
create table if not exists workouts (
  id          uuid primary key default gen_random_uuid(),
  player_id   uuid not null references players(id) on delete cascade,
  happened_at timestamptz not null default now(),
  source      text not null default 'manual' check (source in ('manual', 'whoop', 'mcp')),
  note        text,
  created_at  timestamptz not null default now()
);

create index if not exists workouts_player_idx on workouts (player_id, happened_at);
create index if not exists players_challenge_idx on players (challenge_id);

-- Row Level Security. The anon key is public, so these rules are the real gate.
alter table challenges enable row level security;
alter table players    enable row level security;
alter table workouts   enable row level security;

-- Anyone signed in (including anonymously) can read everything. Friends only
-- find a challenge through its invite code; that is the social gate for v1.
drop policy if exists "challenges read"   on challenges;
drop policy if exists "challenges insert" on challenges;
create policy "challenges read"   on challenges for select to authenticated using (true);
create policy "challenges insert" on challenges for insert to authenticated with check (created_by = auth.uid());

drop policy if exists "players read"   on players;
drop policy if exists "players insert" on players;
drop policy if exists "players update" on players;
create policy "players read"   on players for select to authenticated using (true);
create policy "players insert" on players for insert to authenticated with check (user_id = auth.uid());
create policy "players update" on players for update to authenticated using (user_id = auth.uid());

-- You can only add or remove workouts for a player row you own.
drop policy if exists "workouts read"   on workouts;
drop policy if exists "workouts insert" on workouts;
drop policy if exists "workouts delete" on workouts;
create policy "workouts read"   on workouts for select to authenticated using (true);
create policy "workouts insert" on workouts for insert to authenticated
  with check (exists (select 1 from players p where p.id = player_id and p.user_id = auth.uid()));
create policy "workouts delete" on workouts for delete to authenticated
  using (exists (select 1 from players p where p.id = player_id and p.user_id = auth.uid()));

-- Goals are locked once set: block changes to the goal columns.
create or replace function players_lock_goal() returns trigger language plpgsql as $$
begin
  if new.goal_per_week <> old.goal_per_week or new.goal_text <> old.goal_text or new.goal_type <> old.goal_type then
    raise exception 'Goal is locked in and cannot be changed';
  end if;
  return new;
end $$;
drop trigger if exists players_lock_goal_trg on players;
create trigger players_lock_goal_trg before update on players for each row execute function players_lock_goal();
