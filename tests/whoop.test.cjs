// Tests for scripts/whoop-lib.cjs. Run with: node --test "tests/*.test.cjs"
const test = require("node:test");
const assert = require("node:assert/strict");
const W = require("../scripts/whoop-lib.cjs");

const rec = (over) => Object.assign({
  id: "8f5b4a1e-0000-4000-8000-000000000001", start: "2026-11-09T22:00:00.000Z", end: "2026-11-09T22:45:00.000Z",
  sport_name: "running", score_state: "SCORED", score: { strain: 12.37 }
}, over);

test("11:59 PM Eastern guard handles EST and EDT", () => {
  assert.equal(W.isElevenPmEastern(new Date("2026-01-15T04:59:00Z")), true);   // 23:59 EST
  assert.equal(W.isElevenPmEastern(new Date("2026-01-15T03:59:00Z")), false);  // 22:59 EST
  assert.equal(W.isElevenPmEastern(new Date("2026-07-15T03:59:00Z")), true);   // 23:59 EDT
  assert.equal(W.isElevenPmEastern(new Date("2026-07-15T04:59:00Z")), false);  // 00:59 EDT
  assert.equal(W.isElevenPmEastern(new Date("2026-07-15T04:05:00Z")), false);  // a late run past midnight is skipped
});

test("sync window trails 3 days by default", () => {
  const w = W.syncWindow(new Date("2026-11-10T04:59:00Z"));
  assert.equal(w.end, "2026-11-10T04:59:00.000Z");
  assert.equal(w.start, "2026-11-07T04:59:00.000Z");
  assert.equal(W.syncWindow(new Date("2026-11-10T00:00:00Z"), 1).start, "2026-11-09T00:00:00.000Z");
});

test("records map to one row per player with source whoop and the Whoop id", () => {
  const rows = W.toWorkoutRows([rec()], ["p1", "p2"]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    player_id: "p1", happened_at: "2026-11-09T22:00:00.000Z", source: "whoop",
    external_id: "8f5b4a1e-0000-4000-8000-000000000001", note: "Running · 45 min · strain 12.4"
  });
  assert.equal(rows[1].player_id, "p2");
});

test("workouts under the minimum length are dropped; the threshold is configurable", () => {
  const short = rec({ id: "s", end: "2026-11-09T22:12:00.000Z" });   // 12 min
  assert.equal(W.toWorkoutRows([short, rec()], ["p1"]).length, 1);
  assert.equal(W.toWorkoutRows([short], ["p1"], { minMinutes: 10 }).length, 1);
  assert.equal(W.toWorkoutRows([rec({ end: null })], ["p1"]).length, 0);   // still in progress
});

test("note humanises the sport and copes with no score yet", () => {
  assert.equal(W.noteFor(rec({ sport_name: "FUNCTIONAL_FITNESS", score: undefined, score_state: "PENDING_SCORE" })), "Functional Fitness · 45 min");
  assert.equal(W.humanSport(undefined), "Workout");
});

test("only players in a running challenge receive rows", () => {
  const now = "2026-11-10T04:59:00Z";
  const players = [
    { id: "live", challenges: { starts_on: "2026-11-02" } },
    { id: "future", challenges: { starts_on: "2026-12-01" } },
    { id: "old", challenges: { starts_on: "2026-01-01" } },
    { id: "justEnded", starts_on: "2026-08-10" }   // day 90 was 2026-11-07, inside the 3-day grace
  ];
  assert.deepEqual(W.activePlayerIds(players, now), ["live", "justEnded"]);
});

test("token expiry uses a safety skew", () => {
  const conn = { expires_at: "2026-11-10T05:00:00Z" };
  assert.equal(W.tokenExpired(conn, "2026-11-10T04:00:00Z"), false);
  assert.equal(W.tokenExpired(conn, "2026-11-10T04:58:30Z"), true);
});

test("auth URL carries the required Whoop parameters", () => {
  const u = new URL(W.authUrl({ clientId: "abc", redirectUri: "https://x.y/cb", state: "12345678" }));
  assert.equal(u.origin + u.pathname, "https://api.prod.whoop.com/oauth/oauth2/auth");
  assert.equal(u.searchParams.get("response_type"), "code");
  assert.equal(u.searchParams.get("client_id"), "abc");
  assert.equal(u.searchParams.get("scope"), "offline read:workout read:profile");
  assert.equal(u.searchParams.get("state"), "12345678");
});

test("callback parser accepts a full URL or a bare code", () => {
  assert.deepEqual(W.parseCallback("https://x.y/cb?code=C0DE&state=12345678"), { code: "C0DE", state: "12345678" });
  assert.deepEqual(W.parseCallback("  C0DE "), { code: "C0DE", state: null });
  assert.equal(W.parseCallback(""), null);
});

test(".env parser handles quotes, comments and export", () => {
  const env = W.parseDotenv('# comment\nWHOOP_CLIENT_ID=abc # trailing\nexport SECRET="s p a c e"\nEMPTY=\nbad line\n');
  assert.deepEqual(env, { WHOOP_CLIENT_ID: "abc", SECRET: "s p a c e", EMPTY: "" });
});
