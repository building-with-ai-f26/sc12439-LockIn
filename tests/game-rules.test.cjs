// Deterministic tests for docs/game-rules.js. Run with: node --test "tests/*.test.cjs"
const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("../docs/game-rules.js");

const START = "2026-11-09";
const w = (day) => ({ happened_at: day });

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

test("titles step every two levels", () => {
  assert.equal(G.titleFor(1), "ROOKIE");
  assert.equal(G.titleFor(2), "ROOKIE");
  assert.equal(G.titleFor(3), "GRINDER");
  assert.equal(G.titleFor(99), "LOCKED IN");
});

test("fresh player: level 1, position 0, nothing scored", () => {
  const s = G.summarize({ startsOn: START, perWeek: 3, workouts: [], today: "2026-11-10" });
  assert.equal(s.level, 1);
  assert.equal(s.position, 0);
  assert.equal(s.currentWeek, 0);
  assert.equal(s.thisWeekRemaining, 3);
  assert.equal(s.daysLeft, 89);
  assert.equal(s.weeks[0].status, "current");
  assert.equal(s.weeks[1].status, "future");
});

test("hitting the goal mid-week levels up immediately", () => {
  const s = G.summarize({ startsOn: START, perWeek: 3, today: "2026-11-12",
    workouts: [w("2026-11-09"), w("2026-11-10"), w("2026-11-12")] });
  assert.equal(s.thisWeekHit, true);
  assert.equal(s.level, 2);
  assert.equal(s.position, 3);
  assert.equal(s.streak, 1);
});

test("a finished week with too few workouts costs one space, floored at 0", () => {
  const s = G.summarize({ startsOn: START, perWeek: 3, today: "2026-11-17",
    workouts: [w("2026-11-10")] });
  assert.equal(s.weeks[0].status, "done");
  assert.equal(s.weeks[0].hit, false);
  assert.equal(s.level, 1);
  assert.equal(s.position, 0);
  assert.equal(s.streak, 0);
});

test("hit, miss, hit: level 3, streak resets, position 3 - 1 + 3", () => {
  const s = G.summarize({ startsOn: START, perWeek: 2, today: "2026-11-30",
    workouts: [w("2026-11-09"), w("2026-11-10"),          // week 0 hit
               w("2026-11-18"),                            // week 1 miss
               w("2026-11-23"), w("2026-11-24")] });       // week 2 done, hit
  assert.equal(s.level, 3);
  assert.equal(s.streak, 1);
  assert.equal(s.position, 5);
});

test("three hits in a row earn the streak bonus from the third week", () => {
  const s = G.summarize({ startsOn: START, perWeek: 1, today: "2026-11-30",
    workouts: [w("2026-11-09"), w("2026-11-16"), w("2026-11-23")] });
  assert.equal(s.streak, 3);
  assert.equal(s.position, 3 + 3 + 4);
  assert.equal(s.title, "GRINDER");   // level 4
});

test("workouts before the start or after day 90 are ignored", () => {
  const s = G.summarize({ startsOn: START, perWeek: 1, today: "2026-11-10",
    workouts: [w("2026-11-01"), w("2027-03-01")] });
  assert.equal(s.totalWorkouts, 0);
  assert.equal(s.level, 1);
});

test("position is capped at the board size", () => {
  const workouts = [];
  for (let i = 0; i < 13; i++) workouts.push(w(G.addDays(START, i * 7)));
  const s = G.summarize({ startsOn: START, perWeek: 1, workouts, today: "2027-02-10" });
  assert.equal(s.over, true);
  assert.equal(s.finished, true);
  assert.equal(s.position, 40);
  assert.equal(s.level, 14);
});
