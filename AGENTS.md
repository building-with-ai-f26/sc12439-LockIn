# AGENTS.md — Coding Agent Operating Manual

> Give this file to your coding agent and check that it is using these instructions. Keep the stack, commands, and ground rules current.

## 1. Project Overview
- **What this repo builds:** Lock-In Party, an 8-bit party game where a friend group locks in 90-day goals (workouts per week, 10,000-step days, reading days, dry days), checks in daily, and evolves their characters Pokémon-style: a week where every goal is met raises Lock-in Power (LP), streaks evolve you, misses drain LP and can devolve you. Highest LP on day 90 wins. Build 1 ships the product page plus a throwaway prototype, 8-Bit Me, that turns a photo into a pixel-art game piece.
- **Primary user & core workflow:** [See the living PRD in `docs/index.html`]
- **Tech stack:** Static HTML/CSS/JS in `docs/`, published with GitHub Pages. Supabase (Postgres + anonymous auth + RLS) as the shared backend, called from the browser with supabase-js. Node 23 for tests. A GitHub Actions cron (`scripts/whoop-sync.mjs`) pulls Whoop workouts nightly using the Supabase service role key held in repo secrets.

## 2. Commands
- **Install dependencies:** none (no packages yet)
- **Run locally:** `python3 -m http.server 8000 --directory docs` then open http://localhost:8000/game.html (needs `docs/supabase-config.js` filled in, see `supabase/README.md`; analytics need a key in `docs/posthog-config.js`, empty disables them) or http://localhost:8000/prototype.html
- **Run deterministic tests:** `node --test "tests/*.test.cjs"`
- **Live smoke test (hits the real Supabase project, leaves a SMOKE* group to delete):** `node scripts/smoke-live.mjs docs/supabase-config.js`
- **Database changes:** new SQL goes in a numbered file under `supabase/` and is pasted into the Supabase SQL editor by the human; verify with a curl against the REST API before relying on it. Current: `004-goals.sql`.
- **Whoop:** `node scripts/whoop-connect.mjs` (one-time login per person), `node scripts/whoop-sync.mjs --force` (pull now). Needs `.env` from `.env.example`; nightly run is `.github/workflows/whoop-sync.yml`. See `docs/WHOOP.md`.
- **Run model evals:** not applicable yet (no model calls in Build 1)

## 3. Non-Negotiable Engineering Rules
1. **Plan before coding:** Before touching multiple files, propose a brief plan and wait for approval.
2. **Small batches:** Make small, focused changes that can be reviewed and explained by a human in a single Pull Request.
3. **Explainability:** Avoid unnecessary abstractions or dependencies. Help the human builder understand the main components, what changed, why it matters, what could break, and how it was checked.
4. **Verify changes:** Run relevant checks. For a reproducible logic bug, use a failing test to demonstrate the fix when practical. Record manual checks and known limitations; follow the selected Build 4 evaluation track.
5. **Zero secrets in code:** Never hardcode API keys, tokens, or credentials. Always read from environment variables (`.env`) and update `.env.example` when new variables are needed.
6. **Stop when looping:** If a fix fails twice in a row, stop, summarize what failed, and ask the human before trying a third approach.
