# Security audit · Lock-In Party

Audited 2026-11-23 against the live site https://building-with-ai-f26.github.io/sc12439-LockIn/ and the live Supabase project. Lane: **Beginner** (GitHub Pages + Supabase free tier).

## What kind of app

**Sign-in with saved data.** Every phone signs in to Supabase anonymously (no password, no email) and gets its own identity. The browser talks to Postgres directly with the public anon key; Row Level Security (RLS) on every table is the gate. A nightly GitHub Action uses the service role key to write Whoop workouts and step days. No AI calls, no file storage, no payments.

## What I checked

| Check | How | Result |
| --- | --- | --- |
| Public key, nobody signed in: read, insert, delete | REST calls with only the anon key | Reads return 0 rows, insert rejected (401, RLS), delete affects 0 rows |
| Account B reads / writes Account A's data | Fresh anonymous sign-in B attacks Sheshu's rows | All 9 writes refused; A's rows unchanged (see attack log) |
| Whoop tokens reachable from the browser | Select on `whoop_connections` as anon and as B | 0 rows both times (RLS on, no policies) |
| Secret keys in the repo | grep for `sb_secret_`, `service_role`, `sk-or-`, `sk-ant-`, `sk-proj-`, `sk_live_`, JWTs, Whoop secret | Only comments and a template placeholder. `.env` is git-ignored |
| Secret keys in git history | same grep over `git log -p --all` | Only the template's `sk-or-v1-replace-with-your-key` placeholder |
| Secret keys on the live site | downloaded all 17 published files and grepped | None. Only the Supabase anon key, PostHog `phc_` key and Whoop client id, all public by design |
| Dependencies | `npm audit` / `pip-audit` | No package.json and no pip packages: the site has zero npm dependencies. supabase-js 2.118.0 and PostHog are loaded from their CDNs, pinned by version |
| Manual backup | `backups/lockin-2026-11-23.json` (git-ignored, mode 600) | 2 challenges, 5 players, 15 goals, 26 check-ins, 5 profiles, 2 Whoop connections |
| Spending caps | No paid API in the app. Supabase, GitHub, PostHog on free tiers with no card attached | Nothing can bill |
| Rate limits | Supabase's built-in API limits only | See remaining issues |

## Attack log (live site, public key only, 2026-11-23 16:38 UTC)

```
## Test 1: nobody signed in (plain public key)
1a read players                                      200  0 row(s)
1b insert a check-in                                 401  42501 new row violates row-level security policy for table "checkins"
1c delete every check-in                             200  0 row(s) affected
1d read Whoop tokens                                 200  0 row(s)

## Test 2: account B (fresh anonymous sign-in) attacks account A (Sheshu)
2a B reads A's check-ins (shared board, by design)   200  1 row(s) visible
2b B inserts a check-in for A                        403  42501 new row violates row-level security policy for table "checkins"
2c B deletes A's check-in                            200  0 row(s) affected
2d B renames A's player                              200  0 row(s) affected
2e B deletes A's group                               200  0 row(s) affected
2f B renames A's group                               200  0 row(s) affected
2g B reads Whoop tokens                              200  0 row(s)
2h B adds a goal to A's player                       403  42501 new row violates row-level security policy for table "goals"
2i B lists every invite code                         200  2 row(s) returned      <-- finding
2j B edits A's profile                               200  0 row(s) affected

Verify A untouched: A player name: Sheshu · A check-in still present: true
```

Supabase returns 200 with zero rows for a delete or update that RLS filters out, so "0 row(s) affected" is the blocked case. The script is `scripts/security-test.mjs`; it only uses the public key and only tries writes RLS must refuse.

## What I found

1. **Invite codes are readable by any signed-in account (2i).** Every table's read policy is `using (true)` for authenticated users, so a fresh anonymous account can list all groups' invite codes and join any group, and can read every group's board, not just its own. Writes are still locked to your own rows, so the damage is reading and joining, not editing.
2. **A check-in can point at another player's goal.** The insert policy checks the `player_id` is yours but not that `goal_id` belongs to the same player. A player could log check-ins against a groupmate's goal row to nudge their weekly count.
3. **A browser can set `source = 'whoop'`.** Nothing stops a manual check-in from claiming it came from Whoop. Cosmetic today, but it would make the Whoop sync's dedupe (by `external_id`) spoofable.
4. **Session replay is off.** PostHog runs on every page (pageviews, autocapture, named events) but `disable_session_recording: true` and the privacy page promises no screen recording. Kept off deliberately: the players are my friends and the board shows their drinking and workout habits.

## What I fixed

- Wrote **migration `supabase/006-security.sql`** for findings 1 to 3: challenge rows visible only to their members and creator, a `find_challenge(code)` function for joining, player/goal/check-in reads scoped to groups you are in, profiles readable only by their owner, check-ins must point at your own goal, and browser inserts are forced to `source = 'manual'`. **Not applied yet**: the join screen must switch from selecting by `invite_code` to calling `find_challenge` first, or joining breaks. Both land together in Build 4 (see remaining issues).
- Added the **manual backup** script and a git-ignored `backups/` folder, and the attack script `scripts/security-test.mjs` so the audit can be re-run after every migration.
- `AGENTS.md` gained a Shipping section, an "Ask me first" list (data deletion, keys, money, production database) and rules from real agent mistakes.
- Confirmed the service role key and Whoop client secret live only in the git-ignored `.env` and GitHub Actions secrets, never in `docs/` or history.

## Remaining issues

- **Finding 1 is open until migration 006 and the join-screen change ship together.** Until then an invite code is only as secret as "anyone who signs in anonymously and queries the API". Acceptable for two friend groups this week, not for a public launch.
- **No per-visitor rate limit** on writes. Supabase's default API rate limiting is the only cap; a hostile client could spam its own check-ins. Low value target (it only inflates its own score), but a `checkins` per-day cap in a trigger is the planned fix.
- **Identity is per device.** Clearing site data or switching phones means a new anonymous account and a new player. No account recovery exists.
- **Backups are manual.** Re-run `node scripts/backup.mjs backups/lockin-<date>.json` before any migration; the free plan has no automatic backups.
