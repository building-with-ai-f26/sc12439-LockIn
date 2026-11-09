/*
  game.js — browser glue for Lock-In Party.
  Talks to Supabase, renders the views, and leans on game-rules.js for all
  the math. Each device signs in anonymously; that identity owns one
  profile (your character) and one player row per group.

  Flow: character (profiles) → group (challenges) → goal (players) → play.
*/
(function () {
  "use strict";
  var cfg = window.LOCKIN_SUPABASE || {};
  var $ = function (id) { return document.getElementById(id); };
  var sb = null, uid = null;
  var profile = null;         // my character: { name, avatar_data_url, avatar_options }
  var challenge = null, me = null, players = [], workouts = [];
  var builder = null;         // CharacterUI instance, mounted on first use
  var afterCharacter = null;  // where to go once the character is saved
  var lastSummary = null;     // to detect a hit or evolution after logging

  // ---------- tiny helpers ----------
  function show(view) {
    document.querySelectorAll("[data-view]").forEach(function (el) { el.hidden = el.dataset.view !== view; });
    window.scrollTo(0, 0);
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
  // Draw a character onto a canvas at a stage; falls back to the stored PNG when we only have that.
  function drawPiece(canvas, options, dataUrl, stage) {
    if (options) { CharacterUI.draw(canvas, options, 1, false, stage || 1); return; }
    canvas.width = Sprite.WIDTH; canvas.height = Sprite.HEIGHT;
    var ctx = canvas.getContext("2d"); ctx.imageSmoothingEnabled = false; ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!dataUrl) return;
    var img = new Image(); img.onload = function () { ctx.drawImage(img, 0, 0, Sprite.WIDTH, Sprite.HEIGHT); }; img.src = dataUrl;
  }

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
    Analytics.identify(uid);

    var joinMatch = location.hash.match(/^#\/join\/([A-Z0-9]+)/i);
    var pr = await sb.from("profiles").select("*").eq("user_id", uid).maybeSingle();
    if (pr.error) { show("setup"); msg("setupMsg", "Could not read profiles: " + pr.error.message + ". Run supabase/002-profiles.sql (or the full schema.sql) in the SQL editor.", "err"); return; }
    profile = pr.data;

    var next = joinMatch
      ? function () { $("joinCode").value = joinMatch[1].toUpperCase(); return join(); }
      : async function () {
        var mine = await sb.from("players").select("*").eq("user_id", uid).order("created_at", { ascending: false }).limit(1).maybeSingle();
        if (mine.error) { show("setup"); msg("setupMsg", "Could not read players: " + mine.error.message + ". Did you run supabase/schema.sql?", "err"); return; }
        if (mine.data) {
          me = mine.data;
          var c = await sb.from("challenges").select("*").eq("id", me.challenge_id).single();
          challenge = c.data;
          await refresh();
          show("play");
          return;
        }
        openHome();
      };
    if (!profile) { openCharacter(next); return; }   // step 1 first, for a brand-new identity
    await next();
  }

  // ---------- step 1: character ----------
  function openCharacter(then) {
    afterCharacter = then;
    if (!builder) {
      builder = CharacterUI.mount($("builder"), { initial: (profile && profile.avatar_options) || Sprite.randomOptions() });
    }
    if (profile) { $("pName").value = profile.name; $("charIntro").textContent = "Change your look or name. Your group sees the update right away."; }
    show("character");
    $("pName").focus();
  }
  async function saveCharacter() {
    var name = $("pName").value.trim();
    if (!name) { msg("charMsg", "Tell us your name first.", "err"); $("pName").focus(); return; }
    msg("charMsg", "Saving…");
    var row = { user_id: uid, name: name, avatar_data_url: builder.getDataURL(1), avatar_options: builder.getOptions() };
    var r = await sb.from("profiles").upsert(row).select().single();
    if (r.error) { fail("charMsg", r.error); return; }
    var isNew = !profile;
    profile = r.data;
    Analytics.track(isNew ? "character_created" : "character_edited", { hair: row.avatar_options.hair, top: row.avatar_options.top, glasses: !!row.avatar_options.glasses });
    // Keep my player rows in sync so the leaderboard shows the new look.
    await sb.from("players").update({ name: name, avatar_data_url: row.avatar_data_url, avatar_options: row.avatar_options }).eq("user_id", uid);
    if (me) { me.name = name; me.avatar_data_url = row.avatar_data_url; me.avatar_options = row.avatar_options; }
    msg("charMsg", "");
    var then = afterCharacter; afterCharacter = null;
    if (then) await then(); else if (me) { await refresh(); show("play"); } else openHome();
  }

  // ---------- step 2: group ----------
  function openHome() {
    $("cStart").value = todayISO();
    $("homeName").textContent = profile.name.toUpperCase();
    drawPiece($("homePiece"), profile.avatar_options, profile.avatar_data_url, 1);
    show("home");
  }
  async function create() {
    var name = $("cName").value.trim();
    if (!name) { msg("createMsg", "Give the group a name.", "err"); return; }
    msg("createMsg", "Creating…");
    var r = await sb.from("challenges").insert({ name: name, starts_on: $("cStart").value || todayISO(), invite_code: inviteCode(), created_by: uid }).select().single();
    if (r.error) { fail("createMsg", r.error); return; }
    challenge = r.data;
    Analytics.track("group_created", { starts_on: challenge.starts_on });
    openIntake();
  }
  async function join() {
    var code = $("joinCode").value.trim().toUpperCase();
    if (!code) { msg("joinMsg", "Enter the invite code.", "err"); openHome(); return; }
    msg("joinMsg", "Looking up…");
    var r = await sb.from("challenges").select("*").eq("invite_code", code).maybeSingle();
    if (r.error) { fail("joinMsg", r.error); openHome(); return; }
    if (!r.data) { openHome(); msg("joinMsg", "No group with code " + code + ".", "err"); return; }
    challenge = r.data;
    // Already in this one? Go straight to play.
    var existing = await sb.from("players").select("*").eq("user_id", uid).eq("challenge_id", challenge.id).maybeSingle();
    if (existing.data) { me = existing.data; await refresh(); show("play"); return; }
    Analytics.track("group_joined", { via_link: !!location.hash });
    openIntake();
  }

  // ---------- step 3: goal ----------
  function openIntake() {
    $("intakeChallenge").textContent = challenge.name + " (starts " + challenge.starts_on + ")";
    $("pieceName").textContent = profile.name;
    drawPiece($("piecePreview"), profile.avatar_options, profile.avatar_data_url, 1);
    updateGoalPreview();
    show("intake");
  }
  function goalText(n) { return "Work out " + n + "× per week"; }
  function updateGoalPreview() { $("goalPreview").textContent = "Your locked goal: “" + goalText($("pPerWeek").value) + "” for 90 days."; }

  async function lockIn() {
    var n = +$("pPerWeek").value;
    if (!confirm("Lock in “" + goalText(n) + "” for 90 days? This cannot be changed.")) return;
    msg("lockMsg", "Locking in…");
    var r = await sb.from("players").insert({
      challenge_id: challenge.id, user_id: uid, name: profile.name,
      avatar_data_url: profile.avatar_data_url, avatar_options: profile.avatar_options,
      goal_type: "fitness", goal_per_week: n, goal_text: goalText(n)
    }).select().single();
    if (r.error) { fail("lockMsg", r.error); return; }
    me = r.data;
    Analytics.track("goal_locked", { goal_per_week: n });
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
  function lpClass(lp) { return lp > 50 ? "" : lp > 25 ? "mid" : "low"; }
  function stageHTML(s) { return '<span class="stage s' + s.stage + '">' + s.stageName + "</span>"; }

  function render() {
    var s = summaryFor(me);
    $("playChallenge").textContent = challenge.name.toUpperCase();
    $("playMeta").textContent = challenge.starts_on + " → " + s.endsOn + " · invite code " + challenge.invite_code + " · " + players.length + " player" + (players.length === 1 ? "" : "s");
    drawPiece($("mePiece"), me.avatar_options, me.avatar_data_url, s.stage);
    $("meName").textContent = me.name.toUpperCase();
    $("meStage").textContent = "STAGE " + s.stage + " · " + s.stageName;
    $("meStage").className = "stage s" + s.stage;
    var fromWhoop = workouts.filter(function (x) { return x.player_id === me.id && x.source === "whoop"; }).length;
    $("meGoal").textContent = me.goal_text + " · " + s.totalWorkouts + " workouts logged" + (fromWhoop ? " (" + fromWhoop + " from Whoop)" : "");
    $("meLP").textContent = s.lp + " / " + GameRules.RULES.lpMax;
    $("meLPFill").style.width = (s.lp / GameRules.RULES.lpMax * 100) + "%";
    $("meLPFill").className = "lp-fill " + lpClass(s.lp);
    $("evolveMsg").textContent = s.nextEvolveAt === null
      ? "Final form. Keep the streak alive to hold it."
      : (s.nextEvolveAt - s.streak) + " more hit week" + (s.nextEvolveAt - s.streak === 1 ? "" : "s") + " in a row to evolve.";
    $("sStage").textContent = s.stage;
    $("sStreak").textContent = s.streak;
    $("sHits").textContent = s.hitWeeks;
    $("sDays").textContent = s.daysLeft;

    if (!s.started) {
      $("weekLabel").textContent = "STARTS " + challenge.starts_on;
      $("weekMsg").textContent = "The challenge hasn't started yet. Workouts logged now won't count.";
    } else if (s.over) {
      $("weekLabel").textContent = "CHALLENGE OVER";
      $("weekMsg").textContent = "90 days done. You finished at " + s.lp + " LP, stage " + s.stage + ".";
    } else {
      $("weekLabel").textContent = "WEEK " + (s.currentWeek + 1) + " OF " + s.totalWeeks + " · " + s.thisWeekCount + "/" + me.goal_per_week;
      $("weekMsg").textContent = s.thisWeekHit ? "Week hit, +10 LP banked. Anything extra is gravy." : s.thisWeekRemaining + " more to hit this week. Missing costs 15 LP.";
    }
    var pips = "";
    for (var i = 0; i < me.goal_per_week; i++) pips += '<i class="' + (i < s.thisWeekCount ? "on" : "") + '"></i>';
    $("pips").innerHTML = pips;
    $("weeks").innerHTML = s.weeks.map(function (wk) {
      var cls = wk.status === "current" ? "current " : "";
      if (wk.scored) cls += wk.hit ? "hit" : "miss";
      var tip = "Week " + (wk.index + 1) + ": " + wk.count + " workouts" + (wk.scored ? " · " + wk.events.join(", ") + " · " + wk.lp + " LP" : "");
      return '<i class="' + cls + '" title="' + esc(tip) + '"></i>';
    }).join("");
    $("logBtn").disabled = !s.started || s.over;
    $("logDate").max = todayISO();

    // Leaderboard
    var rows = players.map(function (pl) { return { p: pl, s: summaryFor(pl) }; });
    rows.sort(function (a, b) { return GameRules.compare(a.s, b.s); });
    $("standings").innerHTML = rows.map(function (r, i) {
      return '<tr class="' + (r.p.id === me.id ? "me" : "") + '"><td class="n">' + (i + 1) + '</td><td class="pc"><canvas class="piece row" data-row="' + i + '" width="15" height="24"></canvas></td>' +
        "<td><strong>" + esc(r.p.name) + "</strong> " + stageHTML(r.s) +
        '<br><span class="muted" style="font-size:13px">' + esc(r.p.goal_text) + " · wk " + r.s.thisWeekCount + "/" + r.p.goal_per_week + " · streak " + r.s.streak + "</span>" +
        '<div class="lp sm"><div class="lp-bar"><div class="lp-fill ' + lpClass(r.s.lp) + '" style="width:' + (r.s.lp / GameRules.RULES.lpMax * 100) + '%"></div></div></div></td>' +
        '<td class="n">' + r.s.lp + "<br><span style=\"color:var(--muted)\">LP</span></td></tr>";
    }).join("");
    $("standings").querySelectorAll("canvas[data-row]").forEach(function (c) {
      var r = rows[+c.dataset.row]; drawPiece(c, r.p.avatar_options, r.p.avatar_data_url, r.s.stage);
    });

    // Banner when a log just hit the week or evolved us.
    if (lastSummary) {
      var b = $("banner");
      if (s.stage > lastSummary.stage) {
        Analytics.track("evolved", { stage: s.stage, streak: s.streak });
        b.textContent = "✦ EVOLVED! " + me.name.toUpperCase() + " IS NOW " + s.stageName + " ✦";
        b.className = "banner evolve show";
      } else if (s.lp > lastSummary.lp) {
        Analytics.track("week_hit", { lp: s.lp, streak: s.streak, week: s.currentWeek });
        b.textContent = "WEEK HIT! +" + (s.lp - lastSummary.lp) + " LP → " + s.lp + (s.lp >= GameRules.RULES.lpMax ? " (MAX)" : "") + " · STREAK " + s.streak;
        b.className = "banner show";
      }
      if (b.classList.contains("show")) setTimeout(function () { b.className = "banner"; }, 6000);
    }
    lastSummary = s;
  }

  async function logWorkout(whenISO) {
    msg("logMsg", "Logging…");
    var r = await sb.from("workouts").insert({ player_id: me.id, happened_at: whenISO, source: "manual" });
    if (r.error) { fail("logMsg", r.error); return; }
    msg("logMsg", "Logged. Keep going.", "ok");
    Analytics.track("workout_logged", { source: "manual", backdated: whenISO.slice(0, 10) !== todayISO() });
    await refresh();
  }
  async function undoLast() {
    var mine = workouts.filter(function (x) { return x.player_id === me.id && x.source === "manual"; });
    if (!mine.length) { msg("logMsg", "Nothing to undo.", "err"); return; }
    var last = mine.sort(function (a, b) { return a.created_at < b.created_at ? 1 : -1; })[0];
    var r = await sb.from("workouts").delete().eq("id", last.id);
    if (r.error) { fail("logMsg", r.error); return; }
    msg("logMsg", "Removed your last manual workout.", "ok");
    Analytics.track("workout_undone");
    await refresh();
  }

  // ---------- wiring ----------
  $("nextBtn").addEventListener("click", saveCharacter);
  $("pName").addEventListener("keydown", function (e) { if (e.key === "Enter") saveCharacter(); });
  $("homeEdit").addEventListener("click", function (e) { e.preventDefault(); openCharacter(null); });
  $("editCharBtn").addEventListener("click", function () { openCharacter(openIntake); });
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
    Analytics.track("invite_copied");
    navigator.clipboard.writeText(link).then(function () { msg("logMsg", "Invite link copied: " + link, "ok"); }, function () { prompt("Copy this invite link:", link); });
  });
  $("signout").addEventListener("click", async function (e) {
    e.preventDefault();
    if (!sb || !confirm("Sign out of this device identity? You will not be able to get this character or player back.")) return;
    Analytics.track("identity_reset"); Analytics.reset();
    await sb.auth.signOut(); location.hash = ""; location.reload();
  });

  init().catch(function (err) { show("setup"); msg("setupMsg", "Startup error: " + (err.message || err), "err"); });
})();
