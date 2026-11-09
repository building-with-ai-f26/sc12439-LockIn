// Deterministic tests for docs/game-rules.js. Run with: node --test "tests/*.test.cjs"
const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("../docs/game-rules.js");

const START = "2026-11-09";
const w = (day) => ({ happened_at: day });
// One workout per week (perWeek 1) for the given week indexes = those weeks hit.
const hitWeeks = (...idx) => idx.map((i) => w(G.addDays(START, i * 7)));
// "today" at the start of week n, so weeks 0..n-1 are done.
const startOfWeek = (n) => G.addDays(START, n * 7);

test("date helpers", () => {
  assert.equal(G.addDays("2026-11-09", 7), "2026-11-16");
  assert.equal(G.daysBetween("2026-11-09", "2027-02-06"), 89);
  assert.equal(G.toDay("2026-11-09"), "2026-11-09");
  assert.equal(G.totalWeeks(90), 13);
});

test("weekIndexFor counts 7-day weeks from the start date", () => {
  assert.equal(G.weekIndexFor("2026-11-09", START), 0);
  assert.equal(G.weekIndexFor("2026-11-15", START), 0);
  assert.equal(G.weekIndexFor("2026-11-16", START), 1);
  assert.equal(G.weekIndexFor("2026-11-08", START), -1);
});

test("stage names and evolution thresholds", () => {
  assert.equal(G.stageName(1), "ROOKIE");
  assert.equal(G.stageName(2), "RISING");
  assert.equal(G.stageName(3), "LOCKED IN");
  assert.equal(G.nextEvolveAt(1), 3);
  assert.equal(G.nextEvolveAt(2), 7);
  assert.equal(G.nextEvolveAt(3), null);
});

test("fresh player: 50 LP, stage 1, nothing scored", () => {
  const s = G.summarize({ startsOn: START, perWeek: 3, workouts: [], today: "2026-11-10" });
  assert.equal(s.lp, 50);
  assert.equal(s.stage, 1);
  assert.equal(s.streak, 0);
  assert.equal(s.nextEvolveAt, 3);
  assert.equal(s.currentWeek, 0);
  assert.equal(s.thisWeekRemaining, 3);
  assert.equal(s.daysLeft, 89);
  assert.deepEqual(s.lastEvents, []);
  assert.equal(s.weeks[0].status, "current");
  assert.equal(s.weeks[1].status, "future");
});

test("hitting the goal mid-week scores +10 LP immediately", () => {
  const s = G.summarize({ startsOn: START, perWeek: 3, today: "2026-11-12",
    workouts: [w("2026-11-09"), w("2026-11-10"), w("2026-11-12")] });
  assert.equal(s.thisWeekHit, true);
  assert.equal(s.lp, 60);
  assert.equal(s.streak, 1);
  assert.deepEqual(s.lastEvents, ["hit"]);
});

test("an unfinished current week does not score yet", () => {
  const s = G.summarize({ startsOn: START, perWeek: 3, today: "2026-11-12", workouts: [w("2026-11-10")] });
  assert.equal(s.lp, 50);
  assert.equal(s.weeks[0].scored, false);
});

test("a finished week with too few workouts costs 15 LP; no devolve without a streak", () => {
  const s = G.summarize({ startsOn: START, perWeek: 3, today: startOfWeek(1), workouts: [w("2026-11-10")] });
  assert.equal(s.weeks[0].status, "done");
  assert.equal(s.weeks[0].hit, false);
  assert.equal(s.lp, 35);
  assert.equal(s.stage, 1);
  assert.deepEqual(s.lastEvents, ["miss"]);
});

test("three hit weeks in a row evolve to stage 2", () => {
  const two = G.summarize({ startsOn: START, perWeek: 1, today: startOfWeek(2), workouts: hitWeeks(0, 1) });
  assert.equal(two.stage, 1);
  assert.equal(two.streak, 2);
  const three = G.summarize({ startsOn: START, perWeek: 1, today: startOfWeek(3), workouts: hitWeeks(0, 1, 2) });
  assert.equal(three.stage, 2);
  assert.equal(three.stageName, "RISING");
  assert.equal(three.lp, 80);
  assert.equal(three.nextEvolveAt, 7);
  assert.deepEqual(three.weeks[2].events, ["hit", "evolve"]);
});

