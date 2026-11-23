#!/usr/bin/env node
// security-test.mjs — security audit: access-control tests against the live project using only the
// PUBLIC anon key, (1) with nobody signed in and (2) as a fresh anonymous
// account B attacking account A's rows. Every write here is one Row Level
// Security must refuse; a backup was taken first (backups/lockin-2026-11-23.json).
import fs from "node:fs";
const cfg = fs.readFileSync("docs/supabase-config.js","utf8");
const URL_ = cfg.match(/url:\s*"([^"]+)"/)[1].replace(/\/$/,"");
const ANON = cfg.match(/(?:anonKey|key):\s*"([^"]+)"/)[1];
const H = (tok, extra={}) => ({ apikey: ANON, Authorization: "Bearer " + (tok||ANON), "Content-Type":"application/json", ...extra });
async function rest(path, opts={}, tok){
  const r = await fetch(URL_+"/rest/v1/"+path,{method:opts.method||"GET",headers:H(tok,{Prefer:"return=representation"}),body:opts.body?JSON.stringify(opts.body):undefined});
  const t = await r.text(); let rows = null; try { rows = JSON.parse(t); } catch {}
  return { status: r.status, body: Array.isArray(rows) ? rows.length + " row(s) affected/returned" : t.slice(0,140) };
}
async function anonUser(){ const r=await fetch(URL_+"/auth/v1/signup",{method:"POST",headers:H(),body:JSON.stringify({data:{}})}); const j=await r.json(); if(!j.access_token) throw new Error("anon sign-in failed "+JSON.stringify(j).slice(0,200)); return j; }
const log=(n,r)=>console.log(n.padEnd(52), String(r.status).padEnd(4), r.body);
console.log("Project:", URL_, "· key: public anon key only ·", new Date().toISOString());
console.log("\n## Test 1: nobody signed in (plain public key)");
log("1a read players",              await rest("players?select=id,name&limit=3"));
log("1b insert a check-in",         await rest("checkins",{method:"POST",body:{player_id:"00000000-0000-0000-0000-000000000000",note:"attack"}}));
log("1c delete every check-in",     await rest("checkins?id=neq.00000000-0000-0000-0000-000000000000",{method:"DELETE"}));
log("1d read Whoop tokens",         await rest("whoop_connections?select=user_id"));
console.log("\n## Test 2: account B (fresh anonymous sign-in) attacks account A (Sheshu)");
const B = await anonUser(); const bt = B.access_token; console.log("B =", B.user.id.slice(0,8)+"…");
const players = await (await fetch(URL_+"/rest/v1/players?select=id,name,user_id,challenge_id&name=ilike.sheshu*&limit=1",{headers:H(bt)})).json();
const A = players[0]; console.log("A =", A.name, A.id.slice(0,8)+"…");
const aCheck = await (await fetch(URL_+"/rest/v1/checkins?select=id,goal_id&player_id=eq."+A.id+"&limit=1",{headers:H(bt)})).json();
log("2a B reads A's check-ins (shared board, by design)", {status:200, body:aCheck.length+" row(s) visible"});
log("2b B inserts a check-in for A",  await rest("checkins",{method:"POST",body:{player_id:A.id,goal_id:aCheck[0].goal_id,note:"forged"}},bt));
log("2c B deletes A's check-in",      await rest("checkins?id=eq."+aCheck[0].id,{method:"DELETE"},bt));
log("2d B renames A's player",        await rest("players?id=eq."+A.id,{method:"PATCH",body:{name:"pwned"}},bt));
log("2e B deletes A's group",         await rest("challenges?id=eq."+A.challenge_id,{method:"DELETE"},bt));
log("2f B renames A's group",         await rest("challenges?id=eq."+A.challenge_id,{method:"PATCH",body:{name:"pwned"}},bt));
log("2g B reads Whoop tokens",        await rest("whoop_connections?select=user_id",{},bt));
log("2h B adds a goal to A's player", await rest("goals",{method:"POST",body:{player_id:A.id,type:"dry",per_week:7,text:"forged"}},bt));
log("2i B lists every invite code",   await rest("challenges?select=invite_code",{},bt));
log("2j B edits A's profile",         await rest("profiles?user_id=eq."+A.user_id,{method:"PATCH",body:{name:"pwned"}},bt));
console.log("\nVerify A untouched:");
const after = await (await fetch(URL_+"/rest/v1/players?select=name&id=eq."+A.id,{headers:H(bt)})).json();
const stillThere = await (await fetch(URL_+"/rest/v1/checkins?select=id&id=eq."+aCheck[0].id,{headers:H(bt)})).json();
console.log("A player name:", after[0] && after[0].name, "· A check-in still present:", stillThere.length === 1);
