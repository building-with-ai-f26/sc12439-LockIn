# AGENTS.md — Coding Agent Operating Manual

> Give this file to your coding agent and check that it is using these instructions. Keep the stack, commands, and ground rules current.

## 1. Project Overview
- **What this repo builds:** Lock-In Party, an 8-bit party game where a friend group locks in 90-day goals (workouts per week, 10,000-step days, reading days, dry days), checks in daily, and evolves their characters Pokémon-style: a week where every goal is met raises Lock-in Power (LP), streaks evolve you, misses drain LP and can devolve you. Highest LP on day 90 wins. Build 1 ships the product page plus a throwaway prototype, 8-Bit Me, that turns a photo into a pixel-art game piece.
- **Primary user & core workflow:** [See the living PRD in `docs/index.html`]
- **Tech stack:** Static HTML/CSS/JS in `docs/`, published with GitHub Pages. Supabase (Postgres + anonymous auth + RLS) as the shared backend, called from the browser with supabase-js. Node 23 for tests. A GitHub Actions cron (`scripts/whoop-sync.mjs`) pulls Whoop workouts nightly using the Supabase service role key held in repo secrets.

## 2. Commands
- **Install dependencies:** none (no packages yet)
- **Run locally:** `python3 -m http.server 8000 --directory docs` then open http://localhost:8000/game.html (needs `docs/supabase-config.js` filled in, see `supabase/README.md`; analytics need a key in `docs/posthog-config.js`, empty disables them) or http://localhost:8000/prototype.html
- **Monkey art:** generated PNGs in `docs/images/monkeys/` with fixed reference hues; see `docs/MONKEYS.md`. `docs/monkey.js` recolours at draw time. Never hand-edit the PNGs.
- **Run deterministic tests:** `node --test "tests/*.test.cjs"`
- **Live smoke test (hits the real Supabase project; deletes its own group, leaves two Smoke* profiles):** `node scripts/smoke-live.mjs docs/supabase-config.js`
- **Database changes:** new SQL goes in a numbered file under `supabase/` and is pasted into the Supabase SQL editor by the human; verify with a curl against the REST API before relying on it. Current: `005-groups.sql`.
- **Whoop:** `node scripts/whoop-connect.mjs` (one-time login per person), `node scripts/whoop-sync.mjs --force` (pull now). Needs `.env` from `.env.example`; nightly run is `.github/workflows/whoop-sync.yml`. See `docs/WHOOP.md`.
- **Run model evals:** not applicable yet (no model calls in Build 1)

## 3. Non-Negotiable Engineering Rules
1. **Plan before coding:** Before touching multiple files, propose a brief plan and wait for approval.
2. **Small batches:** Make small, focused changes that can be reviewed and explained by a human in a single Pull Request.
3. **Explainability:** Avoid unnecessary abstractions or dependencies. Help the human builder understand the main components, what changed, why it matters, what could break, and how it was checked.
4. **Verify changes:** Run relevant checks. For a reproducible logic bug, use a failing test to demonstrate the fix when practical. Record manual checks and known limitations; follow the selected Build 4 evaluation track.
5. **Zero secrets in code:** Never hardcode API keys, tokens, or credentials. Always read from environment variables (`.env`) and update `.env.example` when new variables are needed.
6. **Stop when looping:** If a fix fails twice in a row, stop, summarize what failed, and ask the human before trying a third approach.

## 4. Shipping (how a change reaches the live site)
Hosting is GitHub Pages serving `docs/` on `main`; there is no build step and no server. Database is one Supabase project (free tier) used by both local and live, so treat it as production.
1. Run `node --test "tests/*.test.cjs"`; all must pass.
2. If the change needs a schema change, write it as the next numbered `supabase/00N-*.sql`, back up first (`node scripts/backup.mjs backups/lockin-<date>.json`), and **ask the human to paste it into the Supabase SQL editor** before the page that depends on it is pushed. Verify with a curl against the REST API.
3. If `docs/*.html` changed, regenerate the harness copy and screenshot in headless Chrome (see `scripts/` and the scratchpad notes) rather than trusting the diff.
4. Commit in small batches with a message that says what changed and why. Push to `main`; Pages redeploys in about a minute.
5. Verify the live site: `curl -s https://building-with-ai-f26.github.io/sc12439-LockIn/<file>` shows the new content, then open the game on a phone and run the core workflow (character → group → goals → check-in).
6. After any RLS or policy change, re-run `node scripts/security-test.mjs` against the live project and paste the output into `SECURITY.md`.
7. Roll back with `git revert <sha>` and push; Pages redeploys the previous files. Schema changes are rolled back with a new migration, never by editing an old one.

## 5. Ask me first
Stop and ask before any of these, even if an earlier approval covered something similar:
- Deleting or overwriting data in Supabase (rows, tables, groups, check-ins), or running any migration. Always back up first.
- Anything touching keys, secrets or permissions: rotating the service role key, Whoop secret, PostHog key, GitHub secrets, RLS policies, repo settings.
- Anything that costs money or could: paid API calls, upgrading a plan, adding a card, new paid services.
- Force-pushing, rewriting history, or deleting branches.
- Turning on PostHog session replay or any new data collection (privacy.html promises no screen recording).
- Posting anything outward: Whoop app changes, emails, PRs on other repos.

## 6. Rules learned from real agent mistakes
- **Do not gate a scheduled job on the wall clock.** The nightly Whoop sync checked "is it the 11 PM hour" and GitHub started the cron 8 hours late on 10 Nov 2026, so the night was silently skipped. Scheduled runs now always sync; the job is idempotent instead of time-guarded.
- **Verify against the live file, not a copy.** Harness screenshots were taken from stale copies of `docs/game.html`, so a verified-looking change had not actually been tested. Regenerate the harness page from `docs/` every time.
- **A migration is not applied until the API says so.** Twice SQL went into chat instead of the SQL editor and the live API returned 404. Curl the REST endpoint before building on a schema change.
- **macOS BSD sed has no `\|` alternation.** It matches nothing and exits 0. Use separate `-e` expressions or a Python patch script that asserts the match count.
- **Never write a secret into the repo folder unless it is git-ignored**, and check with `git check-ignore` before writing. Backups contain Whoop tokens and live in `backups/` for that reason.
