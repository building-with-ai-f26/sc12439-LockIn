/*
  monkey.js — the monkey evolution line for Lock-In Party.

  Everyone is a monkey. Three stages, one neutral body each, drawn as
  generated pixel-art PNGs in docs/images/monkeys/ (see docs/MONKEYS.md).
  Players customise hair style (one image per style per stage) and three
  colours: fur, hair and outfit. The PNGs are generated with fixed
  reference hues for those three parts, and recolor() shifts every pixel
  near a reference hue to the chosen colour. Face, hands and feet are a
  pale cream with little saturation, so they are left alone.

  Stage auras (flame, spirit glow) and goal badges are drawn in code.

  Pure colour math (hex/hsl, recolor on raw RGBA bytes) is exported for
  Node tests; everything that touches <canvas> or <img> is browser only.
*/
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Monkey = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var BASE = "images/monkeys/";
  var STAGES = ["ROOKIE", "CONTENDER", "LEGEND"];
  var HAIRS = [
    { id: "spiky", label: "SPIKY" },
    { id: "shaggy", label: "SHAGGY" },
    { id: "curly", label: "CURLY" }
  ];
  // The hues the generated images must use. recolor() hunts for these.
  var REF = { fur: "#F28C28", hair: "#2ECC71", outfit: "#3B82F6" };
  var FUR_COLORS = ["#F28C28", "#8B5A2B", "#5B6B8C", "#C9A27E", "#3A2E2A", "#D9D9D9", "#B04A3A", "#6B8E4E"];
  var HAIR_COLORS = ["#1A1A1A", "#5A3A1E", "#E0B04A", "#C0392B", "#8E44AD", "#F4F1FF", "#4CC9F0", "#FF7AB6"];
  var OUTFIT_COLORS = ["#3B82F6", "#C0392B", "#27AE60", "#F4F1FF", "#1A1A1A", "#FFD23F", "#8E44AD", "#FF7AB6"];
  var BADGES = { fitness: "dumbbell", reading: "book", steps: "steps", dry: "dry" };
  var HUE_TOL = 28;      // degrees either side of a reference hue
  var MIN_CHROMA = 0.22; // (max-min)/255 below this is grey, cream or outline: never recoloured

  // ---------- colour math ----------
  function hexToRgb(hex) {
    var h = String(hex).replace("#", "");
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, h = 0, s = 0;
    if (max !== min) {
      var d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return [h, s, l];
  }
  function hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360;
    var c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2, r, g, b;
    if (h < 60) { r = c; g = x; b = 0; } else if (h < 120) { r = x; g = c; b = 0; } else if (h < 180) { r = 0; g = c; b = x; }
    else if (h < 240) { r = 0; g = x; b = c; } else if (h < 300) { r = x; g = 0; b = c; } else { r = c; g = 0; b = x; }
    return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
  }
  function hueDist(a, b) { var d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; }
  function lum(r, g, b) { return (0.299 * r + 0.587 * g + 0.114 * b) / 255; }
  function chroma(r, g, b) { return (Math.max(r, g, b) - Math.min(r, g, b)) / 255; }

  // Build the three (reference → target) shifts for a set of options.
  function shifts(options) {
    var out = [];
    [["fur", options.fur], ["hair", options.hairColor], ["outfit", options.outfit]].forEach(function (p) {
      if (!p[1]) return;
      var from = hexToRgb(REF[p[0]]), to = hexToRgb(p[1]);
      out.push({ part: p[0], fromH: rgbToHsl(from[0], from[1], from[2])[0], fromLum: lum(from[0], from[1], from[2]), to: to });
    });
    return out;
  }
  /*
    recolor(data, options) — data is RGBA bytes (Uint8ClampedArray or
    plain array), edited in place and returned. A pixel is recoloured when
    it is opaque enough, colourful enough (chroma), and within HUE_TOL of
    one reference hue. It becomes the target colour scaled by the pixel's
    brightness relative to the reference, so highlights and shadows in the
    generated art survive any target, including near-white and near-black.
  */
  function recolor(data, options) {
    var sh = shifts(options);
    if (!sh.length) return data;
    for (var i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 16) continue;
      var r = data[i], g = data[i + 1], b = data[i + 2];
      if (chroma(r, g, b) < MIN_CHROMA) continue;
      var hue = rgbToHsl(r, g, b)[0];
      var best = null, bestD = HUE_TOL + 1;
      for (var k = 0; k < sh.length; k++) { var d = hueDist(hue, sh[k].fromH); if (d < bestD) { bestD = d; best = sh[k]; } }
      if (!best) continue;
      var ratio = Math.min(1.6, lum(r, g, b) / Math.max(0.05, best.fromLum));
      data[i] = Math.min(255, Math.round(best.to[0] * ratio));
      data[i + 1] = Math.min(255, Math.round(best.to[1] * ratio));
      data[i + 2] = Math.min(255, Math.round(best.to[2] * ratio));
    }
    return data;
  }

  // ---------- options ----------
  function defaultOptions() { return { kind: "monkey", hair: "spiky", fur: "#F28C28", hairColor: "#5A3A1E", outfit: "#3B82F6" }; }
  function randomOptions() {
    var pick = function (a) { return a[Math.floor(Math.random() * a.length)]; };
    return { kind: "monkey", hair: pick(HAIRS).id, fur: pick(FUR_COLORS), hairColor: pick(HAIR_COLORS), outfit: pick(OUTFIT_COLORS) };
  }
  function isMonkey(options) { return !!(options && options.kind === "monkey"); }
  function imagePath(stage, hair) {
    var h = HAIRS.some(function (x) { return x.id === hair; }) ? hair : "spiky";
    return BASE + "s" + Math.max(1, Math.min(3, stage || 1)) + "-" + h + ".png";
  }
  function badgePath(goalType) { return BASE + "badge-" + (BADGES[goalType] || "dumbbell") + ".png"; }
  function stageName(stage) { return STAGES[Math.max(0, Math.min(2, (stage || 1) - 1))]; }

  // ---------- browser drawing ----------
  var cache = {};
  function loadImage(src) {
    if (!cache[src]) {
      cache[src] = new Promise(function (resolve, reject) {
        var img = new Image(); img.onload = function () { resolve(img); }; img.onerror = function () { reject(new Error("missing " + src)); }; img.src = src;
      });
    }
    return cache[src];
  }
  // Recoloured monkey as an offscreen canvas, memoised per (stage, options).
  var tinted = {};
  function tintedMonkey(stage, options) {
    var key = stage + "|" + options.hair + "|" + options.fur + "|" + options.hairColor + "|" + options.outfit;
    if (!tinted[key]) {
      tinted[key] = loadImage(imagePath(stage, options.hair)).then(function (img) {
        var c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight;
        var ctx = c.getContext("2d", { willReadFrequently: true }); ctx.drawImage(img, 0, 0);
        var id = ctx.getImageData(0, 0, c.width, c.height);
        recolor(id.data, options);
        ctx.putImageData(id, 0, 0);
        return c;
      });
    }
    return tinted[key];
  }
  function drawAura(ctx, size, stage) {
    if (stage < 2) return;
    var cx = size / 2, cy = size * 0.58;
    var g = ctx.createRadialGradient(cx, cy, size * 0.05, cx, cy, size * 0.5);
    if (stage === 2) { g.addColorStop(0, "rgba(255, 210, 63, .55)"); g.addColorStop(0.6, "rgba(255, 120, 40, .3)"); g.addColorStop(1, "rgba(255, 90, 20, 0)"); }
    else { g.addColorStop(0, "rgba(220, 245, 255, .6)"); g.addColorStop(0.6, "rgba(76, 201, 240, .3)"); g.addColorStop(1, "rgba(76, 201, 240, 0)"); }
    ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
    if (stage === 2) {
      // a few blocky flame tongues behind the shoulders
      ctx.fillStyle = "rgba(255, 150, 40, .45)";
      var n = 7, w = size / n;
      for (var i = 0; i < n; i++) { var h = size * (0.18 + 0.22 * Math.abs(Math.sin(i * 2.1 + 0.4))); ctx.fillRect(i * w + w * 0.2, cy - h, w * 0.6, h); }
    }
  }
  /*
    draw(canvas, options, stage, goalTypes?) → Promise
    Renders aura + recoloured monkey + one badge per goal type into the
    canvas, which is made square at its CSS size (or 128px).
  */
  function draw(canvas, options, stage, goalTypes) {
    options = Object.assign(defaultOptions(), options || {});
    stage = stage || 1;
    var size = Math.max(32, Math.round(canvas.clientWidth || canvas.width || 128));
    var dpr = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
    canvas.width = size * dpr; canvas.height = size * dpr;
    var ctx = canvas.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, size, size);
    var types = (goalTypes || []).slice(0, 4);
    var badgeSize = types.length ? Math.round(size * 0.18) : 0;
    var bodyH = size - (badgeSize ? badgeSize + 4 : 0);
    return tintedMonkey(stage, options).then(function (body) {
      drawAura(ctx, bodyH, stage);
      var scale = bodyH / Math.max(body.width, body.height);
      var w = body.width * scale, h = body.height * scale;
      ctx.drawImage(body, (size - w) / 2, bodyH - h, w, h);
      if (!badgeSize) return canvas;
      return Promise.all(types.map(function (t) { return loadImage(badgePath(t)).catch(function () { return null; }); })).then(function (imgs) {
        var total = imgs.length * badgeSize + (imgs.length - 1) * 4, x = (size - total) / 2;
        imgs.forEach(function (img) { if (img) ctx.drawImage(img, x, size - badgeSize, badgeSize, badgeSize); x += badgeSize + 4; });
        return canvas;
      });
    }).catch(function (err) {
      // Missing art: draw a labelled block so the page still works.
      ctx.fillStyle = "#3a3575"; ctx.fillRect(size * 0.2, size * 0.1, size * 0.6, size * 0.8);
      ctx.fillStyle = "#f4f1ff"; ctx.font = Math.round(size / 8) + "px monospace"; ctx.textAlign = "center"; ctx.fillText("?", size / 2, size / 2);
      console.warn(err.message);
      return canvas;
    });
  }
  // Small PNG of the stage-1 monkey, stored on the profile as a fallback image.
  function dataURL(options, px) {
    var c = document.createElement("canvas"); c.width = c.height = px || 96; c.style.width = c.style.height = (px || 96) + "px";
    return draw(c, options, 1).then(function () { return c.toDataURL("image/png"); });
  }

  return {
    STAGES: STAGES, HAIRS: HAIRS, REF: REF, FUR_COLORS: FUR_COLORS, HAIR_COLORS: HAIR_COLORS, OUTFIT_COLORS: OUTFIT_COLORS, BADGES: BADGES,
    HUE_TOL: HUE_TOL, MIN_CHROMA: MIN_CHROMA, lum: lum, chroma: chroma,
    hexToRgb: hexToRgb, rgbToHsl: rgbToHsl, hslToRgb: hslToRgb, hueDist: hueDist, recolor: recolor, shifts: shifts,
    defaultOptions: defaultOptions, randomOptions: randomOptions, isMonkey: isMonkey, imagePath: imagePath, badgePath: badgePath, stageName: stageName,
    draw: draw, dataURL: dataURL
  };
});
