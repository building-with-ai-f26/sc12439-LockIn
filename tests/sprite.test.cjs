// Tests for docs/sprite.js. Run with: node --test "tests/*.test.cjs"
const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../docs/sprite.js");

function allLayers() {
  const out = [["BODY", S.BODY], ["EYES", S.EYES], ["GLASSES", S.GLASSES]];
  for (const [name, set] of [["HAIR", S.HAIR], ["FACIAL", S.FACIAL], ["TOPS", S.TOPS], ["BOTTOMS", S.BOTTOMS]])
    for (const k of Object.keys(set)) out.push([name + "." + k, set[k]]);
  return out;
}

test("every layer row is exactly WIDTH wide and uses known roles", () => {
  const roles = new Set(".SHTtABbFEG".split(""));
  for (const [name, layer] of allLayers()) {
    layer.rows.forEach((row, i) => {
      assert.equal(row.length, S.WIDTH, `${name} row ${i} has width ${row.length}`);
      for (const ch of row) assert.ok(roles.has(ch), `${name} row ${i} has unknown role '${ch}'`);
    });
    assert.ok(layer.y + layer.rows.length <= S.HEIGHT, `${name} overflows the grid`);
  }
});

test("render returns a 24x15 grid with transparent margins and a skin-coloured face", () => {
  const g = S.render({ skin: "#F1C27D" });
  assert.equal(g.length, S.HEIGHT);
  assert.equal(g[0].length, S.WIDTH);
  assert.equal(g[0][0], null);
  assert.equal(g[23][0], null);
  assert.equal(g[6][7], "#F1C27D");          // middle of the face
});

test("eyes show without glasses and are covered with glasses", () => {
  assert.equal(S.render({ glasses: false })[5][6], "#1A1A1A");
  assert.equal(S.render({ glasses: false })[5][7], S.DEFAULTS.skin);
  const g = S.render({ glasses: true });
  assert.equal(g[5][4], "#1A1A1A");
  assert.equal(g[5][7], "#1A1A1A");
});

test("tops and bottoms recolour the right regions", () => {
  const g = S.render({ top: "jacket", topColor: "#111111", shirtColor: "#EEEEEE", bottom: "pants", bottomColor: "#0000FF", shoesColor: "#FF0000" });
  assert.equal(g[12][4], "#111111");   // jacket
  assert.equal(g[10][7], "#EEEEEE");   // shirt collar
  assert.equal(g[19][5], "#0000FF");   // pants
  assert.equal(g[21][5], S.lighten("#0000FF", 0.35)); // cuff lighter
  assert.equal(g[22][4], "#FF0000");   // shoes
  const tank = S.render({ top: "tank", skin: "#ABCDEF" });
  assert.equal(tank[12][3], "#ABCDEF"); // bare arm
});

test("every style combination renders without throwing", () => {
  for (const hair of Object.keys(S.HAIR)) for (const top of Object.keys(S.TOPS)) for (const bottom of Object.keys(S.BOTTOMS)) for (const facial of Object.keys(S.FACIAL))
    assert.equal(S.render({ hair, top, bottom, facial }).length, S.HEIGHT);
});

test("unknown style names fall back to defaults", () => {
  const o = S.normalize({ hair: "mullet", top: "cape" });
  assert.equal(o.hair, S.DEFAULTS.hair);
  assert.equal(o.top, S.DEFAULTS.top);
});

test("renderRGBA matches render", () => {
  const g = S.render({});
  const rgba = S.renderRGBA({});
  assert.equal(rgba.length, S.WIDTH * S.HEIGHT * 4);
  const i = (6 * S.WIDTH + 7) * 4;
  assert.deepEqual([rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]], [...S.hexToRgb(g[6][7]), 255]);
  assert.equal(rgba[3], 0); // top-left transparent
});

test("suggestColors picks the nearest skin and hair tones from a photo", () => {
  const w = 20, h = 20, data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const [r, g, b] = y < 4 ? [30, 20, 15] : [200, 170, 110];   // dark hair on top, tan face below
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
  }
  const s = S.suggestColors(data, w, h);
  assert.equal(s.hairColor, "#1A1A1A");
  assert.equal(s.skin, "#E0AC69");
});

test("randomOptions is deterministic for a fixed generator and always valid", () => {
  let n = 0; const rnd = () => ((n += 7) % 10) / 10;
  const a = S.randomOptions(rnd); n = 0; const b = S.randomOptions(rnd);
  assert.deepEqual(a, b);
  assert.ok(S.HAIR[a.hair] && S.TOPS[a.top] && S.BOTTOMS[a.bottom] && S.FACIAL[a.facial]);
});

test("stage 1 has no aura; stages 2 and 3 add a growing ring in the stage colour", () => {
  const look = { hair: "short", top: "tee" };
  const g1 = S.render(look, 1), g2 = S.render(look, 2), g3 = S.render(look, 3);
  const count = (g, hex) => g.flat().filter((c) => c === hex).length;
  assert.equal(count(g1, S.STAGES[2].aura), 0);
  assert.equal(count(g1, S.STAGES[3].aura), 0);
  assert.ok(count(g2, S.STAGES[2].aura) > 20, "stage 2 should have a blue ring");
  assert.ok(count(g3, S.STAGES[3].aura) > count(g2, S.STAGES[2].aura), "stage 3 ring is thicker");
  // the ring sits outside the body: the cell left of the head is aura at stage 2, empty at stage 1
  assert.equal(g1[4][4], null);
  assert.equal(g2[4][4], S.STAGES[2].aura);
  // the body itself is never overwritten
  assert.notEqual(g2[6][7], S.STAGES[2].aura);
  assert.equal(g2.length, S.HEIGHT);
});

test("enrich saturates colours but leaves greys alone and never blows out", () => {
  assert.equal(S.enrich("#C0392B", 0), "#C0392B");
  const red = S.enrich("#C0392B", 0.3);
  assert.notEqual(red, "#C0392B");
  assert.match(red, /^#[0-9A-F]{6}$/);
  assert.equal(S.enrich("#8E8E9A", 0.3).toLowerCase() !== "#8e8e9a", true);  // brightens a little
  assert.equal(S.render({ skin: "#FFE0BD" }, 3)[6][7] !== "#FFE0BD", true);   // stage 3 skin is shifted
});
