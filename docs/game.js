/*
  game.js — browser glue for Lock-In Party.
  Talks to Supabase, renders the views, and leans on game-rules.js for all
  the math. Each device signs in anonymously; that identity owns one
  player row per challenge.
*/
(function () {
  "use strict";
  var cfg = window.LOCKIN_SUPABASE || {};
  var $ = function (id) { return document.getElementById(id); };
  var sb = null, uid = null;
  var challenge = null, me = null, players = [], workouts = [];
  var builder = null;         // CharacterUI instance, mounted on first intake
  var lastSummary = null;     // to detect a level-up after logging

  // ---------- tiny helpers ----------
  function show(view) {
    document.querySelectorAll("[data-view]").forEach(function (el) { el.hidden = el.dataset.view !== view; });
  }
  function msg(id, text, kind) { var el = $(id); el.textContent = text || ""; el.className = "msg" + (kind ? " " + kind : ""); }
  function todayISO() { return GameRules.toDay(new Date()); }
  function inviteCode() {
    var chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789", out = "";
    for (var i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function fail(id, error) { console.error(error); msg(id, (error && error.message) || String(error), "err"); }

  // ---------- boot ----------
  async function init() {
    if (!cfg.url || !cfg.anonKey) { show("setup"); return; }
    sb = window.supabase.createClient(cfg.url, cfg.anonKey);
    var s = await sb.auth.getSession();
    var session = s.data.session;
    if (!session) {
      var r = await sb.auth.signInAnonymously();
      if (r.error) { show("setup"); msg("setupMsg", "Anonymous sign-in failed: " + r.error.message + ". Turn on Anonymous sign-ins under Authentication → Providers.", "err"); return; }
      session = r.data.session;
    }
    uid = session.user.id;

    var joinMatch = location.hash.match(/^#\/join\/([A-Z0-9]+)/i);
    var mine = await sb.from("players").select("*").eq("user_id", uid).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (mine.error) { show("setup"); msg("setupMsg", "Could not read players: " + mine.error.message + ". Did you run supabase/schema.sql?", "err"); return; }
    if (mine.data && !joinMatch) {
      me = mine.data;
      var c = await sb.from("challenges").select("*").eq("id", me.challenge_id).single();
      challenge = c.data;
      await refresh();
      show("play");
      return;
    }
    $("cStart").value = todayISO();
    if (joinMatch) { $("joinCode").value = joinMatch[1].toUpperCase(); await join(); return; }
    show("home");
  }

  // ---------- home ----------
  async function create() {
    var name = $("cName").value.trim();
    if (!name) { msg("createMsg", "Give the challenge a name.", "err"); return; }
    msg("createMsg", "Creating…");
    var r = await sb.from("challenges").insert({ name: name, starts_on: $("cStart").value || todayISO(), invite_code: inviteCode(), created_by: uid }).select().single();
    if (r.error) { fail("createMsg", r.error); return; }
    challenge = r.data;
    openIntake();
  }
  async function join() {
    var code = $("joinCode").value.trim().toUpperCase();
    if (!code) { msg("joinMsg", "Enter the invite code.", "err"); show("home"); return; }
    msg("joinMsg", "Looking up…");
    var r = await sb.from("challenges").select("*").eq("invite_code", code).maybeSingle();
    if (r.error) { fail("joinMsg", r.error); show("home"); return; }
    if (!r.data) { show("home"); msg("joinMsg", "No challenge with code " + code + ".", "err"); return; }
    challenge = r.data;
    // Already in this one? Go straight to play.
    var existing = await sb.from("players").select("*").eq("user_id", uid).eq("challenge_id", challenge.id).maybeSingle();
    if (existing.data) { me = existing.data; await refresh(); show("play"); return; }
    openIntake();
  }

  // ---------- intake ----------
  function openIntake() {
    $("intakeChallenge").textContent = challenge.name + " (starts " + challenge.starts_on + ")";
    if (!builder) builder = CharacterUI.mount($("builder"), { initial: Sprite.randomOptions() });
    updateGoalPreview();
    show("intake");
  }
  function goalText(n) { return "Work out " + n + "× per week"; }
  function updateGoalPreview() { $("goalPreview").textContent = "Your locked goal: “" + goalText($("pPerWeek").value) + "” for 90 days."; }

  async function lockIn() {
    var name = $("pName").value.trim();
    if (!name) { msg("lockMsg", "Tell us your name.", "err"); return; }
    var n = +$("pPerWeek").value;
    if (!confirm("Lock in “" + goalText(n) + "” for 90 days? This cannot be changed.")) return;
    msg("lockMsg", "Locking in…");
    var r = await sb.from("players").insert({
      challenge_id: challenge.id, user_id: uid, name: name, avatar_data_url: builder ? builder.getDataURL(1) : null,
      goal_type: "fitness", goal_per_week: n, goal_text: goalText(n)
    }).select().single();
    if (r.error) { fail("lockMsg", r.error); return; }
    me = r.data;
    await refresh();
    show("play");
  }

  // ---------- play ----------
  async function refresh() {
    var p = await sb.from("players").select("*").eq("challenge_id", challenge.id).order("created_at");
    if (p.error) { fail("logMsg", p.error); return; }
    players = p.data;
    var ids = players.map(function (x) { return x.id; });
    var w = await sb.from("workouts").select("*").in("player_id", ids).order("happened_at");
    if (w.error) { fail("logMsg", w.error); return; }
    workouts = w.data;
    render();
  }
  function summaryFor(player) {
    return GameRules.summarize({
      startsOn: challenge.starts_on, perWeek: player.goal_per_week,
      workouts: workouts.filter(function (x) { return x.player_id === player.id; })
    });
  }
  function pieceHTML(player, size) {
    return player.avatar_data_url
      ? '<img class="avatar" src="' + player.avatar_data_url + '" alt="" title="' + esc(player.name) + '">'
      : '<b title="' + esc(player.name) + '">' + esc(player.name.slice(0, 1).toUpperCase()) + "</b>";
  }
  function render() {
    var s = summaryFor(me);
    $("playChallenge").textContent = challenge.name.toUpperCase();
    $("playMeta").textContent = challenge.starts_on + " → " + s.endsOn + " · invite code " + challenge.invite_code + " · " + players.length + " player" + (players.length === 1 ? "" : "s");
    if (me.avatar_data_url) $("meAvatar").src = me.avatar_data_url;
    $("meAvatar").hidden = !me.avatar_data_url;
    $("meName").textContent = me.name.toUpperCase() + " · " + s.title;
    $("meGoal").textContent = me.goal_text + " · " + s.totalWorkouts + " workouts logged";
    $("sLevel").textContent = s.level;
    $("sPos").textContent = s.position + "/" + GameRules.RULES.boardSize;
    $("sStreak").textContent = s.streak;
    $("sDays").textContent = s.daysLeft;

    if (!s.started) {
      $("weekLabel").textContent = "STARTS " + challenge.starts_on;
      $("weekMsg").textContent = "The challenge hasn't started yet. Workouts logged now won't count.";
    } else if (s.over) {
      $("weekLabel").textContent = "CHALLENGE OVER";
      $("weekMsg").textContent = s.finished ? "You reached FINISH. Locked in." : "90 days done. Final level " + s.level + ".";
    } else {
      $("weekLabel").textContent = "WEEK " + (s.currentWeek + 1) + " OF " + s.totalWeeks + " · " + s.thisWeekCount + "/" + me.goal_per_week;
      $("weekMsg").textContent = s.thisWeekHit ? "Week hit. Anything extra is gravy." : s.thisWeekRemaining + " more to hit this week.";
    }
    var pips = "";
    for (var i = 0; i < me.goal_per_week; i++) pips += '<i class="' + (i < s.thisWeekCount ? "on" : "") + '"></i>';
    $("pips").innerHTML = pips;
    $("weeks").innerHTML = s.weeks.map(function (wk) {
      var cls = wk.status === "current" ? "current " : "";
      if (wk.scored) cls += wk.hit ? "hit" : "miss";
      return '<i class="' + cls + '" title="Week ' + (wk.index + 1) + ": " + wk.count + " workouts\"></i>";
    }).join("");
    $("logBtn").disabled = !s.started || s.over;
    $("logDate").max = todayISO();

    // Standings: by position, then level, then workouts.
    var rows = players.map(function (pl) { return { p: pl, s: summaryFor(pl) }; });
    rows.sort(function (a, b) { return b.s.position - a.s.position || b.s.level - a.s.level || b.s.totalWorkouts - a.s.totalWorkouts; });
    $("standings").innerHTML = rows.map(function (r, i) {
      return '<tr class="' + (r.p.id === me.id ? "me" : "") + '"><td class="n">' + (i + 1) + "</td><td>" + pieceHTML(r.p) + "</td>" +
        "<td><strong>" + esc(r.p.name) + "</strong><br><span class=\"muted\" style=\"font-size:13px\">" + esc(r.p.goal_text) + " · wk " + r.s.thisWeekCount + "/" + r.p.goal_per_week + "</span></td>" +
        '<td class="n">LV ' + r.s.level + "<br>" + r.s.position + "</td></tr>";
    }).join("");

    // Board: cells 0..40, pieces stacked where players stand.
    var byPos = {};
    rows.forEach(function (r) { (byPos[r.s.position] = byPos[r.s.position] || []).push(r.p); });
    var cells = "";
    for (var c = 0; c <= GameRules.RULES.boardSize; c++) {
      var label = c === 0 ? "START" : c === GameRules.RULES.boardSize ? "FINISH" : c;
      cells += '<div class="cell ' + (c === 0 ? "start" : c === GameRules.RULES.boardSize ? "finish" : "") + '">' + label +
        '<div class="pieces">' + (byPos[c] || []).map(function (pl) { return pieceHTML(pl); }).join("") + "</div></div>";
    }
    $("board").innerHTML = cells;

    // Level-up banner when a log pushed us over the line.
    if (lastSummary && s.level > lastSummary.level) {
      $("levelup").textContent = "LEVEL UP! LV " + s.level + " · " + s.title + " · +" + (s.position - lastSummary.position) + " SPACES";
      $("levelup").classList.add("show");
      setTimeout(function () { $("levelup").classList.remove("show"); }, 6000);
    }
    lastSummary = s;
  }

  async function logWorkout(whenISO) {
    msg("logMsg", "Logging…");
    var r = await sb.from("workouts").insert({ player_id: me.id, happened_at: whenISO, source: "manual" });
    if (r.error) { fail("logMsg", r.error); return; }
    msg("logMsg", "Logged. Keep going.", "ok");
    await refresh();
  }
  async function undoLast() {
    var mine = workouts.filter(function (x) { return x.player_id === me.id && x.source === "manual"; });
    if (!mine.length) { msg("logMsg", "Nothing to undo.", "err"); return; }
    var last = mine.sort(function (a, b) { return a.created_at < b.created_at ? 1 : -1; })[0];
    var r = await sb.from("workouts").delete().eq("id", last.id);
    if (r.error) { fail("logMsg", r.error); return; }
    msg("logMsg", "Removed your last manual workout.", "ok");
    await refresh();
  }

  // ---------- wiring ----------
  $("createBtn").addEventListener("click", create);
  $("joinBtn").addEventListener("click", join);
  $("pPerWeek").addEventListener("change", updateGoalPreview);
  $("lockBtn").addEventListener("click", lockIn);
  $("logBtn").addEventListener("click", function () { logWorkout(new Date().toISOString()); });
  $("logPastBtn").addEventListener("click", function () {
    var d = $("logDate").value; if (!d) { msg("logMsg", "Pick a date first.", "err"); return; }
    logWorkout(new Date(d + "T12:00:00").toISOString());   // noon local, so it lands on that calendar day
  });
  $("undoBtn").addEventListener("click", undoLast);
  $("refreshBtn").addEventListener("click", refresh);
  $("shareBtn").addEventListener("click", function () {
    var link = location.origin + location.pathname + "#/join/" + challenge.invite_code;
    navigator.clipboard.writeText(link).then(function () { msg("logMsg", "Invite link copied: " + link, "ok"); }, function () { prompt("Copy this invite link:", link); });
  });
  $("signout").addEventListener("click", async function (e) {
    e.preventDefault();
    if (!sb || !confirm("Sign out of this device identity? You will not be able to get this player back.")) return;
    await sb.auth.signOut(); location.hash = ""; location.reload();
  });

  init().catch(function (err) { show("setup"); msg("setupMsg", "Startup error: " + (err.message || err), "err"); });
})();
