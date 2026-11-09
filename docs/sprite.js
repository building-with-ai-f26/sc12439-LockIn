/*
  sprite.js — 8-bit character sprites for Lock-In Party.

  A character is a 15×24 pixel grid composed from layers of ASCII art.
  Each character in a row is a colour role:
    .  transparent      S  skin         H  hair        E  eye
    T  top colour       t  shirt/inner  A  accent (tie)
    B  bottoms          b  cuff (auto lighter bottoms)
    F  shoes            G  glasses
  render(options) resolves roles to hex colours and returns the grid.
  No DOM here; works as <script> (window.Sprite) and CommonJS.
*/
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Sprite = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var WIDTH = 15, HEIGHT = 24;

  // Body: head, neck, long-sleeve torso, pants, shoes. Tops/bottoms paint over it.
  var BODY = { y: 0, rows: [
    "...............",
    "...............",
    ".....SSSSS.....",
    ".....SSSSS.....",
    ".....SSSSS.....",
    ".....SSSSS.....",
    ".....SSSSS.....",
    ".....SSSSS.....",
    "......SSS......",
    ".......S.......",
    "...TTTTTTTTT...",
    "...TTTTTTTTT...",
    "...TTTTTTTTT...",
    "...TTTTTTTTT...",
    "...TTTTTTTTT...",
    "...TTTTTTTTT...",
    "...TTTTTTTTT...",
    "...TTTTTTTTT...",
    "...SBBB.BBBS...",
    "....BBB.BBB....",
    "....BBB.BBB....",
    "....bbb.bbb....",
    "...FFFF.FFFF...",
    "...FFFF.FFFF..."
  ] };

  var HAIR = {
    short:     { y: 1, rows: [".....HHHHH.....", "....HHHHHHH....", "....H.....H...."] },
    pompadour: { y: 0, rows: ["...HHHHH.......", "...HHHHHHHH....", "....HHHHHHH....", "....HH....H....", "....H.....H....", "....H.....H...."] },
    long:      { y: 1, rows: [".....HHHHH.....", "....HHHHHHH....", "....H.....H....", "....H.....H....", "....H.....H....", "....H.....H....", "....H.....H....", "....HH...HH....", "....HHH.HHH....", "...HH.....HH...", "...HH.....HH..."] },
    afro:      { y: 0, rows: ["....HHHHHHH....", "...HHHHHHHHH...", "...HHHHHHHHH...", "...HH.....HH...", "...HH.....HH...", "...H.......H...", "...H.......H..."] },
    bun:       { y: 0, rows: ["......HHH......", ".....HHHHH.....", "....HHHHHHH....", "....H.....H...."] },
    sidepart:  { y: 1, rows: [".....HHHHH.....", "....HHHHHHH....", "....HHH...H....", "....H.....H...."] },
    buzz:      { y: 2, rows: [".....HHHHH....."] },
    bald:      { y: 0, rows: [] }
  };

  var FACIAL = {
    none:     { y: 6, rows: [] },
    mustache: { y: 6, rows: ["......HHH......"] },
    beard:    { y: 6, rows: [".....H...H.....", ".....HHHHH.....", "......HHH......"] },
    goatee:   { y: 8, rows: ["......HHH......"] }
  };

  var EYES    = { y: 5, rows: ["......E.E......"] };
  var GLASSES = { y: 5, rows: ["....GGGGGGG...."] };

  var TOPS = {
    tee:    { y: 10, rows: ["...TTTTTTTTT...", "...TTTTTTTTT...", "...TTTTTTTTT...", "...STTTTTTTS...", "...STTTTTTTS...", "...STTTTTTTS...", "...STTTTTTTS...", "...SBBBBBBBS..."] },
    jacket: { y: 10, rows: ["...TTTtttTTT...", "...TTTTtTTTT...", "...TTTTtTTTT...", "...TTTTtTTTT...", "...TTTTtTTTT...", "...TTTTtTTTT...", "...TTTTtTTTT...", "...TTTTtTTTT..."] },
    hoodie: { y: 9,  rows: ["....TTTTTTT....", "...TTTTTTTTT...", "...TTTTTTTTT...", "...TTTTTTTTT...", "...TTTTTTTTT...", "...TTTTTTTTT...", "...TTtttttTT...", "...TTtttttTT...", "...TTTTTTTTT..."] },
    suit:   { y: 10, rows: ["...TTTtttTTT...", "...TTTtAtTTT...", "...TTTtAtTTT...", "...TTTTATTTT...", "...TTTTTTTTT...", "...TTTTTTTTT...", "...TTTTTTTTT...", "...TTTTTTTTT..."] },
    tank:   { y: 10, rows: ["...SSTTTTTSS...", "...STTTTTTTS...", "...STTTTTTTS...", "...STTTTTTTS...", "...STTTTTTTS...", "...STTTTTTTS...", "...STTTTTTTS...", "...SBBBBBBBS..."] }
  };

  var BOTTOMS = {
    pants:  { y: 18, rows: ["...SBBB.BBBS...", "....BBB.BBB....", "....BBB.BBB....", "....bbb.bbb...."] },
    shorts: { y: 18, rows: ["...SBBB.BBBS...", "....bbb.bbb....", "....SSS.SSS....", "....SSS.SSS...."] },
    skirt:  { y: 18, rows: ["...SBBBBBBBS...", "....BBBBBBB....", "....SSS.SSS....", "....SSS.SSS...."] }
  };

  var COLORS = {
    skin:   ["#FFE0BD", "#F1C27D", "#E0AC69", "#C68642", "#8D5524", "#5C3A21"],
    hair:   ["#1A1A1A", "#3D2B1F", "#6B4423", "#B5651D", "#D9B380", "#B22222", "#8E8E9A", "#E8E8E8", "#4CC9F0", "#FF5C7A"],
    top:    ["#1A1A1A", "#F4F1FF", "#3A3575", "#1D63DC", "#C0392B", "#27AE60", "#FFD23F", "#FF5C7A", "#8E44AD", "#4A4A5A"],
    shirt:  ["#F4F1FF", "#1A1A1A", "#4CC9F0", "#FFD23F", "#FF5C7A", "#8E8E9A"],
    accent: ["#C0392B", "#FFD23F", "#4CC9F0", "#1A1A1A"],
    bottom: ["#1F5FA8", "#1A1A1A", "#4A4A5A", "#8D5524", "#F4F1FF", "#27AE60", "#3A3575"],
    shoes:  ["#1A1A1A", "#F4F1FF", "#8D5524", "#C0392B", "#4CC9F0"]
  };

  var DEFAULTS = {
    hair: "short", hairColor: COLORS.hair[1], skin: COLORS.skin[1],
    facial: "none", glasses: false,
    top: "jacket", topColor: COLORS.top[0], shirtColor: COLORS.shirt[0], accentColor: COLORS.accent[0],
    bottom: "pants", bottomColor: COLORS.bottom[0], shoesColor: COLORS.shoes[0]
  };

  function hexToRgb(hex) { var h = hex.replace("#", ""); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }
  function rgbToHex(r, g, b) { return "#" + [r, g, b].map(function (v) { v = Math.max(0, Math.min(255, Math.round(v))); return (v < 16 ? "0" : "") + v.toString(16).toUpperCase(); }).join(""); }
  function lighten(hex, amt) { var c = hexToRgb(hex); return rgbToHex(c[0] + (255 - c[0]) * amt, c[1] + (255 - c[1]) * amt, c[2] + (255 - c[2]) * amt); }

  // Evolution stages (see game-rules.js). Stage 1 is the plain sprite. Higher
  // stages keep the same shape but get richer colours and a glowing aura.
  var STAGES = {
    1: { aura: null,      thick: 0, enrich: 0 },
    2: { aura: "#4CC9F0", thick: 1, enrich: 0.18 },   // blue glow, 4-neighbour ring
    3: { aura: "#FFD23F", thick: 2, enrich: 0.35 }    // gold glow, 8-neighbour ring
  };
  function rgbToHsl(c) {
    var r = c[0] / 255, g = c[1] / 255, b = c[2] / 255, max = Math.max(r, g, b), min = Math.min(r, g, b), h = 0, s = 0, l = (max + min) / 2;
    if (max !== min) {
      var d = max - min; s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4; h /= 6;
    }
    return [h, s, l];
  }
  function hslToHex(h, s, l) {
    function f(n) { var k = (n + h * 12) % 12, a = s * Math.min(l, 1 - l); return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); }
    return rgbToHex(f(0) * 255, f(8) * 255, f(4) * 255);
  }
  // More saturated and a touch brighter. Near-greys and near-blacks only brighten a little.
  function enrich(hex, amt) {
    if (!amt) return hex;
    var hsl = rgbToHsl(hexToRgb(hex));
    var sat = hsl[1] < 0.08 ? hsl[1] : Math.min(1, hsl[1] + amt);
    return hslToHex(hsl[0], sat, Math.min(0.92, hsl[2] + amt * 0.25));
  }
  // Paint an aura ring onto transparent cells next to the body. thick 1 = edges only, 2 = corners too.
  function paintAura(grid, color, thick) {
    var cells = [];
    for (var y = 0; y < HEIGHT; y++) for (var x = 0; x < WIDTH; x++) {
      if (grid[y][x]) continue;
      var hit = false;
      for (var dy = -1; dy <= 1 && !hit; dy++) for (var dx = -1; dx <= 1 && !hit; dx++) {
        if (!dx && !dy) continue;
        if (thick < 2 && dx && dy) continue;
        var yy = y + dy, xx = x + dx;
        if (yy >= 0 && yy < HEIGHT && xx >= 0 && xx < WIDTH && grid[yy][xx]) hit = true;
      }
      if (hit) cells.push([y, x]);
    }
    cells.forEach(function (c) { grid[c[0]][c[1]] = color; });
  }

  function paint(grid, layer, colors) {
    for (var r = 0; r < layer.rows.length; r++) {
      var y = layer.y + r, row = layer.rows[r];
      if (y < 0 || y >= HEIGHT) continue;
      for (var x = 0; x < WIDTH; x++) {
        var ch = row[x];
        if (ch && ch !== ".") grid[y][x] = colors[ch] || null;
      }
    }
  }

  function normalize(opts) {
    var o = {};
    for (var k in DEFAULTS) o[k] = (opts && opts[k] != null) ? opts[k] : DEFAULTS[k];
    if (!HAIR[o.hair]) o.hair = DEFAULTS.hair;
    if (!FACIAL[o.facial]) o.facial = DEFAULTS.facial;
    if (!TOPS[o.top]) o.top = DEFAULTS.top;
    if (!BOTTOMS[o.bottom]) o.bottom = DEFAULTS.bottom;
    o.glasses = !!o.glasses;
    return o;
  }

  // Returns HEIGHT rows × WIDTH cells of hex colour or null (transparent).
  function render(opts, stage) {
    var o = normalize(opts);
    var st = STAGES[stage] || STAGES[1];
    var e = function (hex) { return enrich(hex, st.enrich); };
    var colors = {
      S: e(o.skin), H: e(o.hairColor), T: e(o.topColor), t: e(o.shirtColor), A: e(o.accentColor),
      B: e(o.bottomColor), b: e(lighten(o.bottomColor, 0.35)), F: e(o.shoesColor), E: "#1A1A1A", G: "#1A1A1A"
    };
    var grid = [];
    for (var y = 0; y < HEIGHT; y++) { var row = []; for (var x = 0; x < WIDTH; x++) row.push(null); grid.push(row); }
    paint(grid, BODY, colors);
    paint(grid, BOTTOMS[o.bottom], colors);
    paint(grid, TOPS[o.top], colors);
    paint(grid, HAIR[o.hair], colors);
    if (!o.glasses) paint(grid, EYES, colors);
    paint(grid, FACIAL[o.facial], colors);
    if (o.glasses) paint(grid, GLASSES, colors);
    if (st.aura) paintAura(grid, st.aura, st.thick);
    return grid;
  }

  // Same thing as RGBA bytes for canvas putImageData.
  function renderRGBA(opts, stage) {
    var grid = render(opts, stage);
    var out = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
    for (var y = 0; y < HEIGHT; y++) for (var x = 0; x < WIDTH; x++) {
      var hex = grid[y][x]; if (!hex) continue;
      var c = hexToRgb(hex), i = (y * WIDTH + x) * 4;
      out[i] = c[0]; out[i + 1] = c[1]; out[i + 2] = c[2]; out[i + 3] = 255;
    }
    return out;
  }

  function nearest(list, r, g, b) {
    var best = list[0], bestD = Infinity;
    list.forEach(function (hex) {
      var c = hexToRgb(hex), dr = c[0] - r, dg = c[1] - g, db = c[2] - b;
      var d = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
      if (d < bestD) { bestD = d; best = hex; }
    });
    return best;
  }

  // Average colour of a box (fractions of width/height) in RGBA pixel data.
  function averageBox(data, w, h, x0, y0, x1, y1) {
    var r = 0, g = 0, b = 0, n = 0;
    for (var y = Math.floor(h * y0); y < Math.floor(h * y1); y++)
      for (var x = Math.floor(w * x0); x < Math.floor(w * x1); x++) {
        var i = (y * w + x) * 4;
        if (data[i + 3] < 128) continue;
        r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
      }
    return n ? [r / n, g / n, b / n] : null;
  }

  // Guess skin and hair colours from a face-centred photo. Users can override.
  function suggestColors(data, w, h) {
    var face = averageBox(data, w, h, 0.38, 0.35, 0.62, 0.58);
    var top  = averageBox(data, w, h, 0.35, 0.04, 0.65, 0.18);
    return {
      skin: face ? nearest(COLORS.skin, face[0], face[1], face[2]) : DEFAULTS.skin,
      hairColor: top ? nearest(COLORS.hair, top[0], top[1], top[2]) : DEFAULTS.hairColor
    };
  }

  function pick(list, rnd) { return list[Math.floor(rnd() * list.length)]; }
  function randomOptions(rnd) {
    rnd = rnd || Math.random;
    return {
      hair: pick(Object.keys(HAIR), rnd), hairColor: pick(COLORS.hair, rnd), skin: pick(COLORS.skin, rnd),
      facial: pick(Object.keys(FACIAL), rnd), glasses: rnd() < 0.3,
      top: pick(Object.keys(TOPS), rnd), topColor: pick(COLORS.top, rnd), shirtColor: pick(COLORS.shirt, rnd), accentColor: pick(COLORS.accent, rnd),
      bottom: pick(Object.keys(BOTTOMS), rnd), bottomColor: pick(COLORS.bottom, rnd), shoesColor: pick(COLORS.shoes, rnd)
    };
  }

  return {
    WIDTH: WIDTH, HEIGHT: HEIGHT, COLORS: COLORS, DEFAULTS: DEFAULTS, STAGES: STAGES, enrich: enrich,
    HAIR: HAIR, FACIAL: FACIAL, TOPS: TOPS, BOTTOMS: BOTTOMS, BODY: BODY, EYES: EYES, GLASSES: GLASSES,
    hexToRgb: hexToRgb, rgbToHex: rgbToHex, lighten: lighten, nearest: nearest,
    normalize: normalize, render: render, renderRGBA: renderRGBA, suggestColors: suggestColors, randomOptions: randomOptions
  };
});
