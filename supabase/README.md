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

## Later: Whoop or MCP

Insert into `workouts` with `source = 'whoop'` or `'mcp'`. The game rules only count rows per week, so nothing else changes.
