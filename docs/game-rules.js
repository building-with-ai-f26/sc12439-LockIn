/*
  game-rules.js — pure game math for Lock-In Party.

  Input: a challenge start date, the goals a player locked in, and their
  check-ins (each with a goal_id and a happened_at). Output: per-week
  hit/miss, LP (Lock-in Power), evolution stage, streak, the events that
  happened each week, and a per-goal progress summary. Nothing is stored;
  everything is derived, so a Whoop or MCP integration that inserts
  check-ins needs no new rules.

  The rules, in one breath: LP is a health bar from 0 to 100 that starts
  at 50. Hit every one of your weekly goals, +10 LP. Miss any, -15 LP.
  Three hit weeks in a row evolves you to stage 2, seven to stage 3. Break
  a streak or faint (LP hits 0) and you devolve one stage; a faint also
  resets LP to 25. Highest LP on day 90 wins.

  Goal types: workouts (several a day can count), 10,000-step days,
  reading days and dry days (at most one check-in per calendar day).

  Loads as a plain <script> (window.GameRules) and as CommonJS for tests.
*/
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.GameRules = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var RULES = {
    challengeDays: 90,
    lpStart: 50,
    lpMax: 100,
    lpHit: 10,            // hit every weekly goal
    lpMiss: -15,          // miss any of them
    lpFaintReset: 25,     // where you wake up after fainting at 0
    evolveAt: [3, 7],     // streak needed to go stage 1→2, then 2→3
    maxStage: 3
  };

  var STAGES = ["ORANGUPE", "PRIMACHO", "MEGA-SIMIAN"];   // index = stage - 1; the monkey evolution line

  // The four goal types a player can lock in. per_week means workouts per
  // week for fitness and days per week for everything else.
  var GOAL_TYPES = {
    fitness: { label: "WORKOUTS", oncePerDay: false, defaultPerWeek: 3, action: "I WORKED OUT TODAY", unit: "workout",
      settings: {}, describe: "Any workout counts. Several in one day all count." },
    steps:   { label: "10,000 STEPS", oncePerDay: true, defaultPerWeek: 5, action: "I HIT MY STEPS TODAY", unit: "steps day",
      settings: { steps: 10000 }, describe: "Days you reach the step count. One check-in per day." },
    reading: { label: "READING", oncePerDay: true, defaultPerWeek: 5, action: "I READ TODAY", unit: "reading day",
      settings: { minutes: 20 }, describe: "Days you read for at least the set minutes. One per day." },
    dry:     { label: "NO DRINKING", oncePerDay: true, defaultPerWeek: 7, action: "DRY DAY TODAY", unit: "dry day",
      settings: {}, describe: "Days with no alcohol. Pick 7 for a fully dry week." }
  };
  var GOAL_ORDER = ["fitness", "steps", "reading", "dry"];

  function pad2(n) { return n < 10 ? "0" + n : "" + n; }
  function fmtInt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
  function daysPhrase(n) { return n === 7 ? "every day" : n + " day" + (n === 1 ? "" : "s") + " a week"; }

  // Human text for a goal row ({ type, per_week, settings }).
  function goalText(g) {
    var s = g.settings || {}, n = g.per_week;
    switch (g.type) {
      case "fitness": return "Work out " + n + "× per week";
      case "steps":   return fmtInt(s.steps || GOAL_TYPES.steps.settings.steps) + " steps " + daysPhrase(n);
      case "reading": return "Read " + (s.minutes || GOAL_TYPES.reading.settings.minutes) + " min " + daysPhrase(n);
      case "dry":     return n === 7 ? "No drinking all week" : n + " dry day" + (n === 1 ? "" : "s") + " a week";
      default:        return n + "× per week";
    }
  }
  // Short label for a leaderboard line: "3 workouts", "7 dry days".
  function goalShort(g) {
    var n = g.per_week;
    switch (g.type) {
      case "fitness": return n + " workout" + (n === 1 ? "" : "s");
      case "steps":   return n + " step day" + (n === 1 ? "" : "s");
      case "reading": return n + " reading day" + (n === 1 ? "" : "s");
      case "dry":     return n + " dry day" + (n === 1 ? "" : "s");
      default:        return n + "×";
    }
  }

  // Normalise anything date-like to a local calendar day "YYYY-MM-DD".
  function toDay(v) {
    if (typeof v === "string" && v.length === 10) return v;
    var d = v instanceof Date ? v : new Date(v);
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }
  function dayToUTC(day) { var p = day.split("-"); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
  function daysBetween(a, b) { return Math.round((dayToUTC(b) - dayToUTC(a)) / 86400000); }
  function addDays(day, n) {
    var d = new Date(dayToUTC(day) + n * 86400000);
    return d.getUTCFullYear() + "-" + pad2(d.getUTCMonth() + 1) + "-" + pad2(d.getUTCDate());
  }

  // Week 0 is the first 7 days of the challenge. Negative before it starts.
  function weekIndexFor(day, startsOn) { return Math.floor(daysBetween(startsOn, toDay(day)) / 7); }
  function totalWeeks(days) { return Math.ceil((days || RULES.challengeDays) / 7); }
  function stageName(stage) { return STAGES[Math.max(0, Math.min(STAGES.length - 1, stage - 1))]; }
  // Streak needed for the next evolution from this stage, or null at the top.
  function nextEvolveAt(stage) { return stage >= RULES.maxStage ? null : RULES.evolveAt[stage - 1]; }

  // Accept the new shape ({ goals, checkins }) and the old one ({ perWeek, workouts }).
  function normalizeGoals(input) {
    var list = input.goals && input.goals.length ? input.goals
      : input.perWeek ? [{ id: null, type: "fitness", per_week: input.perWeek }] : [];
    return list.map(function (g) {
      var def = GOAL_TYPES[g.type] || GOAL_TYPES.fitness;
      return { id: g.id == null ? null : g.id, type: g.type || "fitness", perWeek: +(g.per_week || g.perWeek || def.defaultPerWeek),
        settings: g.settings || def.settings, oncePerDay: def.oncePerDay, label: def.label, action: def.action, unit: def.unit,
        text: g.text || goalText({ type: g.type || "fitness", per_week: +(g.per_week || g.perWeek || def.defaultPerWeek), settings: g.settings }) };
    });
  }
  // Which goal a check-in counts toward. Rows from before goals existed have
  // no goal_id and belong to the fitness goal.
  function goalFor(c, goals) {
    if (c.goal_id != null) { for (var i = 0; i < goals.length; i++) if (goals[i].id === c.goal_id) return goals[i]; return null; }
    for (var j = 0; j < goals.length; j++) if (goals[j].type === "fitness") return goals[j];
    return null;
  }

  /*
    summarize({ startsOn, goals, checkins, today?, challengeDays? })

    Weeks before today are "done" and scored. The current week scores as
    soon as every goal is hit (instant LP and evolution), otherwise waits
    for the week to end. Future weeks are untouched. At most one devolve
    happens per week, even if a miss both breaks a streak and causes a faint.
  */
  function summarize(input) {
    var start = input.startsOn;
    var days = input.challengeDays || RULES.challengeDays;
    var today = toDay(input.today || new Date());
    var nWeeks = totalWeeks(days);
    var goals = normalizeGoals(input);
    var checkins = input.checkins || input.workouts || [];

    goals.forEach(function (g) { g.counts = []; for (var k = 0; k < nWeeks; k++) g.counts.push(0); g.total = 0; g.seen = {}; });
    var total = 0;
    checkins.forEach(function (c) {
      var g = goalFor(c, goals);
      if (!g) return;
      var wi = weekIndexFor(c.happened_at, start);
      if (wi < 0 || wi >= nWeeks) return;
      if (g.oncePerDay) { var d = toDay(c.happened_at); if (g.seen[d]) return; g.seen[d] = true; }
      g.counts[wi]++; g.total++; total++;
    });

    var todayIdx = weekIndexFor(today, start);
    var lp = RULES.lpStart, stage = 1, streak = 0, hitWeeks = 0, weeks = [], lastEvents = [];
    for (var i = 0; i < nWeeks; i++) {
      var status = i < todayIdx ? "done" : i === todayIdx ? "current" : "future";
      var counts = goals.map(function (g) { return g.counts[i]; });
      var hit = goals.length > 0 && goals.every(function (g) { return g.counts[i] >= g.perWeek; });
      var scored = status === "done" || (status === "current" && hit);
      var events = [];
      if (scored) {
        if (hit) {
          events.push("hit");
          streak++; hitWeeks++;
          lp = Math.min(RULES.lpMax, lp + RULES.lpHit);
          var need = nextEvolveAt(stage);
          if (need !== null && streak >= need) { stage++; events.push("evolve"); }
        } else {
          events.push("miss");
          var devolve = streak > 0;
          streak = 0;
          lp += RULES.lpMiss;
          if (lp <= 0) { events.push("faint"); lp = RULES.lpFaintReset; devolve = true; }
          if (devolve && stage > 1) { stage--; events.push("devolve"); }
        }
        lastEvents = events;
      }
      weeks.push({
        index: i, counts: counts, count: counts.reduce(function (a, b) { return a + b; }, 0),
        hit: hit, status: status, scored: scored,
        lp: lp, stage: stage, streak: streak, events: events,
        startsOn: addDays(start, i * 7),
        endsOn: addDays(start, Math.min(i * 7 + 6, days - 1))
      });
    }

    var cur = (todayIdx >= 0 && todayIdx < nWeeks) ? weeks[todayIdx] : null;
    var endsOn = addDays(start, days - 1);
    var goalOut = goals.map(function (g) {
      var c = cur ? g.counts[todayIdx] : 0;
      return { id: g.id, type: g.type, perWeek: g.perWeek, settings: g.settings, label: g.label, text: g.text, action: g.action, unit: g.unit,
        oncePerDay: g.oncePerDay, total: g.total, thisWeekCount: c, thisWeekRemaining: Math.max(0, g.perWeek - c), thisWeekHit: c >= g.perWeek,
        loggedToday: !!g.seen[today] };
    });
    var remaining = goalOut.reduce(function (a, g) { return a + g.thisWeekRemaining; }, 0);
    return {
      totalWeeks: nWeeks,
      currentWeek: cur ? todayIdx : null,
      weeks: weeks,
      goals: goalOut,
      lp: lp,
      stage: stage,
      stageName: stageName(stage),
      streak: streak,
      nextEvolveAt: nextEvolveAt(stage),
      hitWeeks: hitWeeks,
      lastEvents: lastEvents,
      totalCheckins: total,
      thisWeekCount: cur ? cur.count : 0,
      thisWeekRemaining: cur ? remaining : 0,
      thisWeekHit: cur ? cur.hit : false,
      daysLeft: Math.max(0, daysBetween(today, endsOn) + 1),
      endsOn: endsOn,
      started: todayIdx >= 0,
      over: todayIdx >= nWeeks
    };
  }

  // Leaderboard order: most LP, then higher stage, then longer streak, then more check-ins.
  function compare(a, b) {
    return (b.lp - a.lp) || (b.stage - a.stage) || (b.streak - a.streak) || (b.totalCheckins - a.totalCheckins);
  }

  return {
    RULES: RULES, STAGES: STAGES, GOAL_TYPES: GOAL_TYPES, GOAL_ORDER: GOAL_ORDER,
    toDay: toDay, addDays: addDays, daysBetween: daysBetween,
    weekIndexFor: weekIndexFor, totalWeeks: totalWeeks,
    stageName: stageName, nextEvolveAt: nextEvolveAt,
    goalText: goalText, goalShort: goalShort,
    summarize: summarize, compare: compare
  };
});
