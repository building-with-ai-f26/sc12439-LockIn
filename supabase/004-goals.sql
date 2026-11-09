-- Migration 004 · goals and check-ins (run once in the Supabase SQL editor)
--
-- Players can now lock in several goals: workouts per week, 10,000-step days,
-- reading days, dry days. Each goal is a row in `goals`. The old `workouts`
-- table becomes `checkins` and every row points at the goal it counts toward.
-- Existing players get a workouts goal copied from their old goal_per_week,
-- and their existing workouts are attached to it, so nothing is lost.

create table if not exists goals (
  id          uuid primary key default gen_random_uuid(),
  player_id   uuid not null references players(id) on delete cascade,
  type        text not null check (type in ('fitness', 'steps', 'reading', 'dry')),
  per_week    int  not null check (per_week between 1 and 7),   -- workouts, or days, per week
  settings    jsonb,                                            -- e.g. {"steps": 10000} or {"minutes": 20}
  text        text not null,                                    -- "Work out 3× per week"
  created_at  timestamptz not null default now()
);
create index if not exists goals_player_idx on goals (player_id);

-- workouts → checkins
alter table if exists workouts rename to checkins;
alter table checkins add column if not exists goal_id uuid references goals(id) on delete cascade;
alter index if exists workouts_player_idx   rename to checkins_player_idx;
alter index if exists workouts_external_idx rename to checkins_external_idx;
create index if not exists checkins_goal_idx on checkins (goal_id, happened_at);

-- Backfill: one workouts goal per existing player, and attach their rows to it.
insert into goals (player_id, type, per_week, text)
select p.id, 'fitness', p.goal_per_week, p.goal_text
from players p
where p.goal_per_week is not null
  and not exists (select 1 from goals g where g.player_id = p.id);
update checkins c set goal_id = g.id
from goals g
where g.player_id = c.player_id and g.type = 'fitness' and c.goal_id is null;

-- Players: the single-goal columns become optional; goal_text stays as a summary.
alter table players alter column goal_per_week drop not null;
alter table players drop constraint if exists players_goal_type_check;
alter table players add column if not exists tracking text not null default 'manual'
  check (tracking in ('manual', 'whoop', 'apple_health'));

-- The lock trigger must cope with nulls now.
create or replace function players_lock_goal() returns trigger language plpgsql as $$
begin
  if new.goal_per_week is distinct from old.goal_per_week
     or new.goal_text is distinct from old.goal_text
     or new.goal_type is distinct from old.goal_type then
    raise exception 'Goal is locked in and cannot be changed';
  end if;
  return new;
end $$;

-- RLS: everyone signed in can read goals; you can only add goals to your own
-- player row; nobody can update or delete them (that is what "locked" means).
alter table goals enable row level security;
drop policy if exists "goals read"   on goals;
drop policy if exists "goals insert" on goals;
create policy "goals read"   on goals for select to authenticated using (true);
create policy "goals insert" on goals for insert to authenticated
  with check (exists (select 1 from players p where p.id = player_id and p.user_id = auth.uid()));

-- Tidy the renamed table's policy names (they still work under the old names).
do $$ begin
  alter policy "workouts read"   on checkins rename to "checkins read";
  alter policy "workouts insert" on checkins rename to "checkins insert";
  alter policy "workouts delete" on checkins rename to "checkins delete";
exception when undefined_object then null; end $$;
