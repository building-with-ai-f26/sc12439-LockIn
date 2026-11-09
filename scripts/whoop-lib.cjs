/*
  whoop-lib.cjs — pure helpers for the Whoop sync. No network, no env, so
  every rule here is covered by tests/whoop.test.cjs.
*/
"use strict";

// WHOOP_API_BASE is only overridden by the mock server used in local testing.
const BASE = (typeof process !== "undefined" && process.env && process.env.WHOOP_API_BASE) || "https://api.prod.whoop.com";
const WHOOP = {
  authUrl: BASE + "/oauth/oauth2/auth",
  tokenUrl: BASE + "/oauth/oauth2/token",
  workoutsUrl: BASE + "/developer/v2/activity/workout",
  profileUrl: BASE + "/developer/v2/user/profile/basic",
  scopes: ["offline", "read:workout", "read:profile"],
  pageSize: 25
};

const DEFAULTS = { minMinutes: 20, windowDays: 3, challengeDays: 90 };

// True when `date` falls in the 11 PM hour in New York, EST or EDT.
// The GitHub cron fires at both 03:59 and 04:59 UTC; whichever is 23:59 local wins.
function isElevenPmEastern(date) {
  const hour = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }).format(date);
  return parseInt(hour, 10) % 24 === 23;
}

// Pull a trailing window so a delayed run or late-arriving Whoop data is still caught.
function syncWindow(now, days) {
  const end = new Date(now);
  const start = new Date(end.getTime() - (days || DEFAULTS.windowDays) * 86400000);
  return { start: start.toISOString(), end: end.toISOString() };
}

function durationMinutes(record) {
  if (!record || !record.start || !record.end) return 0;
  return (new Date(record.end) - new Date(record.start)) / 60000;
}

function humanSport(name) {
  if (!name) return "Workout";
  return String(name).toLowerCase().replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function noteFor(record) {
  const mins = Math.round(durationMinutes(record));
  const strain = record.score && typeof record.score.strain === "number" ? " · strain " + record.score.strain.toFixed(1) : "";
  return humanSport(record.sport_name) + " · " + mins + " min" + strain;
}

/*
  toWorkoutRows(records, playerIds, { minMinutes })
  Whoop workout records → rows for the workouts table, one per player row the
  person has (they may be in several groups). Short activities are dropped.
*/
function toWorkoutRows(records, playerIds, opts) {
  const minMinutes = (opts && opts.minMinutes) != null ? opts.minMinutes : DEFAULTS.minMinutes;
  const rows = [];
  (records || []).forEach((r) => {
    if (!r || !r.id || durationMinutes(r) < minMinutes) return;
    playerIds.forEach((pid) => {
      rows.push({ player_id: pid, happened_at: r.start, source: "whoop", external_id: String(r.id), note: noteFor(r) });
    });
  });
  return rows;
}

// Only players whose challenge is running (or ended within the sync window) should receive rows.
function activePlayerIds(players, now, opts) {
  const days = (opts && opts.challengeDays) || DEFAULTS.challengeDays;
  const grace = ((opts && opts.windowDays) || DEFAULTS.windowDays) * 86400000;
  const t = new Date(now).getTime();
  return (players || []).filter((p) => {
    const startsOn = p.starts_on || (p.challenges && p.challenges.starts_on);
    if (!startsOn) return false;
    const s = new Date(startsOn + "T00:00:00Z").getTime();
    return t >= s && t < s + days * 86400000 + grace;
  }).map((p) => p.id);
}

function tokenExpired(connection, now, skewSeconds) {
  const skew = (skewSeconds == null ? 120 : skewSeconds) * 1000;
  return new Date(connection.expires_at).getTime() - skew <= new Date(now).getTime();
}

function authUrl(params) {
  const q = new URLSearchParams({
    response_type: "code", client_id: params.clientId, redirect_uri: params.redirectUri,
    scope: (params.scopes || WHOOP.scopes).join(" "), state: params.state
  });
  return WHOOP.authUrl + "?" + q.toString();
}

// Accepts the full redirect URL the browser landed on, or a bare code.
function parseCallback(input) {
  const s = String(input || "").trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) {
    const u = new URL(s);
    return { code: u.searchParams.get("code"), state: u.searchParams.get("state") };
  }
  return { code: s, state: null };
}

// Minimal .env reader: KEY=VALUE lines, quotes optional, never overrides real env.
function parseDotenv(text) {
  const out = {};
  String(text || "").split(/\r?\n/).forEach((line) => {
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) return;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, "");
    out[m[1]] = v;
  });
  return out;
}

module.exports = {
  WHOOP, DEFAULTS,
  isElevenPmEastern, syncWindow, durationMinutes, humanSport, noteFor,
  toWorkoutRows, activePlayerIds, tokenExpired, authUrl, parseCallback, parseDotenv
};