test("breaking a streak devolves one stage and costs 15 LP", () => {
  const s = G.summarize({ startsOn: START, perWeek: 1, today: startOfWeek(4), workouts: hitWeeks(0, 1, 2) });
  assert.equal(s.stage, 1);
  assert.equal(s.streak, 0);
  assert.equal(s.lp, 65);
  assert.deepEqual(s.lastEvents, ["miss", "devolve"]);
});

test("seven in a row reaches the final stage and LP caps at 100", () => {
  const s = G.summarize({ startsOn: START, perWeek: 1, today: startOfWeek(7), workouts: hitWeeks(0, 1, 2, 3, 4, 5, 6) });
  assert.equal(s.stage, 3);
  assert.equal(s.stageName, "LOCKED IN");
  assert.equal(s.lp, 100);
  assert.equal(s.nextEvolveAt, null);
  assert.deepEqual(s.weeks[6].events, ["hit", "evolve"]);
});

test("after devolving from stage 3 you need another 7-week streak to return", () => {
  // 7 hits, 1 miss (→ stage 2), then 3 hits: still stage 2 since 2→3 needs a 7 streak.
  const s = G.summarize({ startsOn: START, perWeek: 1, today: startOfWeek(11),
    workouts: hitWeeks(0, 1, 2, 3, 4, 5, 6, 8, 9, 10) });
  assert.equal(s.stage, 2);
  assert.equal(s.streak, 3);
  assert.equal(s.weeks[7].events.includes("devolve"), true);
  assert.equal(s.weeks[10].events.includes("evolve"), false);
});

test("fainting at 0 LP resets to 25; stage never drops below 1", () => {
  // 50 → 35 → 20 → 5 → faint on the 4th miss.
  const s = G.summarize({ startsOn: START, perWeek: 1, today: startOfWeek(4), workouts: [] });
  assert.equal(s.weeks[2].lp, 5);
  assert.deepEqual(s.weeks[3].events, ["miss", "faint"]);
  assert.equal(s.lp, 25);
  assert.equal(s.stage, 1);
});

test("fainting right after a hit week does not devolve below stage 1", () => {
  // misses to 5 LP, then hit (15) hit (25) hit (35, evolve to 2), miss (20, devolve), miss (5), hit (15), miss (0 → faint).
  const s = G.summarize({ startsOn: START, perWeek: 1, today: startOfWeek(10), workouts: hitWeeks(3, 4, 5, 8) });
  assert.equal(s.weeks[5].stage, 2);
  assert.deepEqual(s.weeks[6].events, ["miss", "devolve"]);
  assert.equal(s.weeks[6].stage, 1);
  assert.deepEqual(s.weeks[9].events, ["miss", "faint"]);
  assert.equal(s.lp, 25);
  assert.equal(s.stage, 1);
});

test("workouts before the start or after day 90 are ignored", () => {
  const s = G.summarize({ startsOn: START, perWeek: 1, today: "2026-11-10",
    workouts: [w("2026-11-01"), w("2027-03-01")] });
  assert.equal(s.totalWorkouts, 0);
  assert.equal(s.lp, 50);
});

test("a perfect 90 days: over, 13 hit weeks, full LP, final stage", () => {
  const s = G.summarize({ startsOn: START, perWeek: 1, today: "2027-02-10",
    workouts: hitWeeks(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12) });
  assert.equal(s.over, true);
  assert.equal(s.hitWeeks, 13);
  assert.equal(s.lp, 100);
  assert.equal(s.stage, 3);
  assert.equal(s.streak, 13);
});

test("leaderboard ranks by LP, then stage, then streak, then workouts", () => {
  const rows = [
    { name: "a", lp: 60, stage: 1, streak: 1, totalWorkouts: 3 },
    { name: "b", lp: 80, stage: 2, streak: 3, totalWorkouts: 9 },
    { name: "c", lp: 60, stage: 2, streak: 0, totalWorkouts: 5 },
    { name: "d", lp: 60, stage: 1, streak: 1, totalWorkouts: 4 }
  ];
  assert.deepEqual(rows.slice().sort(G.compare).map((r) => r.name), ["b", "c", "d", "a"]);
});
