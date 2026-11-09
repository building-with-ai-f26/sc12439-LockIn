// Deterministic tests for docs/pixelate.js. Run with: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../docs/pixelate.js");

test("hexToRgb parses 6-digit hex", () => {
  assert.deepEqual(P.hexToRgb("#FFD23F"), [255, 210, 63]);
  assert.deepEqual(P.hexToRgb("000000"), [0, 0, 0]);
});

test("nearestColor picks the closest palette entry", () => {
  const pal = ["#000000", "#FFFFFF", "#FF0000"].map(P.hexToRgb);
  assert.equal(P.nearestColor(pal, 10, 10, 10), 0);
  assert.equal(P.nearestColor(pal, 250, 250, 250), 1);
  assert.equal(P.nearestColor(pal, 200, 30, 30), 2);
});

test("posterize snaps to evenly spaced levels", () => {
  assert.equal(P.posterize(0, 4), 0);
  assert.equal(P.posterize(255, 4), 255);
  assert.equal(P.posterize(100, 4), 85);   // 255/3 = 85 per step
  assert.equal(P.posterize(130, 2), 255);
});

test("quantize with a palette outputs only palette colors and keeps alpha", () => {
  // 2x2 image: dark grey, light grey, pure red, half-transparent blue.
  const data = new Uint8ClampedArray([
    30, 30, 30, 255,   220, 220, 220, 255,
    255, 0, 0, 255,    0, 0, 255, 128,
  ]);
  const out = P.quantize(data, 2, 2, { palette: ["#000000", "#FFFFFF", "#FF0000", "#0000FF"] });
  const px = (i) => Array.from(out.slice(i * 4, i * 4 + 4));
  assert.deepEqual(px(0), [0, 0, 0, 255]);
  assert.deepEqual(px(1), [255, 255, 255, 255]);
  assert.deepEqual(px(2), [255, 0, 0, 255]);
  assert.deepEqual(px(3), [0, 0, 255, 128]);
  // Input untouched.
  assert.equal(data[0], 30);
});

test("quantize with a named palette resolves it from PALETTES", () => {
  const data = new Uint8ClampedArray([15, 56, 15, 255]);
  const out = P.quantize(data, 1, 1, { palette: "gameboy" });
  assert.deepEqual(Array.from(out), [15, 56, 15, 255]);
});

test("quantize with no palette posterizes every channel", () => {
  const data = new Uint8ClampedArray([100, 200, 50, 255]);
  const out = P.quantize(data, 1, 1, { palette: null, levels: 4 });
  assert.deepEqual(Array.from(out), [85, 170, 85, 255]);
});

test("dithering changes a flat mid-grey into a mix of two palette colors", () => {
  const n = 4;
  const data = new Uint8ClampedArray(n * n * 4).fill(255);
  for (let i = 0; i < n * n; i++) { data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = 128; }
  const pal = ["#000000", "#FFFFFF"];
  const flat = P.quantize(data, n, n, { palette: pal, dither: false });
  const dith = P.quantize(data, n, n, { palette: pal, dither: true, spread: 200 });
  const uniq = (arr) => new Set(Array.from({ length: n * n }, (_, i) => arr[i * 4])).size;
  assert.equal(uniq(flat), 1, "no dither: one color");
  assert.equal(uniq(dith), 2, "dither: both black and white appear");
});
