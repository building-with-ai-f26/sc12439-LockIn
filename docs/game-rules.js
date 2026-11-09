/*
  game-rules.js — pure game math for Lock-In Party.

  Input: a challenge start date, a goal of N workouts per week, and a list
  of workouts (each with a happened_at). Output: per-week hit/miss, LP
  (Lock-in Power), evolution stage, streak and the events that happened
  each week. Nothing is stored; everything is derived, so a Whoop or MCP
  integration that inserts workouts needs no new rules.

  The rules, in one breath: LP is a health bar from 0 to 100 that starts
  at 50. Hit your weekly goal, +10 LP. Miss it, -15 LP. Three hit weeks in
  a row evolves you to stage 2, seven to stage 3. Break a streak or faint
  (LP hits 0) and you devolve one stage; a faint also resets LP to 25.
  Highest LP on day 90 wins.

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
    lpHit: 10,            // hit your weekly goal
    lpMiss: -15,          // miss it
    lpFaintReset: 25,     // where you wake up after fainting at 0
    evolveAt: [3, 7],     // streak needed to go stage 1→2, then 2→3
    maxStage: 3
  };

  var STAGES = ["ROOKIE", "RISING", "LOCKED IN"];   // index = stage - 1

  function pad2(n) { return n < 10 ? "0" + n : "" + n; }

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

  /*
    summarize({ startsOn, perWeek, workouts, today?, challengeDays? })

    Weeks before today are "done" and scored. The current week scores as
    soon as it is hit (instant LP and evolution), otherwise waits for the
    week to end. Future weeks are untouched. At most one devolve happens
    per week, even if a miss both breaks a streak and causes a faint.
  */
  function summarize(input) {
    var start = input.startsOn;
    var perWeek = input.perWeek;
    var days = input.challengeDays || RULES.challengeDays;
    var today = toDay(input.today || new Date());
    var nWeeks = totalWeeks(days);

    var counts = [];
    for (var k = 0; k < nWeeks; k++) counts.push(0);
    var total = 0;
    (input.workouts || []).forEach(function (w) {
      var wi = weekIndexFor(w.happened_at, start);
      if (wi >= 0 && wi < nWeeks) { counts[wi]++; total++; }
    });

    var todayIdx = weekIndexFor(today, start);
    var lp = RULES.lpStart, stage = 1, streak = 0, hitWeeks = 0, weeks = [], lastEvents = [];
    for (var i = 0; i < nWeeks; i++) {
      var status = i < todayIdx ? "done" : i === todayIdx ? "current" : "future";
      var hit = counts[i] >= perWeek;
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
        index: i, count: counts[i], hit: hit, status: status, scored: scored,
        lp: lp, stage: stage, streak: streak, events: events,
        startsOn: addDays(start, i * 7),
        endsOn: addDays(start, Math.min(i * 7 + 6, days - 1))
      });
    }

    var cur = (todayIdx >= 0 && todayIdx < nWeeks) ? weeks[todayIdx] : null;
    var endsOn = addDays(start, days - 1);
    return {
      totalWeeks: nWeeks,
      currentWeek: cur ? todayIdx : null,
      weeks: weeks,
      lp: lp,
      stage: stage,
      stageName: stageName(stage),
      streak: streak,
      nextEvolveAt: nextEvolveAt(stage),
      hitWeeks: hitWeeks,
      lastEvents: lastEvents,
      totalWorkouts: total,
      thisWeekCount: cur ? cur.count : 0,
      thisWeekRemaining: cur ? Math.max(0, perWeek - cur.count) : 0,
      thisWeekHit: cur ? cur.hit : false,
      daysLeft: Math.max(0, daysBetween(today, endsOn) + 1),
      endsOn: endsOn,
      started: todayIdx >= 0,
      over: todayIdx >= nWeeks
    };
  }

  // Leaderboard order: most LP, then higher stage, then longer streak, then more workouts.
  function compare(a, b) {
    return (b.lp - a.lp) || (b.stage - a.stage) || (b.streak - a.streak) || (b.totalWorkouts - a.totalWorkouts);
  }

  return {
    RULES: RULES, STAGES: STAGES,
    toDay: toDay, addDays: addDays, daysBetween: daysBetween,
    weekIndexFor: weekIndexFor, totalWeeks: totalWeeks,
    stageName: stageName, nextEvolveAt: nextEvolveAt,
    summarize: summarize, compare: compare
  };
});
