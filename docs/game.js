/*
  game.js — browser glue for Lock-In Party.
  Talks to Supabase, renders the views, and leans on game-rules.js for all
  the math. Each device signs in anonymously; that identity owns one
  profile (your character) and one player row per group.

  Flow: character (profiles) → group (challenges) → goals (players + goals)
        → tracking (players.tracking) → play (checkins).
*/
(function () {
  "use strict";
  var cfg = window.LOCKIN_SUPABASE || {};
  var whoopCfg = window.LOCKIN_WHOOP || {};
  var $ = function (id) { return document.getElementById(id); };
  var sb = null, uid = null;
  var profile = null;         // my character: { name, avatar_data_url, avatar_options }
  var challenge = null, me = null, players = [], goals = [], checkins = [];
  var myPlayers = [], myChallenges = [];   // every group I'm in (one player row each)
  var GROUP_KEY = "lockin.group";          // localStorage: the group I last looked at
  var builder = null;         // MonkeyUI instance, mounted on first use
  var afterCharacter = null;  // where to go once the character is saved
  var lastSummary = null;     // to detect a hit or evolution after logging
  var trackingBack = null;    // where CONTINUE on the tracking view goes

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
  // Draw a monkey onto a canvas at a stage with its goal badges; a profile
  // from before the monkey update only has a PNG, so draw that until they rebuild.
  function drawPiece(canvas, options, dataUrl, stage, goalTypes) {
    if (Monkey.isMonkey(options)) { Monkey.draw(canvas, options, stage || 1, goalTypes || []); return; }
    var size = Math.round(canvas.clientWidth || 96);
    canvas.width = size; canvas.height = size;
    var ctx = canvas.getContext("2d"); ctx.imageSmoothingEnabled = false; ctx.clearRect(0, 0, size, size);
    if (!dataUrl) return;
    var img = new Image(); img.onload = function () { var h = size, w = size * img.width / img.height; ctx.drawImage(img, (size - w) / 2, 0, w, h); }; img.src = dataUrl;
  }
  function goalTypesOf(player) { return myGoals(player).map(function (g) { return g.type; }); }
  function myGoals(player) { return goals.filter(function (g) { return g.player_id === player.id; }); }

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
        var ok = await loadMine();
        if (!ok) return;
        if (!myPlayers.length) { openHome(); return; }
        var want = null; try { want = localStorage.getItem(GROUP_KEY); } catch (e) {}
        var pick = myPlayers.filter(function (p) { return p.challenge_id === want; })[0] || myPlayers[0];
        await enterGroup(pick);
      };
    if (!profile) { openCharacter(next); return; }   // step 1 first, for a brand-new identity
    if (!Monkey.isMonkey(profile.avatar_options)) {  // built before the monkey update: pick a monkey once
      openCharacter(next);
      $("charIntro").textContent = "New look: everyone is a monkey now. Pick your hair and colours once; your groups, goals and check-ins are untouched.";
      return;
    }
    await next();
  }

  // ---------- my groups ----------
  // Load every player row I own and the groups they belong to, newest first.
  async function loadMine() {
    var mine = await sb.from("players").select("*").eq("user_id", uid).order("created_at", { ascending: false });
    if (mine.error) { show("setup"); msg("setupMsg", "Could not read players: " + mine.error.message + ". Did you run supabase/schema.sql?", "err"); return false; }
    myPlayers = mine.data;
    var ids = myPlayers.map(function (p) { return p.challenge_id; });
    myChallenges = [];
    if (ids.length) {
      var c = await sb.from("challenges").select("*").in("id", ids);
      if (c.error) { fail("setupMsg", c.error); return false; }
      myChallenges = c.data;
    }
    return true;
  }
  function challengeFor(id) { return myChallenges.filter(function (c) { return c.id === id; })[0] || null; }
  // Make one of my groups the current one and show the play screen.
  async function enterGroup(player) {
    me = player;
    challenge = challengeFor(player.challenge_id);
    if (!challenge) {
      var c = await sb.from("challenges").select("*").eq("id", player.challenge_id).single();
      if (c.error) { fail("logMsg", c.error); return; }
      challenge = c.data; myChallenges.push(challenge);
    }
    try { localStorage.setItem(GROUP_KEY, challenge.id); } catch (e) {}
    lastSummary = null;
    await refresh();
    show("play");
  }
  function renderSwitcher() {
    var opts = myPlayers.map(function (p) {
      var c = challengeFor(p.challenge_id);
      return '<option value="' + p.challenge_id + '"' + (p.challenge_id === challenge.id ? " selected" : "") + ">" + esc(c ? c.name : "Group") + "</option>";
    });
    opts.push('<option value="__new__">+ NEW GROUP…</option>');
    $("groupSwitch").innerHTML = opts.join("");
  }

  // ---------- step 1: character ----------
  function openCharacter(then) {
    afterCharacter = then;
    if (!builder) {
      builder = MonkeyUI.mount($("builder"), { initial: profile && Monkey.isMonkey(profile.avatar_options) ? profile.avatar_options : Monkey.randomOptions() });
    }
    if (profile) { $("pName").value = profile.name; $("charIntro").textContent = "Change your look or name. Your group sees the update right away."; }
    show("character");
    $("pName").focus();
  }
  async function saveCharacter() {
    var name = $("pName").value.trim();
    if (!name) { msg("charMsg", "Tell us your name first.", "err"); $("pName").focus(); return; }
    msg("charMsg", "Saving…");
    var row = { user_id: uid, name: name, avatar_data_url: await builder.getDataURL(96), avatar_options: builder.getOptions() };
    var r = await sb.from("profiles").upsert(row).select().single();
    if (r.error) { fail("charMsg", r.error); return; }
    var isNew = !profile;
    profile = r.data;
    Analytics.track(isNew ? "character_created" : "character_edited", { hair: row.avatar_options.hair, fur: row.avatar_options.fur, outfit: row.avatar_options.outfit });
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
    $("homeBack").hidden = !myPlayers.length;
    msg("createMsg", ""); msg("joinMsg", "");
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
    if (existing.data) {
      if (!myPlayers.some(function (p) { return p.id === existing.data.id; })) { myPlayers.unshift(existing.data); myChallenges.push(challenge); }
      await enterGroup(existing.data); return;
    }
    Analytics.track("group_joined", { via_link: !!location.hash });
    openIntake();
  }

  // ---------- step 3: goals ----------
  var cardsBuilt = false;
  function perWeekOptions(selected, type) {
    var out = "";
    for (var n = 1; n <= 7; n++) {
      var txt = type === "fitness" ? n + " WORKOUT" + (n === 1 ? "" : "S") + " / WEEK" : n === 7 ? "EVERY DAY" : n + " DAY" + (n === 1 ? "" : "S") + " / WEEK";
      out += '<option value="' + n + '"' + (n === selected ? " selected" : "") + ">" + txt + "</option>";
    }
    return out;
  }
  function buildGoalCards() {
    if (cardsBuilt) return; cardsBuilt = true;
    $("goalCards").innerHTML = GameRules.GOAL_ORDER.map(function (type) {
      var def = GameRules.GOAL_TYPES[type];
      var extra = type === "steps"
        ? '<select data-setting="steps">' + [5000, 7500, 10000, 12000, 15000].map(function (v) { return '<option value="' + v + '"' + (v === 10000 ? " selected" : "") + ">" + GameRules.goalText({ type: "steps", per_week: 7, settings: { steps: v } }).split(" ")[0] + " STEPS</option>"; }).join("") + "</select>"
        : type === "reading"
          ? '<select data-setting="minutes">' + [10, 20, 30, 60].map(function (v) { return '<option value="' + v + '"' + (v === 20 ? " selected" : "") + ">" + v + " MIN</option>"; }).join("") + "</select>"
          : "";
      return '<label class="goal-card' + (type === "fitness" ? " on" : "") + '" data-type="' + type + '">' +
        '<div class="head"><input type="checkbox"' + (type === "fitness" ? " checked" : "") + "> " + def.label + "</div>" +
        '<div class="desc">' + esc(def.describe) + "</div>" +
        '<div class="opts">' + extra + '<select data-per-week>' + perWeekOptions(def.defaultPerWeek, type) + "</select></div></label>";
    }).join("");
    $("goalCards").addEventListener("change", function (e) {
      var card = e.target.closest(".goal-card");
      if (e.target.type === "checkbox") card.classList.toggle("on", e.target.checked);
      else if (!card.querySelector("input").checked) { card.querySelector("input").checked = true; card.classList.add("on"); }
      updateGoalPreview();
    });
  }
  // Read the cards into goal rows: [{ type, per_week, settings, text }]
  function selectedGoals() {
    return Array.prototype.map.call($("goalCards").querySelectorAll(".goal-card"), function (card) {
      if (!card.querySelector("input").checked) return null;
      var settings = {};
      card.querySelectorAll("[data-setting]").forEach(function (sel) { settings[sel.dataset.setting] = +sel.value; });
      var g = { type: card.dataset.type, per_week: +card.querySelector("[data-per-week]").value, settings: settings };
      g.text = GameRules.goalText(g);
      return g;
    }).filter(Boolean);
  }
  function goalSummary(list) { return list.map(function (g) { return g.text; }).join(" · "); }
  function updateGoalPreview() {
    var list = selectedGoals();
    drawPiece($("piecePreview"), profile.avatar_options, profile.avatar_data_url, 1, list.map(function (g) { return g.type; }));
    $("goalPreview").textContent = list.length ? "Your locked goals: " + goalSummary(list) + ", for 90 days." : "Pick at least one goal.";
    $("lockBtn").disabled = !list.length;
  }
  function openIntake() {
    $("intakeChallenge").textContent = challenge.name + " (starts " + challenge.starts_on + ")";
    $("pieceName").textContent = profile.name;
    buildGoalCards();
    updateGoalPreview();
    show("intake");
  }
  async function lockIn() {
    var list = selectedGoals();
    if (!list.length) { msg("lockMsg", "Pick at least one goal.", "err"); return; }
    if (!confirm("Lock in " + goalSummary(list) + " for 90 days? This cannot be changed.")) return;
    msg("lockMsg", "Locking in…");
    // A retry after a half-finished lock-in finds the player row already there.
    var ex = await sb.from("players").select("*").eq("user_id", uid).eq("challenge_id", challenge.id).maybeSingle();
    var player = ex.data;
    if (!player) {
      var r = await sb.from("players").insert({
        challenge_id: challenge.id, user_id: uid, name: profile.name,
        avatar_data_url: profile.avatar_data_url, avatar_options: profile.avatar_options,
        goal_text: goalSummary(list), tracking: "manual"
      }).select().single();
      if (r.error) { fail("lockMsg", r.error); return; }
      player = r.data;
    }
    var have = await sb.from("goals").select("id").eq("player_id", player.id);
    if (!have.data || !have.data.length) {
      var g = await sb.from("goals").insert(list.map(function (x) { return { player_id: player.id, type: x.type, per_week: x.per_week, settings: x.settings, text: x.text }; })).select();
      if (g.error) { fail("lockMsg", g.error); return; }
    }
    me = player;
    if (!myPlayers.some(function (p) { return p.id === player.id; })) { myPlayers.unshift(player); }
    if (!challengeFor(challenge.id)) myChallenges.push(challenge);
    Analytics.track("goal_locked", { goals: list.map(function (x) { return x.type + ":" + x.per_week; }).join(","), count: list.length });
    openTracking(function () { return enterGroup(player); });
  }

  // ---------- step 4: tracking ----------
  function whoopAuthUrl() {
    var state = Math.random().toString(36).slice(2, 10).padEnd(8, "0");   // Whoop wants exactly 8 chars
    var q = new URLSearchParams({ response_type: "code", client_id: whoopCfg.clientId, redirect_uri: whoopCfg.redirectUri, scope: "offline read:workout read:profile", state: state });
    return "https://api.prod.whoop.com/oauth/oauth2/auth?" + q;
  }
  function openTracking(then) {
    trackingBack = then;
    var hasWhoop = !!whoopCfg.clientId;
    $("whoopBtn").disabled = !hasWhoop;
    msg("whoopHint", hasWhoop ? "" : "Whoop is not set up for this game yet.");
    document.querySelectorAll("[data-track]").forEach(function (el) { el.classList.toggle("picked", el.dataset.track === (me.tracking || "manual")); });
    $("trackNext").hidden = true;
    msg("trackMsg", "");
    show("tracking");
  }
  async function setTracking(value) {
    var r = await sb.from("players").update({ tracking: value }).eq("id", me.id).select().single();
    if (r.error) { fail("trackMsg", r.error); return false; }
    me.tracking = value;
    Analytics.track("tracking_chosen", { tracking: value });
    document.querySelectorAll("[data-track]").forEach(function (el) { el.classList.toggle("picked", el.dataset.track === value); });
    return true;
  }
  async function chooseWhoop() {
    var url = whoopAuthUrl();
    window.open(url, "_blank", "noopener");
    if (!(await setTracking("whoop"))) return;
    msg("whoopHint", "A Whoop tab opened. Approve, then send the code it shows to " + (whoopCfg.owner || "the group owner") + ". Your workouts start syncing nightly once they finish it. If the tab did not open, use the link below.", "ok");
    var a = document.createElement("a"); a.href = url; a.target = "_blank"; a.rel = "noopener"; a.textContent = "Open Whoop login"; a.style.fontSize = "13px";
    $("whoopHint").appendChild(document.createElement("br")); $("whoopHint").appendChild(a);
    $("trackNext").hidden = false;
  }
  async function chooseManual() {
    if (!(await setTracking("manual"))) return;
    await trackingBack();
  }

  // ---------- play ----------
  async function refresh() {
    var p = await sb.from("players").select("*").eq("challenge_id", challenge.id).order("created_at");
    if (p.error) { fail("logMsg", p.error); return; }
    players = p.data;
    var ids = players.map(function (x) { return x.id; });
    var g = await sb.from("goals").select("*").in("player_id", ids).order("created_at");
    if (g.error) { fail("logMsg", g.error); return; }
    goals = g.data;
    var c = await sb.from("checkins").select("*").in("player_id", ids).order("happened_at");
    if (c.error) { fail("logMsg", c.error); return; }
    checkins = c.data;
    me = players.filter(function (x) { return x.id === me.id; })[0] || me;
    render();
  }
  function summaryFor(player) {
    return GameRules.summarize({
      startsOn: challenge.starts_on, goals: myGoals(player),
      checkins: checkins.filter(function (x) { return x.player_id === player.id; })
    });
  }
  function lpClass(lp) { return lp > 50 ? "" : lp > 25 ? "mid" : "low"; }
  function stageHTML(s) { return '<span class="stage s' + s.stage + '">' + s.stageName + "</span>"; }
  function pipsHTML(count, perWeek) {
    var out = "";
    for (var i = 0; i < perWeek; i++) out += '<i class="' + (i < count ? "on" : "") + '"></i>';
    return '<div class="pips">' + out + "</div>";
  }
  function trackingLabel(t) { return t === "whoop" ? "Whoop" : t === "apple_health" ? "Apple Health" : "manual"; }

  function render() {
    var s = summaryFor(me);
    renderSwitcher();
    renderSettings();
    $("playChallenge").textContent = challenge.name.toUpperCase();
    $("playMeta").textContent = challenge.starts_on + " → " + s.endsOn + " · invite code " + challenge.invite_code + " · " + players.length + " player" + (players.length === 1 ? "" : "s");
    drawPiece($("mePiece"), me.avatar_options, me.avatar_data_url, s.stage, goalTypesOf(me));
    $("meName").textContent = me.name.toUpperCase();
    $("meStage").textContent = "STAGE " + s.stage + " · " + s.stageName;
    $("meStage").className = "stage s" + s.stage;
    var fromWhoop = checkins.filter(function (x) { return x.player_id === me.id && x.source === "whoop"; }).length;
    $("meGoal").textContent = me.goal_text + " · " + s.totalCheckins + " check-in" + (s.totalCheckins === 1 ? "" : "s") + (fromWhoop ? " (" + fromWhoop + " from Whoop)" : "");
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
      $("weekMsg").textContent = "The challenge hasn't started yet. Check-ins logged now won't count.";
    } else if (s.over) {
      $("weekLabel").textContent = "CHALLENGE OVER";
      $("weekMsg").textContent = "90 days done. You finished at " + s.lp + " LP, stage " + s.stage + ".";
    } else {
      $("weekLabel").textContent = "WEEK " + (s.currentWeek + 1) + " OF " + s.totalWeeks;
      var open = s.goals.filter(function (g) { return !g.thisWeekHit; });
      $("weekMsg").textContent = s.thisWeekHit ? "Week hit, +10 LP banked. Anything extra is gravy."
        : s.thisWeekRemaining + " more to hit this week (" + open.map(function (g) { return g.thisWeekRemaining + " " + g.unit + (g.thisWeekRemaining === 1 ? "" : "s"); }).join(", ") + "). Missing costs 15 LP.";
    }
    $("goalRows").innerHTML = s.goals.map(function (g) {
      return '<div class="grow"><span class="pixel lbl">' + g.label + "</span>" + pipsHTML(g.thisWeekCount, g.perWeek) + '<span class="pixel cnt">' + g.thisWeekCount + "/" + g.perWeek + "</span></div>";
    }).join("");
    $("weeks").innerHTML = s.weeks.map(function (wk) {
      var cls = wk.status === "current" ? "current " : "";
      if (wk.scored) cls += wk.hit ? "hit" : "miss";
      var detail = s.goals.map(function (g, i) { return g.label.toLowerCase() + " " + wk.counts[i] + "/" + g.perWeek; }).join(", ");
      var tip = "Week " + (wk.index + 1) + ": " + detail + (wk.scored ? " · " + wk.events.join(", ") + " · " + wk.lp + " LP" : "");
      return '<i class="' + cls + '" title="' + esc(tip) + '"></i>';
    }).join("");

    // Check-in buttons, one per goal. Once-per-day goals grey out after today's tap.
    var canLog = s.started && !s.over;
    $("logButtons").innerHTML = s.goals.map(function (g) {
      var done = g.oncePerDay && g.loggedToday;
      return '<button class="btn ' + (s.goals.length === 1 ? "huge " : "") + (done ? "alt" : "green") + '" type="button" data-log="' + g.id + '"' + (canLog && !done ? "" : " disabled") + ">" +
        (done ? "✓ " + g.label + " LOGGED TODAY" : g.action) + "</button>";
    }).join("");
    $("logGoal").innerHTML = s.goals.map(function (g) { return '<option value="' + g.id + '">' + g.label + "</option>"; }).join("");
    $("logDate").max = todayISO();
    $("trackLine").innerHTML = "Tracking: " + trackingLabel(me.tracking) + (me.tracking === "whoop" ? " (workouts sync nightly)" : "") + ' · <a href="#" id="trackLink">change</a>';
    $("trackLink").addEventListener("click", function (e) { e.preventDefault(); openTracking(function () { show("play"); }); });

    // Leaderboard
    var rows = players.map(function (pl) { return { p: pl, s: summaryFor(pl) }; });
    rows.sort(function (a, b) { return GameRules.compare(a.s, b.s); });
    $("standings").innerHTML = rows.map(function (r, i) {
      var week = r.s.goals.map(function (g) { return g.thisWeekCount + "/" + g.perWeek; }).join(" · ");
      return '<tr class="' + (r.p.id === me.id ? "me" : "") + '"><td class="n">' + (i + 1) + '</td><td class="pc"><canvas class="piece row" data-row="' + i + '"></canvas></td>' +
        "<td><strong>" + esc(r.p.name) + "</strong> " + stageHTML(r.s) +
        '<br><span class="muted" style="font-size:13px">' + esc(r.s.goals.map(function (g) { return GameRules.goalShort({ type: g.type, per_week: g.perWeek }); }).join(" + ") || r.p.goal_text) + " · wk " + week + " · streak " + r.s.streak + (r.p.tracking === "whoop" ? " · Whoop" : "") + "</span>" +
        '<div class="lp sm"><div class="lp-bar"><div class="lp-fill ' + lpClass(r.s.lp) + '" style="width:' + (r.s.lp / GameRules.RULES.lpMax * 100) + '%"></div></div></div></td>' +
        '<td class="n">' + r.s.lp + "<br><span style=\"color:var(--muted)\">LP</span></td></tr>";
    }).join("");
    $("standings").querySelectorAll("canvas[data-row]").forEach(function (c) {
      var r = rows[+c.dataset.row]; drawPiece(c, r.p.avatar_options, r.p.avatar_data_url, r.s.stage, goalTypesOf(r.p));
    });

    // Banner when a check-in just hit the week or evolved us.
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

  // ---------- group settings (creator only) ----------
  function groupStarted() { return challenge.starts_on <= todayISO(); }
  function renderSettings() {
    var mineToRun = challenge.created_by === uid;
    $("settings").hidden = !mineToRun;
    if (!mineToRun) return;
    if (document.activeElement !== $("gName")) $("gName").value = challenge.name;
    if (document.activeElement !== $("gStart")) $("gStart").value = challenge.starts_on;
    $("gStart").disabled = groupStarted();
    $("gStartNote").textContent = groupStarted() ? "Started, so the date is frozen: moving it would reshuffle everyone's weeks." : "Can change until the day it starts.";
    $("gMembers").innerHTML = players.map(function (p) {
      return "<li><span>" + esc(p.name) + (p.user_id === uid ? ' <span class="muted">(you)</span>' : "") + "</span>" +
        (p.user_id === uid ? "" : '<button class="btn alt sm" type="button" data-remove="' + p.id + '">REMOVE</button>') + "</li>";
    }).join("");
  }
  async function saveGroup() {
    var name = $("gName").value.trim();
    if (!name) { msg("gMsg", "The group needs a name.", "err"); return; }
    var patch = { name: name };
    if (!groupStarted() && $("gStart").value && $("gStart").value !== challenge.starts_on) patch.starts_on = $("gStart").value;
    msg("gMsg", "Saving…");
    var r = await sb.from("challenges").update(patch).eq("id", challenge.id).select().single();
    if (r.error) { fail("gMsg", r.error); return; }
    if (!r.data) { msg("gMsg", "Only the person who made the group can change it.", "err"); return; }
    Analytics.track(patch.starts_on ? "group_start_changed" : "group_renamed");
    challenge = r.data;
    myChallenges = myChallenges.map(function (c) { return c.id === challenge.id ? challenge : c; });
    msg("gMsg", "Saved.", "ok");
    render();
  }
  async function removePlayer(id) {
    var p = players.filter(function (x) { return x.id === id; })[0];
    if (!p || !confirm("Remove " + p.name + " from " + challenge.name + "? Their goals and check-ins in this group are deleted. They can rejoin with the code.")) return;
    var r = await sb.from("players").delete().eq("id", id);
    if (r.error) { fail("gMsg", r.error); return; }
    Analytics.track("player_removed");
    msg("gMsg", "Removed " + p.name + ".", "ok");
    await refresh();
  }
  async function deleteGroup() {
    var typed = prompt("This deletes the group for everyone, with all goals and check-ins. Type the group name to confirm:");
    if (typed === null) return;
    if (typed.trim() !== challenge.name) { msg("gMsg", "Name did not match. Nothing deleted.", "err"); return; }
    var r = await sb.from("challenges").delete().eq("id", challenge.id);
    if (r.error) { fail("gMsg", r.error); return; }
    Analytics.track("group_deleted", { players: players.length });
    myPlayers = myPlayers.filter(function (p) { return p.challenge_id !== challenge.id; });
    myChallenges = myChallenges.filter(function (c) { return c.id !== challenge.id; });
    try { localStorage.removeItem(GROUP_KEY); } catch (e) {}
    challenge = null; me = null; players = []; goals = []; checkins = []; lastSummary = null;
    if (myPlayers.length) await enterGroup(myPlayers[0]); else openHome();
  }

  async function logCheckin(goalId, whenISO) {
    var goal = lastSummary && lastSummary.goals.filter(function (g) { return g.id === goalId; })[0];
    if (!goal) { msg("logMsg", "Pick a goal first.", "err"); return; }
    var day = GameRules.toDay(whenISO);
    if (goal.oncePerDay && checkins.some(function (c) { return c.player_id === me.id && c.goal_id === goalId && GameRules.toDay(c.happened_at) === day; })) {
      msg("logMsg", goal.label + " is already logged for " + day + ". One per day.", "err"); return;
    }
    msg("logMsg", "Logging…");
    var r = await sb.from("checkins").insert({ player_id: me.id, goal_id: goalId, happened_at: whenISO, source: "manual" });
    if (r.error) { fail("logMsg", r.error); return; }
    msg("logMsg", "Logged. Keep going.", "ok");
    Analytics.track("checkin_logged", { goal: goal.type, source: "manual", backdated: day !== todayISO() });
    await refresh();
  }
  async function undoLast() {
    var mine = checkins.filter(function (x) { return x.player_id === me.id && x.source === "manual"; });
    if (!mine.length) { msg("logMsg", "Nothing to undo.", "err"); return; }
    var last = mine.sort(function (a, b) { return a.created_at < b.created_at ? 1 : -1; })[0];
    var r = await sb.from("checkins").delete().eq("id", last.id);
    if (r.error) { fail("logMsg", r.error); return; }
    msg("logMsg", "Removed your last manual check-in.", "ok");
    Analytics.track("checkin_undone");
    await refresh();
  }

  // ---------- wiring ----------
  $("nextBtn").addEventListener("click", saveCharacter);
  $("pName").addEventListener("keydown", function (e) { if (e.key === "Enter") saveCharacter(); });
  $("homeEdit").addEventListener("click", function (e) { e.preventDefault(); openCharacter(null); });
  $("editCharBtn").addEventListener("click", function () { openCharacter(openIntake); });
  $("createBtn").addEventListener("click", create);
  $("joinBtn").addEventListener("click", join);
  $("lockBtn").addEventListener("click", lockIn);
  $("whoopBtn").addEventListener("click", chooseWhoop);
  $("manualBtn").addEventListener("click", chooseManual);
  $("trackNext").addEventListener("click", function () { trackingBack(); });
  $("logButtons").addEventListener("click", function (e) {
    var b = e.target.closest("[data-log]"); if (!b) return;
    logCheckin(b.dataset.log, new Date().toISOString());
  });
  $("logPastBtn").addEventListener("click", function () {
    var d = $("logDate").value; if (!d) { msg("logMsg", "Pick a date first.", "err"); return; }
    logCheckin($("logGoal").value, new Date(d + "T12:00:00").toISOString());   // noon local, so it lands on that calendar day
  });
  $("undoBtn").addEventListener("click", undoLast);
  $("groupSwitch").addEventListener("change", function () {
    var v = this.value;
    if (v === "__new__") { this.value = challenge.id; openHome(); return; }
    var p = myPlayers.filter(function (x) { return x.challenge_id === v; })[0];
    if (p) { Analytics.track("group_switched"); enterGroup(p); }
  });
  $("homeBackLink").addEventListener("click", function (e) { e.preventDefault(); if (me) { show("play"); } else if (myPlayers.length) enterGroup(myPlayers[0]); });
  $("gSave").addEventListener("click", saveGroup);
  $("gMembers").addEventListener("click", function (e) { var b = e.target.closest("[data-remove]"); if (b) removePlayer(b.dataset.remove); });
  $("gDelete").addEventListener("click", deleteGroup);
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
