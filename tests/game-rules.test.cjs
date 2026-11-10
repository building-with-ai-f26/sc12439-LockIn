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
  assert.equal(G.stageName(2), "CONTENDER");
  assert.equal(G.stageName(3), "LEGEND");
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
  assert.equal(three.stageName, "CONTENDER");
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
  assert.equal(s.stageName, "LEGEND");
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

test("check-ins before the start or after day 90 are ignored", () => {
  const s = G.summarize({ startsOn: START, perWeek: 1, today: "2026-11-10",
    workouts: [w("2026-11-01"), w("2027-03-01")] });
  assert.equal(s.totalCheckins, 0);
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

test("leaderboard ranks by LP, then stage, then streak, then check-ins", () => {
  const rows = [
    { name: "a", lp: 60, stage: 1, streak: 1, totalCheckins: 3 },
    { name: "b", lp: 80, stage: 2, streak: 3, totalCheckins: 9 },
    { name: "c", lp: 60, stage: 2, streak: 0, totalCheckins: 5 },
    { name: "d", lp: 60, stage: 1, streak: 1, totalCheckins: 4 }
  ];
  assert.deepEqual(rows.slice().sort(G.compare).map((r) => r.name), ["b", "c", "d", "a"]);
});

// ---------- several goals ----------
const GOALS = [
  { id: "gf", type: "fitness", per_week: 2 },
  { id: "gd", type: "dry", per_week: 7 }
];
const ci = (goal, day) => ({ goal_id: goal, happened_at: day });
const dryWeek = (i) => [0, 1, 2, 3, 4, 5, 6].map((d) => ci("gd", G.addDays(START, i * 7 + d)));

test("goal text reads naturally for every type", () => {
  assert.equal(G.goalText({ type: "fitness", per_week: 3 }), "Work out 3× per week");
  assert.equal(G.goalText({ type: "steps", per_week: 5 }), "10,000 steps 5 days a week");
  assert.equal(G.goalText({ type: "steps", per_week: 7, settings: { steps: 8000 } }), "8,000 steps every day");
  assert.equal(G.goalText({ type: "reading", per_week: 1 }), "Read 20 min 1 day a week");
  assert.equal(G.goalText({ type: "dry", per_week: 7 }), "No drinking all week");
  assert.equal(G.goalText({ type: "dry", per_week: 5 }), "5 dry days a week");
  assert.equal(G.goalShort({ type: "reading", per_week: 3 }), "3 reading days");
  assert.deepEqual(G.GOAL_ORDER, ["fitness", "steps", "reading", "dry"]);
});

test("a week is hit only when every goal is met", () => {
  const workouts = [ci("gf", "2026-11-09"), ci("gf", "2026-11-10")];
  const onlyWorkouts = G.summarize({ startsOn: START, goals: GOALS, checkins: workouts, today: startOfWeek(1) });
  assert.equal(onlyWorkouts.weeks[0].hit, false);
  assert.deepEqual(onlyWorkouts.weeks[0].counts, [2, 0]);
  assert.equal(onlyWorkouts.lp, 35);
  const both = G.summarize({ startsOn: START, goals: GOALS, checkins: workouts.concat(dryWeek(0)), today: startOfWeek(1) });
  assert.equal(both.weeks[0].hit, true);
  assert.equal(both.lp, 60);
  assert.equal(both.totalCheckins, 9);
});

test("once-per-day goals count a day only once; workouts can stack", () => {
  const s = G.summarize({ startsOn: START, goals: GOALS, today: "2026-11-10", checkins: [
    ci("gd", "2026-11-09T08:00:00"), ci("gd", "2026-11-09T22:00:00"),   // same day twice
    ci("gf", "2026-11-09T07:00:00"), ci("gf", "2026-11-09T18:00:00")    // two workouts, one day
  ] });
  const dry = s.goals.find((g) => g.type === "dry"), fit = s.goals.find((g) => g.type === "fitness");
  assert.equal(dry.thisWeekCount, 1);
  assert.equal(fit.thisWeekCount, 2);
  assert.equal(fit.thisWeekHit, true);
  assert.equal(dry.thisWeekRemaining, 6);
  assert.equal(s.thisWeekRemaining, 6);
  assert.equal(s.thisWeekHit, false);
});

test("per-goal summary carries labels, actions and whether today is logged", () => {
  const s = G.summarize({ startsOn: START, goals: GOALS, today: "2026-11-10", checkins: [ci("gd", "2026-11-10T09:00:00")] });
  const dry = s.goals[1];
  assert.equal(dry.label, "NO DRINKING");
  assert.equal(dry.action, "DRY DAY TODAY");
  assert.equal(dry.oncePerDay, true);
  assert.equal(dry.loggedToday, true);
  assert.equal(s.goals[0].loggedToday, false);
  assert.equal(s.goals[0].text, "Work out 2× per week");
});

test("check-ins without a goal_id belong to the fitness goal (rows from before 004)", () => {
  const s = G.summarize({ startsOn: START, goals: [{ id: "gf", type: "fitness", per_week: 1 }], today: startOfWeek(1),
    checkins: [{ happened_at: "2026-11-09" }] });
  assert.equal(s.weeks[0].hit, true);
  assert.equal(s.lp, 60);
});

test("the old { perWeek, workouts } input shape still works", () => {
  const s = G.summarize({ startsOn: START, perWeek: 1, workouts: hitWeeks(0, 1, 2), today: startOfWeek(3) });
  assert.equal(s.stage, 2);
  assert.equal(s.goals.length, 1);
  assert.equal(s.goals[0].type, "fitness");
});

test("a player with no goals never scores a hit", () => {
  const s = G.summarize({ startsOn: START, goals: [], checkins: [], today: startOfWeek(2) });
  assert.equal(s.weeks[0].hit, false);
  assert.equal(s.lp, 20);
});
