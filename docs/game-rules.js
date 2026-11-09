/*
  game-rules.js — pure game math for Lock-In Party.

  Input: a challenge start date, a goal of N workouts per week, and a list
  of workouts (each with a happened_at). Output: per-week hit/miss, level,
  title, board position, streak. Nothing is stored; everything is derived,
  so a Whoop or MCP integration that inserts workouts needs no new rules.

  Loads as a plain <script> (window.GameRules) and as CommonJS for tests.
*/
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.GameRules = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var RULES = {
    challengeDays: 90,
    boardSize: 40,       // position 0 = START, 40 = FINISH
    spacesPerHit: 3,     // hit your weekly goal: move forward
    spacesPerMiss: -1,   // miss it: slide back (never below 0)
    streakBonusAt: 3,    // from the 3rd hit week in a row...
    streakBonus: 1       // ...each hit moves one extra space
  };

  // Two levels per title. Level 1 starts at ROOKIE.
  var TITLES = ["ROOKIE", "GRINDER", "CONTENDER", "CHAMPION", "LEGEND", "MYTHIC", "LOCKED IN"];

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
  function titleFor(level) { return TITLES[Math.min(TITLES.length - 1, Math.floor((level - 1) / 2))]; }

  /*
    summarize({ startsOn, perWeek, workouts, today?, challengeDays? })

    Weeks before today are "done" and scored. The current week scores as
    soon as it is hit (instant level-up), otherwise waits. Future weeks
    are untouched.
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
    var level = 1, position = 0, streak = 0, weeks = [];
    for (var i = 0; i < nWeeks; i++) {
      var status = i < todayIdx ? "done" : i === todayIdx ? "current" : "future";
      var hit = counts[i] >= perWeek;
      var scored = status === "done" || (status === "current" && hit);
      if (scored) {
        if (hit) {
          level++; streak++;
          position += RULES.spacesPerHit + (streak >= RULES.streakBonusAt ? RULES.streakBonus : 0);
        } else {
          streak = 0;
          position += RULES.spacesPerMiss;
        }
        if (position < 0) position = 0;
      }
      weeks.push({
        index: i, count: counts[i], hit: hit, status: status, scored: scored,
        startsOn: addDays(start, i * 7),
        endsOn: addDays(start, Math.min(i * 7 + 6, days - 1))
      });
    }
    if (position > RULES.boardSize) position = RULES.boardSize;

    var cur = (todayIdx >= 0 && todayIdx < nWeeks) ? weeks[todayIdx] : null;
    var endsOn = addDays(start, days - 1);
    return {
      totalWeeks: nWeeks,
      currentWeek: cur ? todayIdx : null,
      weeks: weeks,
      level: level,
      title: titleFor(level),
      position: position,
      streak: streak,
      totalWorkouts: total,
      thisWeekCount: cur ? cur.count : 0,
      thisWeekRemaining: cur ? Math.max(0, perWeek - cur.count) : 0,
      thisWeekHit: cur ? cur.hit : false,
      daysLeft: Math.max(0, daysBetween(today, endsOn) + 1),
      endsOn: endsOn,
      started: todayIdx >= 0,
      over: todayIdx >= nWeeks,
      finished: position >= RULES.boardSize
    };
  }

  return {
    RULES: RULES, TITLES: TITLES,
    toDay: toDay, addDays: addDays, daysBetween: daysBetween,
    weekIndexFor: weekIndexFor, totalWeeks: totalWeeks, titleFor: titleFor,
    summarize: summarize
  };
});
