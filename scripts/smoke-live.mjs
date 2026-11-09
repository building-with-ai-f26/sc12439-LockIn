const cfgSrc = await (await import("node:fs")).promises.readFile(process.argv[2], "utf8");
const URL_ = cfgSrc.match(/url:\s*"([^"]+)"/)[1], KEY = cfgSrc.match(/anonKey:\s*"([^"]+)"/)[1];
// Live smoke test: node scripts/smoke-live.mjs docs/supabase-config.js
// Creates two anonymous identities and a throwaway group (code SMOKE + 2 chars),
// then deletes the group at the end (that is one of the checks). The two
// throwaway profiles stay: delete from profiles where name like 'Smoke%';
const CODE = "SMOKE" + Math.random().toString(36).slice(2, 4).toUpperCase();
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok, detail }); console.log((ok ? "PASS " : "FAIL ") + name + (detail ? "  — " + detail : "")); };
async function anon() {
  const r = await fetch(URL_ + "/auth/v1/signup", { method: "POST", headers: { apikey: KEY, "Content-Type": "application/json" }, body: "{}" });
  const j = await r.json(); if (!j.access_token) throw new Error("anon sign-in failed: " + JSON.stringify(j));
  return { token: j.access_token, uid: j.user.id };
}
function api(user) {
  return async (path, opts = {}) => {
    const r = await fetch(URL_ + "/rest/v1/" + path, { ...opts, headers: { apikey: KEY, Authorization: "Bearer " + user.token, "Content-Type": "application/json", Prefer: opts.prefer || "return=representation", ...(opts.headers || {}) } });
    const text = await r.text(); let body; try { body = JSON.parse(text); } catch { body = text; }
    return { status: r.status, body };
  };
}
const look = { hair: "pompadour", hairColor: "#1A1A1A", skin: "#FFE0BD", glasses: true, top: "jacket", topColor: "#1A1A1A", shirtColor: "#F4F1FF", bottom: "pants", bottomColor: "#1F5FA8", shoesColor: "#1A1A1A" };
const png = "data:image/png;base64,iVBORw0KGgo=";
const A = await anon(), B = await anon(); const a = api(A), b = api(B);
console.log("identities", A.uid.slice(0, 8), B.uid.slice(0, 8));

let r = await a("profiles", { method: "POST", prefer: "return=representation,resolution=merge-duplicates", body: JSON.stringify({ user_id: A.uid, name: "SmokeA", avatar_data_url: png, avatar_options: look }) });
check("A upserts own profile", r.status === 201 && r.body[0]?.avatar_options?.hair === "pompadour", "status " + r.status);
r = await a("profiles", { method: "POST", prefer: "return=representation,resolution=merge-duplicates", body: JSON.stringify({ user_id: A.uid, name: "SmokeA2", avatar_data_url: png, avatar_options: look }) });
check("A upserts again (rename) → one row updated", (r.status === 200 || r.status === 201) && r.body[0]?.name === "SmokeA2", "status " + r.status);
r = await b("profiles", { method: "POST", prefer: "return=representation,resolution=merge-duplicates", body: JSON.stringify({ user_id: A.uid, name: "Hacked", avatar_data_url: png }) });
check("B cannot upsert A's profile", r.status === 401 || r.status === 403 || r.status === 409, "status " + r.status);
r = await b("profiles", { method: "POST", prefer: "return=representation,resolution=merge-duplicates", body: JSON.stringify({ user_id: B.uid, name: "SmokeB", avatar_data_url: png, avatar_options: { ...look, hair: "afro" } }) });
check("B upserts own profile", r.status === 201, "status " + r.status);
r = await b("profiles?select=user_id,name&order=created_at.desc&limit=5");
check("B can read all profiles (leaderboard needs names)", r.status === 200 && r.body.some(p => p.user_id === A.uid), "status " + r.status);

