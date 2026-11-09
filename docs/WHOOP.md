# Whoop sync: workouts logged for you at 11:59 PM Eastern

Every night a GitHub Action pulls each connected person's Whoop workouts from the last 3 days and logs any new one of 20+ minutes into the game with `source = 'whoop'`. The game rules are unchanged: a Whoop row counts exactly like a tapped "I worked out today".

## One-time setup (owner, about 10 minutes)

1. **Database.** Supabase → SQL Editor → paste `supabase/003-whoop.sql` → Run.
2. **Whoop app.** Sign in at https://developer.whoop.com with your Whoop account → Create app.
   - Name: Lock-In Party. Scopes: `offline`, `read:workout`, `read:profile`.
   - Redirect URL: `https://building-with-ai-f26.github.io/sc12439-LockIn/whoop-callback.html`
   - Copy the Client ID and Client Secret.
   - Development apps can connect up to 10 Whoop members. Plenty for a friend group.
3. **Local .env.** `cp .env.example .env`, fill in `SUPABASE_SERVICE_ROLE_KEY` (Supabase → Project Settings → API Keys → service_role), `WHOOP_CLIENT_ID`, `WHOOP_CLIENT_SECRET`. `.env` is git-ignored. Never paste the service role key anywhere under `docs/`.
4. **GitHub secrets.** Repo → Settings → Secrets and variables → Actions → New repository secret, four times: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `WHOOP_CLIENT_ID`, `WHOOP_CLIENT_SECRET`. Optional variable (not secret) `WHOOP_MIN_MINUTES` to change the 20-minute threshold.

## Connect a person (1 minute each)

```
node scripts/whoop-connect.mjs
```

Pick the person's game name, open the link it prints, approve on Whoop, copy the code from the callback page, paste it back. For a friend: send them the link, they approve and send you the code. They need to have built their character in the game first.

Test immediately, ignoring the 11 PM guard:

```
node scripts/whoop-sync.mjs --force
```

## What runs when

- `.github/workflows/whoop-sync.yml` fires at 03:59 and 04:59 UTC. The script checks New York time and only syncs during the 11 PM hour, so it is 11:59 PM EST and EDT alike. GitHub may delay a scheduled run by some minutes; the 3-day window makes that harmless.
- Each run refreshes the Whoop tokens (they rotate), saves the new pair, pulls workouts, inserts with `on conflict ignore` on `(player_id, external_id)` so nothing double counts, and records `last_synced_at` or `last_error` on the connection.
- Run it by hand any time: Actions tab → Whoop nightly sync → Run workflow.

## Checking on it

- Actions tab shows each night's log: how many Whoop workouts were found, how many were eligible, how many were new.
- In Supabase, `select user_id, last_synced_at, last_error from whoop_connections;`
- A workout under 20 minutes is skipped on purpose. Change `WHOOP_MIN_MINUTES` if your group disagrees.

## Disconnect

`delete from whoop_connections where user_id = '…';` in the SQL editor, and revoke the app in the Whoop app settings.
