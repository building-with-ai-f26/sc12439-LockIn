/*
  analytics.js — tiny PostHog wrapper shared by every page.

  Loads the PostHog browser library only when docs/posthog-config.js has a key,
  queues anything tracked before it arrives, and exposes:
    Analytics.track(event, props)   named product events (plus PostHog autocapture)
    Analytics.identify(id, props)   tie events to the anonymous Supabase identity
  No names, emails or Whoop data are ever sent; see privacy.html.
*/
(function () {
  "use strict";
  var cfg = window.LOCKIN_POSTHOG || {};
  var queue = [], ready = false, disabled = !cfg.key;

  function flush() {
    if (!ready) return;
    queue.splice(0).forEach(function (q) { try { window.posthog[q[0]].apply(window.posthog, q[1]); } catch (e) { /* analytics must never break the game */ } });
  }
  function call(method, args) {
    if (disabled) return;
    queue.push([method, args]);
    flush();
  }

  if (!disabled) {
    var host = (cfg.host || "https://us.i.posthog.com").replace(/\/$/, "");
    var s = document.createElement("script");
    s.async = true; s.crossOrigin = "anonymous";
    s.src = host.replace(".i.posthog.com", "-assets.i.posthog.com") + "/static/array.js";
    s.onload = function () {
      if (!window.posthog || !window.posthog.init) return;
      window.posthog.init(cfg.key, {
        api_host: host,
        person_profiles: "identified_only",
        capture_pageview: true,
        capture_pageleave: true,
        autocapture: true,
        disable_session_recording: true,       // no replays: friends' screens stay private
        loaded: function () { ready = true; flush(); }
      });
    };
    s.onerror = function () { disabled = true; queue.length = 0; };
    document.head.appendChild(s);
  }

  window.Analytics = {
    enabled: !disabled,
    track: function (event, props) { call("capture", [event, props || {}]); },
    identify: function (id, props) { if (id) call("identify", [id, props || {}]); },
    reset: function () { call("reset", []); }
  };
})();
