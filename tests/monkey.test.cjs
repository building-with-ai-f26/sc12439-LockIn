// Tests for the pure parts of docs/monkey.js. Run with: node --test "tests/*.test.cjs"
const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../docs/monkey.js");

const px = (hex, a = 255) => M.hexToRgb(hex).concat([a]);
const hueOf = (rgba) => M.rgbToHsl(rgba[0], rgba[1], rgba[2])[0];
const near = (a, b, tol) => Math.abs(a - b) <= tol;

test("hex/hsl round trips", () => {
  assert.deepEqual(M.hexToRgb("#F28C28"), [242, 140, 40]);
  assert.deepEqual(M.hexToRgb("#fff"), [255, 255, 255]);
  const hsl = M.rgbToHsl(242, 140, 40);
  assert.ok(near(hsl[0], 30, 1));
  const back = M.hslToRgb(hsl[0], hsl[1], hsl[2]);
  assert.ok(back.every((v, i) => near(v, [242, 140, 40][i], 1)));
  assert.equal(M.hueDist(350, 10), 20);
  assert.ok(M.chroma(245, 230, 200) < M.MIN_CHROMA, "cream is low-chroma even though HSL saturation is high");
  assert.ok(M.chroma(242, 140, 40) > M.MIN_CHROMA);
});

test("recolor moves reference fur to the chosen fur colour and keeps shading", () => {
  const light = px("#F7B06B"), dark = px("#B5661A");    // lighter and darker orange fur
  const data = new Uint8ClampedArray([].concat(px("#F28C28"), light, dark));
  M.recolor(data, { fur: "#5B6B8C" });                  // blue-grey
  const target = M.rgbToHsl(...M.hexToRgb("#5B6B8C"));
  for (let i = 0; i < 3; i++) {
    const p = Array.from(data.slice(i * 4, i * 4 + 4));
    assert.ok(near(hueOf(p), target[0], 2), "hue moved to target");
  }
  const l = (i) => M.rgbToHsl(data[i * 4], data[i * 4 + 1], data[i * 4 + 2])[2];
  assert.ok(l(1) > l(0) && l(0) > l(2), "light stays lighter, dark stays darker");
});

test("recolor leaves cream skin, outlines and transparent pixels alone", () => {
  const skin = px("#F5E6C8"), outline = px("#1A1A1A"), clear = [242, 140, 40, 0];
  const data = new Uint8ClampedArray([].concat(skin, outline, clear));
  M.recolor(data, { fur: "#3A2E2A", hairColor: "#1A1A1A", outfit: "#C0392B" });
  assert.deepEqual(Array.from(data), [].concat(skin, outline, clear));
});

test("each reference part maps independently; unrelated hues are untouched", () => {
  const data = new Uint8ClampedArray([].concat(px("#F28C28"), px("#2ECC71"), px("#3B82F6"), px("#FF00FF")));
  M.recolor(data, { fur: "#8B5A2B", hairColor: "#F4F1FF", outfit: "#FFD23F" });
  assert.ok(near(hueOf(data.slice(0, 4)), M.rgbToHsl(...M.hexToRgb("#8B5A2B"))[0], 2));
  assert.ok(data[4] > 225 && data[5] > 225 && data[6] > 225, "hair went near-white");
  assert.ok(near(hueOf(data.slice(8, 12)), M.rgbToHsl(...M.hexToRgb("#FFD23F"))[0], 2));
  assert.deepEqual(Array.from(data.slice(12, 16)), px("#FF00FF"), "magenta is no one's reference hue");
});

test("options, paths and names", () => {
  assert.equal(M.isMonkey(M.defaultOptions()), true);
  assert.equal(M.isMonkey({ hair: "pompadour" }), false);
  assert.equal(M.imagePath(2, "shaggy"), "images/monkeys/s2-shaggy.png");
  assert.equal(M.imagePath(9, "nope"), "images/monkeys/s3-spiky.png");
  assert.equal(M.badgePath("reading"), "images/monkeys/badge-book.png");
  assert.equal(M.badgePath("fitness"), "images/monkeys/badge-dumbbell.png");
  assert.deepEqual(M.STAGES, ["ROOKIE", "CONTENDER", "LEGEND"]);
  const r = M.randomOptions();
  assert.ok(M.HAIRS.some((h) => h.id === r.hair) && M.FUR_COLORS.includes(r.fur));
});
