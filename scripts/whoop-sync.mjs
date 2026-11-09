#!/usr/bin/env node
/*
  whoop-sync.mjs — nightly job: pull each connected person's Whoop workouts
  for the last few days and log any new ones into Supabase.

  Run by .github/workflows/whoop-sync.yml at 11:59 PM Eastern. Run locally:
    node scripts/whoop-sync.mjs --force        (skips the 11 PM guard)

  Env (see .env.example): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
  WHOOP_CLIENT_ID, WHOOP_CLIENT_SECRET, optional WHOOP_MIN_MINUTES (30), WHOOP_EXCLUDE_SPORTS (walking), WHOOP_WINDOW_DAYS (3).
  Never run this with the anon key: whoop_connections is service-role only.
*/
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const W = require("./whoop-lib.cjs");

// ---------- env ----------
const envPath = path.join(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  const fileEnv = W.parseDotenv(fs.readFileSync(envPath, "utf8"));
  for (const k of Object.keys(fileEnv)) if (process.env[k] == null) process.env[k] = fileEnv[k];
}
const need = (k) => { const v = process.env[k]; if (!v) { console.error("Missing env " + k + " (see .env.example)"); process.exit(2); } return v; };
const SUPABASE_URL = need("SUPABASE_URL").replace(/\/$/, "");
const SERVICE_KEY = need("SUPABASE_SERVICE_ROLE_KEY");
const CLIENT_ID = need("WHOOP_CLIENT_ID");
const CLIENT_SECRET = need("WHOOP_CLIENT_SECRET");
const MIN_MINUTES = Number(process.env.WHOOP_MIN_MINUTES || W.DEFAULTS.minMinutes);
const EXCLUDE = process.env.WHOOP_EXCLUDE_SPORTS != null ? W.parseSportList(process.env.WHOOP_EXCLUDE_SPORTS) : W.DEFAULTS.excludeSports;
const WINDOW_DAYS = Number(process.env.WHOOP_WINDOW_DAYS || W.DEFAULTS.windowDays);
const FORCE = process.argv.includes("--force") || process.env.FORCE === "1";

const now = new Date();
if (!FORCE && !W.isElevenPmEastern(now)) {
  console.log("Not the 11 PM hour in New York (" + now.toISOString() + "); nothing to do. Use --force to run anyway.");
  process.exit(0);
}

// ---------- supabase (service role) ----------
async function db(pathAndQuery, opts = {}) {
  const r = await fetch(SUPABASE_URL + "/rest/v1/" + pathAndQuery, {
    method: opts.method || "GET",
    headers: { apikey: SERVICE_KEY, Authorization: "Bearer " + SERVICE_KEY, "Content-Type": "application/json", Prefer: opts.prefer || "return=representation" },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const text = await r.text();
  let body; try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!r.ok) throw new Error("Supabase " + r.status + " on " + pathAndQuery + ": " + (body && body.message || text));
  return body;
}

// ---------- whoop ----------
async function refreshTokens(conn) {
  const form = new URLSearchParams({ grant_type: "refresh_token", refresh_token: conn.refresh_token, client_id: CLIENT_ID, client_secret: CLIENT_SECRET, scope: "offline" });
  const r = await fetch(W.WHOOP.tokenUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error("Whoop token refresh failed (" + r.status + "): " + (j.error_description || j.error || JSON.stringify(j)));
  return { access_token: j.access_token, refresh_token: j.refresh_token || conn.refresh_token, expires_at: new Date(Date.now() + (j.expires_in || 3600) * 1000).toISOString() };
}

async function fetchWorkouts(accessToken, window) {
  const records = [];
  let nextToken = null;
  for (let page = 0; page < 20; page++) {
    const q = new URLSearchParams({ start: window.start, end: window.end, limit: String(W.WHOOP.pageSize) });
    if (nextToken) q.set("nextToken", nextToken);
    const r = await fetch(W.WHOOP.workoutsUrl + "?" + q, { headers: { Authorization: "Bearer " + accessToken } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error("Whoop workouts failed (" + r.status + "): " + JSON.stringify(j));
    records.push(...(j.records || []));
    nextToken = j.next_token;
    if (!nextToken) break;
  }
  return records;
}

// ---------- main ----------
const connections = await db("whoop_connections?select=*");
if (!connections.length) { console.log("No Whoop connections yet. Run: node scripts/whoop-connect.mjs"); process.exit(0); }
const window = W.syncWindow(now, WINDOW_DAYS);
console.log("Syncing " + connections.length + " connection(s), window " + window.start + " → " + window.end + ", min " + MIN_MINUTES + " min, excluding " + (EXCLUDE.length ? EXCLUDE.join(", ") : "nothing"));

let failures = 0;
for (const conn of connections) {
  const tag = "[" + conn.user_id.slice(0, 8) + "]";
  try {
    // Access tokens live an hour and we run once a day, so refresh every time
    // and persist the rotated pair before anything else can fail.
    const fresh = await refreshTokens(conn);
    await db("whoop_connections?user_id=eq." + conn.user_id, { method: "PATCH", body: fresh, prefer: "return=minimal" });

    const players = await db("players?select=id,challenge_id,challenges(starts_on)&user_id=eq." + conn.user_id);
    const playerIds = W.activePlayerIds(players, now, { windowDays: WINDOW_DAYS });
    if (!playerIds.length) {
      console.log(tag + " connected but not in a running challenge; skipped");
      await db("whoop_connections?user_id=eq." + conn.user_id, { method: "PATCH", body: { last_synced_at: now.toISOString(), last_error: null }, prefer: "return=minimal" });
      continue;
    }

    const records = await fetchWorkouts(fresh.access_token, window);
    const candidates = W.toWorkoutRows(records, playerIds, { minMinutes: MIN_MINUTES, excludeSports: EXCLUDE });
    // Skip anything already logged. (The unique index on (player_id, external_id) is
    // partial, which PostgREST's on_conflict cannot target, so we filter here; the
    // index still guards against a race.)
    const existing = candidates.length
      ? await db("workouts?select=player_id,external_id&player_id=in.(" + playerIds.join(",") + ")&external_id=not.is.null")
      : [];
    const seen = new Set(existing.map((w) => w.player_id + "|" + w.external_id));
    const rows = candidates.filter((r) => !seen.has(r.player_id + "|" + r.external_id));
    let inserted = [];
    if (rows.length) inserted = await db("workouts", { method: "POST", body: rows, prefer: "return=representation" });
    console.log(tag + " " + records.length + " Whoop workout(s) in window, " + candidates.length + " eligible, " + inserted.length + " new");
    inserted.forEach((r) => console.log("   + " + r.happened_at + "  " + r.note));
    await db("whoop_connections?user_id=eq." + conn.user_id, { method: "PATCH", body: { last_synced_at: now.toISOString(), last_error: null }, prefer: "return=minimal" });
  } catch (err) {
    failures++;
    console.error(tag + " FAILED: " + err.message);
    await db("whoop_connections?user_id=eq." + conn.user_id, { method: "PATCH", body: { last_error: String(err.message).slice(0, 500) }, prefer: "return=minimal" }).catch(() => {});
  }
}
console.log(failures ? failures + " connection(s) failed" : "Done.");
process.exit(failures === connections.length ? 1 : 0);
