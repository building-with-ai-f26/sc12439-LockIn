-- Migration 006 · security audit fixes (written 2026-11-23, see SECURITY.md)
--
-- NOT YET APPLIED. The join screen in docs/game.js still looks a group up with
-- select ... eq("invite_code", code); apply this migration in the same change
-- that switches it to  sb.rpc("find_challenge", { code })  or joining breaks.
--
-- 1. Invite codes stop being readable: a challenge row is visible only to its
--    members and creator. Joining goes through find_challenge(code), which
--    returns just the id, name and start date for one exact code.
-- 2. Players, goals and check-ins are readable only inside groups you are in;
--    profiles only by their owner.
-- 3. A check-in must point at a goal of the same player, and anything the
--    browser inserts is source = 'manual' (the Whoop sync uses the service
--    role, which bypasses RLS, so it is unaffected).

create or replace function is_member(cid uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from players where challenge_id = cid and user_id = auth.uid())
$$;

create or replace function find_challenge(code text)
returns table (id uuid, name text, starts_on date)
language sql security definer stable set search_path = public as $$
  select id, name, starts_on from challenges where invite_code = upper(trim(code))
$$;
revoke all on function find_challenge(text) from public;
grant execute on function find_challenge(text) to authenticated;

drop policy if exists "challenges read" on challenges;
create policy "challenges read" on challenges for select to authenticated
  using (created_by = auth.uid() or is_member(id));

drop policy if exists "players read" on players;
create policy "players read" on players for select to authenticated
  using (user_id = auth.uid() or is_member(challenge_id));

drop policy if exists "goals read" on goals;
create policy "goals read" on goals for select to authenticated
  using (exists (select 1 from players p where p.id = player_id and (p.user_id = auth.uid() or is_member(p.challenge_id))));

drop policy if exists "checkins read" on checkins;
create policy "checkins read" on checkins for select to authenticated
  using (exists (select 1 from players p where p.id = player_id and (p.user_id = auth.uid() or is_member(p.challenge_id))));

drop policy if exists "profiles read" on profiles;
create policy "profiles read" on profiles for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "checkins insert" on checkins;
create policy "checkins insert" on checkins for insert to authenticated
  with check (
    source = 'manual'
    and exists (select 1 from players p where p.id = player_id and p.user_id = auth.uid())
    and (goal_id is null or exists (select 1 from goals g where g.id = goal_id and g.player_id = player_id))
  );