r = await a("challenges", { method: "POST", body: JSON.stringify({ name: "Smoke test " + CODE, starts_on: "2026-11-02", invite_code: CODE, created_by: A.uid }) });
check("A creates group " + CODE, r.status === 201, "status " + r.status + " " + (r.body?.message || ""));
const ch = r.body[0];
r = await a("players", { method: "POST", body: JSON.stringify({ challenge_id: ch.id, user_id: A.uid, name: "SmokeA2", avatar_data_url: png, avatar_options: look, goal_text: "Work out 1× per week", tracking: "manual" }) });
check("A locks in with avatar_options (no legacy goal columns)", r.status === 201 && r.body[0]?.avatar_options?.top === "jacket", "status " + r.status + " " + (r.body?.message || ""));
const pA = r.body[0];
r = await a("goals", { method: "POST", body: JSON.stringify([{ player_id: pA.id, type: "fitness", per_week: 1, settings: {}, text: "Work out 1× per week" }]) });
check("A adds a workouts goal", r.status === 201 && r.body[0]?.type === "fitness", "status " + r.status + " " + (r.body?.message || ""));
const gA = r.body[0];
r = await b("challenges?invite_code=eq." + CODE + "&select=*");
check("B finds the group by invite code", r.status === 200 && r.body[0]?.id === ch.id, "status " + r.status);
r = await b("players", { method: "POST", body: JSON.stringify({ challenge_id: ch.id, user_id: B.uid, name: "SmokeB", avatar_data_url: png, avatar_options: { ...look, hair: "afro" }, goal_text: "Work out 2× per week · No drinking all week", tracking: "manual" }) });
check("B locks in", r.status === 201, "status " + r.status + " " + (r.body?.message || ""));
const pB = r.body[0];
r = await b("goals", { method: "POST", body: JSON.stringify([
  { player_id: pB.id, type: "fitness", per_week: 2, settings: {}, text: "Work out 2× per week" },
  { player_id: pB.id, type: "dry", per_week: 7, settings: {}, text: "No drinking all week" }]) });
check("B adds two goals at once", r.status === 201 && r.body.length === 2, "status " + r.status + " " + (r.body?.message || ""));
const gB = r.body;
r = await b("goals", { method: "POST", body: JSON.stringify({ player_id: pA.id, type: "steps", per_week: 7, text: "x" }) });
check("B cannot add a goal to A's player", r.status === 401 || r.status === 403, "status " + r.status);
r = await a("checkins", { method: "POST", body: JSON.stringify({ player_id: pA.id, goal_id: gA.id, happened_at: "2026-11-03T12:00:00Z", source: "manual" }) });
check("A logs own check-in (week 0 hit → +10 LP)", r.status === 201, "status " + r.status + " " + (r.body?.message || ""));
r = await b("checkins", { method: "POST", body: JSON.stringify({ player_id: pA.id, goal_id: gA.id, happened_at: "2026-11-03T12:00:00Z", source: "manual" }) });
check("B cannot log a check-in for A", r.status === 401 || r.status === 403, "status " + r.status);
r = await b("players?user_id=eq." + B.uid, { method: "PATCH", body: JSON.stringify({ goal_text: "changed" }) });
check("B cannot change the locked goal summary", r.status === 400 && /locked/i.test(r.body?.message || ""), "status " + r.status + " " + (r.body?.message || ""));
r = await b("goals?id=eq." + gB[0].id, { method: "PATCH", body: JSON.stringify({ per_week: 1 }) });
check("B cannot loosen a locked goal (0 rows touched)", r.status === 200 && Array.isArray(r.body) && r.body.length === 0, "status " + r.status + " rows " + (Array.isArray(r.body) ? r.body.length : "?"));
r = await b("goals?id=eq." + gB[1].id, { method: "DELETE" });
check("B cannot delete a goal (0 rows touched)", r.status === 200 && Array.isArray(r.body) && r.body.length === 0, "status " + r.status + " rows " + (Array.isArray(r.body) ? r.body.length : "?"));
r = await b("players?user_id=eq." + B.uid, { method: "PATCH", body: JSON.stringify({ tracking: "whoop" }) });
check("B switches tracking to Whoop", r.status === 200 && r.body[0]?.tracking === "whoop", "status " + r.status + " " + (r.body?.message || ""));
r = await b("players?user_id=eq." + B.uid, { method: "PATCH", body: JSON.stringify({ name: "SmokeB!", avatar_options: { ...look, hair: "buzz" } }) });
check("B updates own name + avatar_options (edit character)", r.status === 200 && r.body[0]?.avatar_options?.hair === "buzz", "status " + r.status);
r = await b("players?user_id=eq." + A.uid, { method: "PATCH", body: JSON.stringify({ name: "Pwned" }) });
check("B's update of A's player affects 0 rows", r.status === 200 && Array.isArray(r.body) && r.body.length === 0, "status " + r.status + " rows " + (Array.isArray(r.body) ? r.body.length : "?"));
r = await b("players?challenge_id=eq." + ch.id + "&select=name,avatar_options,tracking,goals(type,per_week)");
check("Leaderboard read returns both players with options and goals", r.status === 200 && r.body.length === 2 && r.body.every(p => p.avatar_options && p.goals.length), "status " + r.status + " " + (r.body?.message || ""));
const none = await fetch(URL_ + "/rest/v1/players?select=id", { headers: { apikey: KEY } }); const nb = await none.json();
check("No session → no rows", Array.isArray(nb) && nb.length === 0, "status " + none.status);

