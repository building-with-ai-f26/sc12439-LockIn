-- Migration 005 · group management (run once in the Supabase SQL editor)
--
-- The person who created a group can now rename it, move its start date
-- (only before it starts), remove a member, and delete the whole group.
-- Deleting a group cascades to its players, goals and check-ins; Whoop
-- connections belong to people, not groups, and are untouched.

-- Creator-only update and delete on challenges.
drop policy if exists "challenges update" on challenges;
drop policy if exists "challenges delete" on challenges;
create policy "challenges update" on challenges for update to authenticated
  using (created_by = auth.uid()) with check (created_by = auth.uid());
create policy "challenges delete" on challenges for delete to authenticated
  using (created_by = auth.uid());

-- The creator can remove any player in their group (cascades to goals and check-ins).
drop policy if exists "players delete" on players;
create policy "players delete" on players for delete to authenticated
  using (exists (select 1 from challenges c where c.id = challenge_id and c.created_by = auth.uid()));

-- Once a group has started its start date is frozen, so nobody's scored
-- weeks shift under them. The invite code and creator never change.
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
