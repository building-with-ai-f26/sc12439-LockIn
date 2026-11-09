# Lock-In Party

> **One-line pitch:** An 8-bit party game for a friend group that locks in 90-day goals: workouts, 10,000 steps, reading, no drinking. Check in daily (or let Whoop log workouts for you), keep your Lock-in Power high, and evolve your character Pokémon-style by holding a streak.

- **Builder:** Sheshu Chandrasekar (`@schandr47`)
- **Pod:** TODO
- **Product Page & Living PRD:** https://building-with-ai-f26.github.io/sc12439-LockIn/
- **Play:** https://building-with-ai-f26.github.io/sc12439-LockIn/game.html
- **Character builder:** https://building-with-ai-f26.github.io/sc12439-LockIn/character.html

## How the game works

1. **Build your character.** A full-body 15×24 pixel sprite: hair, face, glasses, top, bottoms, shoes, colours. Upload a photo and it suggests your skin and hair tone.
2. **Create or join a group** with an invite code or link.
3. **Lock in your goals** for 90 days: workouts per week, 10,000-step days, reading days, dry days, in any combination, each with its own weekly target. They cannot be changed afterwards.
4. **Choose how you track.** Connect a Whoop and the nightly sync logs workouts of 30+ minutes (walks excluded) for you; Apple Health is coming later; or tap it in by hand. Steps, reading and dry days are always tapped in, once per day.
5. **Keep your LP up.** Everyone starts at 50 Lock-in Power. Hit every goal in a week, +10. Miss any, −15. Three hit weeks in a row evolves you to RISING, seven to LOCKED IN. Break the streak or hit 0 LP and you devolve.
6. **Highest LP on day 90 wins.** The leaderboard shows everyone's stage, LP and streak.
7. **Several groups, one character.** Switch between your groups from the play screen or start another. Whoever created a group can rename it, move the start date before day one, remove a member or delete it.

All game math is derived from check-in rows; nothing is stored as state. See `docs/game-rules.js`.

## Repository map

| File / folder | Purpose |
| --- | --- |
| [`docs/`](./docs/) | The whole site, served by GitHub Pages: product page + PRD (`index.html`), game (`game.html`, `game.js`), rules (`game-rules.js`), sprite system (`sprite.js`, `character-ui.js`), builder (`character.html`), Whoop callback, privacy page, analytics. |
| [`supabase/`](./supabase/) | Database schema and migrations (`schema.sql`, `002-profiles.sql`, `003-whoop.sql`, `004-goals.sql`, `005-groups.sql`) and setup steps. |
| [`scripts/`](./scripts/) | Whoop nightly sync, one-time Whoop connect, live smoke test. |
| [`.github/workflows/whoop-sync.yml`](./.github/workflows/whoop-sync.yml) | Cron that runs the Whoop sync at 11:59 PM Eastern. |
| [`tests/`](./tests/) | Node tests for rules, sprites, pixelation and Whoop mapping. |
| [`docs/WHOOP.md`](./docs/WHOOP.md) | Whoop setup guide. |
| [`AGENTS.md`](./AGENTS.md) | Run commands, stack, and rules for coding agents. |
| [`Intent.md`](./Intent.md), [`Plan.md`](./Plan.md), [`journal/`](./journal/) | Course drafting aids. |
| [`SPONSOR_MEMO.md`](./SPONSOR_MEMO.md) | One-page recommendation, due December 14. |

Course instructions and submissions live on [Icerynk](https://www.icerynk.com/c/fa26-tech-gb-2160-dm2-f2/content).

## Stack

Static HTML/CSS/JS, no build step. Supabase (Postgres, anonymous auth, Row Level Security) as the shared backend, called from the browser with supabase-js. GitHub Pages for hosting, GitHub Actions for the nightly Whoop sync, PostHog for analytics. Node 22+ for tests and scripts. Cost so far: $0, all free tiers.

## Local setup

```bash
git clone https://github.com/building-with-ai-f26/sc12439-LockIn.git
cd sc12439-LockIn
python3 -m http.server 8000 --directory docs
# open http://localhost:8000/game.html
```

The browser app needs no secrets: `docs/supabase-config.js` holds the public Supabase URL and anon key, `docs/posthog-config.js` the public PostHog key. To point at your own Supabase project, follow [`supabase/README.md`](./supabase/README.md).

Tests:

```bash
node --test "tests/*.test.cjs"
```

Whoop sync (optional, needs a Whoop developer app and the Supabase service role key in a local `.env`, see [`docs/WHOOP.md`](./docs/WHOOP.md)):

```bash
cp .env.example .env            # fill in the blanks
node scripts/whoop-connect.mjs  # one-time login per person
node scripts/whoop-sync.mjs --force
```

Keep `SUPABASE_SERVICE_ROLE_KEY` and `WHOOP_CLIENT_SECRET` out of `docs/`, screenshots and commits. `.env` is git-ignored; `.env.example` has placeholders only.

## Build status

| Build | Status |
| --- | --- |
| 1 · Intent & prototype | Shipped. Product page, PRD v1, 8-Bit Me photo pixelator. |
| 2 · Smallest local version | Shipped. Full game loop on Supabase, character builder, Pokémon-style LP and evolution, four goal types, Whoop sync, PostHog. |
| 3 onward | See the build log on the product page. |
