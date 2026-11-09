#!/usr/bin/env node
/*
  whoop-connect.mjs — one-time Whoop login for a player. Run on your Mac:
    node scripts/whoop-connect.mjs

  1. Pick which person (by their game name) is connecting.
  2. Open the printed Whoop link, approve, land on the callback page.
  3. Paste the code (or the whole URL) back here.
  Tokens are stored in whoop_connections using the service role key from .env.

  For a friend: send them the link, they approve and send you the code.

  Non-interactive (for agents / scripts):
    node scripts/whoop-connect.mjs --list                 list characters
    node scripts/whoop-connect.mjs --who "Name" --url     print the login link, remember state
    node scripts/whoop-connect.mjs --who "Name" --code X  finish with the pasted code
*/
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const W = require("./whoop-lib.cjs");

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
const REDIRECT_URI = process.env.WHOOP_REDIRECT_URI || "https://building-with-ai-f26.github.io/sc12439-LockIn/whoop-callback.html";

async function db(pathAndQuery, opts = {}) {
  const r = await fetch(SUPABASE_URL + "/rest/v1/" + pathAndQuery, {
    method: opts.method || "GET",
    headers: { apikey: SERVICE_KEY, Authorization: "Bearer " + SERVICE_KEY, "Content-Type": "application/json", Prefer: opts.prefer || "return=representation" },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const text = await r.text(); let body; try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!r.ok) throw new Error("Supabase " + r.status + ": " + (body && body.message || text));
  return body;
}

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? (args[i + 1] || true) : null; };
const stateFile = path.join(os.tmpdir(), "lockin-whoop-connect.json");
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
try {
  const profiles = await db("profiles?select=user_id,name,created_at&order=created_at.asc");
  if (!profiles.length) { console.log("No characters yet. Open the game, build your character, then run this again."); process.exit(1); }
  const connected = new Set((await db("whoop_connections?select=user_id")).map((c) => c.user_id));
  const list = () => profiles.forEach((p, i) => console.log("  " + (i + 1) + ") " + p.name + (connected.has(p.user_id) ? "   (already connected, will replace)" : "")));
  if (flag("--list")) { list(); process.exit(0); }

  let who;
  if (flag("--who")) {
    who = profiles.find((p) => p.name.toLowerCase() === String(flag("--who")).toLowerCase());
    if (!who) { console.log("No character named " + flag("--who") + ". Use --list."); process.exit(1); }
  } else {
    console.log("\nWho is connecting their Whoop?\n"); list();
    const pick = parseInt(await rl.question("\nNumber: "), 10);
    who = profiles[pick - 1];
    if (!who) { console.log("No such number."); process.exit(1); }
  }

  let state, pasted;
  if (flag("--code")) {
    // Second half of the non-interactive flow: state was saved by --url.
    pasted = String(flag("--code"));
    try { state = JSON.parse(fs.readFileSync(stateFile, "utf8")).state; } catch { state = null; }
  } else {
    state = Math.random().toString(36).slice(2, 10).padEnd(8, "0");   // Whoop wants exactly 8 chars
    const url = W.authUrl({ clientId: CLIENT_ID, redirectUri: REDIRECT_URI, state });
    fs.writeFileSync(stateFile, JSON.stringify({ state, who: who.user_id, at: new Date().toISOString() }), { mode: 0o600 });
    console.log("\n1. Open this link (" + who.name + " must be the one logging in):\n\n   " + url + "\n");
    if (flag("--url")) { console.log("2. Approve, copy the code from the callback page, then run:\n   node scripts/whoop-connect.mjs --who \"" + who.name + "\" --code <CODE>"); process.exit(0); }
    if (process.platform === "darwin") spawn("open", [url], { stdio: "ignore", detached: true }).unref();
    console.log("2. Approve. You land on the callback page, which shows a code.");
    pasted = await rl.question("3. Paste the code or the whole URL here: ");
  }
  const cb = W.parseCallback(pasted);
  if (!cb || !cb.code) { console.log("No code found."); process.exit(1); }
  if (cb.state && state && cb.state !== state) { console.log("State mismatch: that code came from a different login attempt. Start over."); process.exit(1); }

  const form = new URLSearchParams({ grant_type: "authorization_code", code: cb.code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET, redirect_uri: REDIRECT_URI });
  const tr = await fetch(W.WHOOP.tokenUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form });
  const tok = await tr.json().catch(() => ({}));
  if (!tr.ok || !tok.access_token) { console.log("Whoop rejected the code (" + tr.status + "): " + (tok.error_description || JSON.stringify(tok))); process.exit(1); }
  if (!tok.refresh_token) { console.log("Whoop returned no refresh token. Make sure the app requests the offline scope."); process.exit(1); }

  let whoopUserId = null;
  const pr = await fetch(W.WHOOP.profileUrl, { headers: { Authorization: "Bearer " + tok.access_token } });
  if (pr.ok) { const pj = await pr.json(); whoopUserId = pj.user_id || null; console.log("\nWhoop says hi to " + (pj.first_name || "") + " " + (pj.last_name || "") + "."); }

  await db("whoop_connections?on_conflict=user_id", {
    method: "POST", prefer: "return=minimal,resolution=merge-duplicates",
    body: { user_id: who.user_id, whoop_user_id: whoopUserId, access_token: tok.access_token, refresh_token: tok.refresh_token, expires_at: new Date(Date.now() + (tok.expires_in || 3600) * 1000).toISOString(), last_error: null }
  });
  console.log("Connected " + who.name + ". Workouts of " + (process.env.WHOOP_MIN_MINUTES || W.DEFAULTS.minMinutes) + "+ minutes will be logged nightly at 11:59 PM Eastern.");
  console.log("Try it now:  node scripts/whoop-sync.mjs --force");
} finally {
  rl.close();
}
