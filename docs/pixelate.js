/*
  pixelate.js — pure pixel-art logic for the Lock-In Party prototype.

  No DOM in here. The browser page (prototype.html) feeds this raw RGBA
  pixel data from a canvas; the Node test feeds it hand-made arrays.
  Works as a plain <script> (exposes window.Pixelate) and as a CommonJS
  module (module.exports) so the same code runs in both places.
*/
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Pixelate = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Retro palettes. Each is a list of hex colors; the quantizer snaps every
  // pixel to the nearest one. "original" is special: no palette, just
  // posterize each channel to a few levels so it still looks 8-bit.
  var PALETTES = {
    arcade: {
      label: "ARCADE 16",
      colors: ["#000000", "#1D2B53", "#7E2553", "#008751", "#AB5236", "#5F574F",
               "#C2C3C7", "#FFF1E8", "#FF004D", "#FFA300", "#FFEC27", "#00E436",
               "#29ADFF", "#83769C", "#FF77A8", "#FFCCAA"]
    },
    portrait: {
      label: "PORTRAIT",
      colors: ["#000000", "#1A1A2E", "#3D2B1F", "#5C3A21", "#8D5524", "#C68642",
               "#E0AC69", "#F1C27D", "#FFDBAC", "#FFFFFF", "#C8C8D0", "#8E8E9A",
               "#4A4A5A", "#C0392B", "#2980B9", "#27AE60", "#F1C40F"]
    },
    lockin: {
      label: "LOCK-IN",
      colors: ["#000000", "#14122B", "#1F1C42", "#3A3575", "#B7B0E0", "#F4F1FF",
               "#FFD23F", "#3DDC84", "#FF5C7A", "#4CC9F0", "#AB5236", "#FFCCAA"]
    },
    gameboy: {
      label: "GAME BOY",
      colors: ["#0F380F", "#306230", "#8BAC0F", "#9BBC0F"]
    },
    original: { label: "ORIGINAL (posterized)", colors: null }
  };

  // 4x4 Bayer matrix for ordered dithering. Values 0..15.
  var BAYER4 = [
    [0, 8, 2, 10],
    [12, 4, 14, 6],
    [3, 11, 1, 9],
    [15, 7, 13, 5]
  ];

  function hexToRgb(hex) {
    var h = hex.replace("#", "");
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }

  function clamp255(v) {
    return v < 0 ? 0 : v > 255 ? 255 : v;
  }

  // Index of the palette color closest to (r,g,b). Distance is weighted a
  // little toward green because eyes are most sensitive to it.
  function nearestColor(rgbPalette, r, g, b) {
    var best = 0, bestD = Infinity;
    for (var i = 0; i < rgbPalette.length; i++) {
      var p = rgbPalette[i];
      var dr = p[0] - r, dg = p[1] - g, db = p[2] - b;
      var d = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  // Snap a 0..255 channel value to one of `levels` evenly spaced values.
  function posterize(v, levels) {
    var step = 255 / (levels - 1);
    return Math.round(Math.round(v / step) * step);
  }

  /*
    quantize(data, width, height, options) -> Uint8ClampedArray

    data:    RGBA bytes, length width*height*4 (what canvas getImageData gives).
    options.palette: key from PALETTES, or an array of hex strings, or null for posterize.
    options.dither:  true to apply ordered dithering before snapping.
    options.spread:  how strong the dither is in 0..255 units (default 40).
    options.levels:  posterize levels per channel when palette is null (default 4).

    Alpha is preserved. Returns a new array; the input is not modified.
  */
  function quantize(data, width, height, options) {
    options = options || {};
    var paletteOpt = options.palette;
    var hexList = Array.isArray(paletteOpt) ? paletteOpt
                : (paletteOpt && PALETTES[paletteOpt]) ? PALETTES[paletteOpt].colors
                : null;
    var rgbPalette = hexList ? hexList.map(hexToRgb) : null;
    var dither = !!options.dither;
    var spread = options.spread == null ? 40 : options.spread;
    var levels = options.levels || 4;

    var out = new Uint8ClampedArray(data.length);
    for (var y = 0; y < height; y++) {
      for (var x = 0; x < width; x++) {
        var i = (y * width + x) * 4;
        var r = data[i], g = data[i + 1], b = data[i + 2];
        if (dither) {
          // Bayer offset in -0.5..+0.5, scaled by spread, added to every channel.
          var t = (BAYER4[y & 3][x & 3] / 16 - 0.5) * spread;
          r = clamp255(r + t); g = clamp255(g + t); b = clamp255(b + t);
        }
        if (rgbPalette) {
          var c = rgbPalette[nearestColor(rgbPalette, r, g, b)];
          out[i] = c[0]; out[i + 1] = c[1]; out[i + 2] = c[2];
        } else {
          out[i] = posterize(r, levels);
          out[i + 1] = posterize(g, levels);
          out[i + 2] = posterize(b, levels);
        }
        out[i + 3] = data[i + 3];
      }
    }
    return out;
  }

  return {
    PALETTES: PALETTES,
    BAYER4: BAYER4,
    hexToRgb: hexToRgb,
    nearestColor: nearestColor,
    posterize: posterize,
    quantize: quantize
  };
});
