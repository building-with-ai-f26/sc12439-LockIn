# Supabase setup (about 5 minutes)

The game page (`docs/game.html`) talks to Supabase straight from the browser.

1. Go to https://supabase.com, sign in, **New project**. Free tier is fine. Pick any name and a strong database password (you won't need it again for this app).
2. In the left sidebar open **SQL Editor → New query**, paste the whole of `supabase/schema.sql`, click **Run**. It should finish with "Success. No rows returned".
3. Open **Authentication → Sign In / Providers**, find **Anonymous sign-ins**, turn it **on**, save. Each friend's phone becomes an anonymous user; no passwords.
4. Open **Project Settings → API** (or **Connect** at the top). Copy the **Project URL** and the **anon public** key.
5. Paste both into `docs/supabase-config.js`, commit, push. GitHub Pages redeploys and the game is live.

## Already set up before the Pokémon update?

Run `supabase/002-profiles.sql` in the SQL editor once. It adds the `profiles` table that stores your character before you join a group. Existing challenges, players and workouts are untouched.

## Is the anon key a secret?

No. Supabase designs the anon key to ship in browser code. What protects the data is Row Level Security, which `schema.sql` turns on: anyone can read the board, but you can only insert or delete workouts for your own player row. Never put the **service_role** key anywhere in this repo.

## Already set up before the goals update?

Run `supabase/004-goals.sql` once. It adds the `goals` table, renames `workouts` to `checkins` with a `goal_id`, gives every existing player a workouts goal copied from their old weekly target, attaches their workouts to it, and adds `players.tracking` (manual, whoop, apple_health). Run it **before** deploying the new game page, or the page will look for a table that is not there yet.

## Whoop sync

Run `supabase/003-whoop.sql` once, then follow `docs/WHOOP.md`. A nightly GitHub Action inserts into `checkins` against each player's workouts goal with `source = 'whoop'` and the Whoop workout id in `external_id`. The game rules only count rows per goal per week, so nothing else changes. Any future source (an MCP tool, another wearable) should do the same.