// Group management (005): creator only.
r = await b("challenges?id=eq." + ch.id, { method: "PATCH", body: JSON.stringify({ name: "Hijacked" }) });
check("B (not creator) renaming the group touches 0 rows", r.status === 200 && Array.isArray(r.body) && r.body.length === 0, "status " + r.status + " rows " + (Array.isArray(r.body) ? r.body.length : "?"));
r = await a("challenges?id=eq." + ch.id, { method: "PATCH", body: JSON.stringify({ name: "Smoke test " + CODE + " renamed" }) });
check("A (creator) renames the group", r.status === 200 && r.body[0]?.name?.endsWith("renamed"), "status " + r.status + " " + (r.body?.message || ""));
r = await a("challenges?id=eq." + ch.id, { method: "PATCH", body: JSON.stringify({ starts_on: "2026-12-01" }) });
check("A cannot move the start date of a started group", r.status === 400 && /started/i.test(r.body?.message || ""), "status " + r.status + " " + (r.body?.message || ""));
r = await b("players?id=eq." + pA.id, { method: "DELETE" });
check("B cannot remove A (0 rows)", r.status === 200 && Array.isArray(r.body) && r.body.length === 0, "status " + r.status);
r = await a("players?id=eq." + pB.id, { method: "DELETE" });
check("A removes B from the group", r.status === 200 && r.body[0]?.id === pB.id, "status " + r.status + " " + (r.body?.message || ""));
r = await a("goals?player_id=eq." + pB.id + "&select=id");
check("B's goals went with them (cascade)", r.status === 200 && r.body.length === 0, "status " + r.status + " rows " + r.body.length);
r = await b("challenges?id=eq." + ch.id, { method: "DELETE" });
check("B cannot delete the group (0 rows)", r.status === 200 && Array.isArray(r.body) && r.body.length === 0, "status " + r.status);
r = await a("challenges?id=eq." + ch.id, { method: "DELETE" });
check("A deletes the group", r.status === 200 && r.body[0]?.id === ch.id, "status " + r.status + " " + (r.body?.message || ""));
r = await a("players?challenge_id=eq." + ch.id + "&select=id");
check("Players vanished with the group (cascade)", r.status === 200 && r.body.length === 0, "status " + r.status + " rows " + r.body.length);

const fails = results.filter(x => !x.ok).length;
console.log("\n" + (results.length - fails) + "/" + results.length + " passed");
process.exit(fails ? 1 : 0);
