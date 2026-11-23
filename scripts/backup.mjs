#!/usr/bin/env node
// backup.mjs — read-only export of every table with the service role key (from .env) to a JSON file.
import fs from "node:fs";
const env = Object.fromEntries(fs.readFileSync(".env","utf8").split("\n").filter(l=>/^[A-Z_]+=/.test(l)).map(l=>{const i=l.indexOf("=");return [l.slice(0,i),l.slice(i+1).trim()];}));
const URL_ = env.SUPABASE_URL.replace(/\/$/,""), KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const out = { exported_at: new Date().toISOString(), project: URL_, tables: {} };
for (const t of ["challenges","players","goals","checkins","profiles","whoop_connections"]) {
  const r = await fetch(URL_+"/rest/v1/"+t+"?select=*&order=created_at", { headers: { apikey: KEY, Authorization: "Bearer "+KEY } });
  if (!r.ok) throw new Error(t+" "+r.status+" "+await r.text());
  out.tables[t] = await r.json();
  console.log(t.padEnd(18), out.tables[t].length, "rows");
}
const file = process.argv[2];
fs.writeFileSync(file, JSON.stringify(out, null, 1), { mode: 0o600 });
console.log("wrote", file, fs.statSync(file).size, "bytes");
