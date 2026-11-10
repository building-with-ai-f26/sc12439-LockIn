#!/usr/bin/env python3
"""
monkey-prep.py — clean a Flora-generated monkey sprite into a game-ready PNG.

  python3 scripts/monkey-prep.py "<downloaded>.png" docs/images/monkeys/s1-spiky.png
  python3 scripts/monkey-prep.py --sheet "<3x3 monkeys + 4 badges>.png" docs/images/monkeys/

Accepts Flora's drawn checkerboard, a flat white background, or real transparency.
With --sheet it finds the 13 figures on the sheet (rows = stages, columns = hair
styles spiky, shaggy, curly; bottom row = book, dumbbell, steps, dry badges).

What it does, in order:
  1. keys out the drawn checkerboard (near-black and light-grey squares connected to the border)
  2. snaps every remaining pixel to the game palette: fur #F28C28, hair #2ECC71,
     clothing #3B82F6, skin #F5E6C8 (each with one darker shadow tone), outline #1A1A1A,
     greys kept grey. This also erases the semi-transparent watermark and JPEG noise.
  3. redraws a uniform dark outline around the sprite
  4. crops to the sprite, scales it to 80% of a 512x512 square, feet near the bottom
Needs Pillow (python3 -m pip install pillow).
"""
import sys, colorsys
from collections import deque
from PIL import Image, ImageFilter

REF = {"fur": (0xF2, 0x8C, 0x28), "hair": (0x2E, 0xCC, 0x71), "cloth": (0x3B, 0x82, 0xF6), "cream": (0xF5, 0xE6, 0xC8)}
HUES = {"fur": 30, "hair": 145, "cloth": 217}
DARK = (0x1A, 0x1A, 0x1A)
SIZE, FILL, OUTLINE_PX = 512, 0.80, 9

def shade(rgb, k): return tuple(max(0, int(round(c * k))) for c in rgb)

def classify(p):
    r, g, b = p[:3]
    mx, mn = max(r, g, b), min(r, g, b)
    ch = (mx - mn) / 255.0
    lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0
    if ch < 0.09:
        return ("dark" if lum < 0.22 else "lgrey" if lum > 0.58 else "grey"), lum
    h = colorsys.rgb_to_hls(r / 255.0, g / 255.0, b / 255.0)[0] * 360
    if ch < 0.32 and lum > 0.68 and abs(h - 40) < 30: return "cream", lum
    best = min(HUES, key=lambda k: min(abs(h - HUES[k]), 360 - abs(h - HUES[k])))
    return best, lum

def lum_of(p): r, g, b = p[:3]; return (0.299 * r + 0.587 * g + 0.114 * b) / 255.0
def chroma_of(p): r, g, b = p[:3]; return (max(r, g, b) - min(r, g, b)) / 255.0

def checker_grid(im):
    """Period and offset of the drawn checkerboard, read off the top row and left column."""
    px = im.load(); W, H = im.size
    def edges(line):
        l = [lum_of(v) for v in line]
        return [i for i in range(2, len(l) - 2) if abs(l[i] - l[i - 1]) > 0.25]
    def fit(idx):
        idx = [i for j, i in enumerate(idx) if j == 0 or i - idx[j - 1] > 4]
        gaps = sorted(idx[j] - idx[j - 1] for j in range(1, len(idx)))
        S = gaps[len(gaps) // 2] if gaps else 32
        return S, (idx[0] % S) if idx else 0
    Sx, ox = fit(edges([px[x, 3] for x in range(W)]))
    Sy, oy = fit(edges([px[3, y] for y in range(H)]))
    return Sx, ox, Sy, oy

def prep(src, dst, palette=True, size=SIZE):
    raw = (src if isinstance(src, Image.Image) else Image.open(src)).convert("RGBA")
    W, H = raw.size
    rp = raw.load()
    corner = rp[2, 2]
    transparent_src = corner[3] < 16
    white_src = (not transparent_src) and lum_of(corner) > 0.9 and chroma_of(corner) < 0.08
    raw = raw.convert("RGB"); rp = raw.load()
    Sx, ox, Sy, oy = checker_grid(raw) if not (white_src or transparent_src) else (32, 0, 32, 0)
    dark_first = lum_of(rp[ox + Sx // 2 if ox + Sx // 2 < W else Sx // 2, oy + Sy // 2 if oy + Sy // 2 < H else Sy // 2]) < 0.5
    def expected_dark(x, y): return ((((x - ox) // Sx) + ((y - oy) // Sy)) % 2 == 0) == dark_first
    def near_line(x, y):
        dx, dy = (x - ox) % Sx, (y - oy) % Sy
        return dx < 3 or dx > Sx - 3 or dy < 3 or dy > Sy - 3
    src_alpha = (src if isinstance(src, Image.Image) else Image.open(src)).convert("RGBA").getchannel("A").load()
    def checker(x, y):
        if transparent_src: return src_alpha[x, y] < 16
        p = rp[x, y]
        if chroma_of(p) > 0.12: return False
        l = lum_of(p)
        if white_src: return l > 0.82
        if near_line(x, y): return True
        return l < 0.6 if expected_dark(x, y) else l > 0.4

    # 1. background = checkerboard pixels connected to the border (the watermark
    #    lightens black squares, so the dark test is generous)
    bg = [[False] * W for _ in range(H)]
    q = deque()
    for x in range(W):
        for y in (0, H - 1):
            if checker(x, y): bg[y][x] = True; q.append((x, y))
    for y in range(H):
        for x in (0, W - 1):
            if checker(x, y) and not bg[y][x]: bg[y][x] = True; q.append((x, y))
    dropped = 0
    while q:
        x, y = q.popleft()
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < W and 0 <= ny < H and not bg[ny][nx] and checker(nx, ny):
                bg[ny][nx] = True; q.append((nx, ny))
    # keep only the biggest foreground island; smaller ones are watermark remnants
    seen = [[False] * W for _ in range(H)]
    comps = []
    for y0 in range(H):
        for x0 in range(W):
            if bg[y0][x0] or seen[y0][x0]: continue
            comp = []; dq = deque([(x0, y0)]); seen[y0][x0] = True
            while dq:
                x, y = dq.popleft(); comp.append((x, y))
                for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                    if 0 <= nx < W and 0 <= ny < H and not bg[ny][nx] and not seen[ny][nx]:
                        seen[ny][nx] = True; dq.append((nx, ny))
            comps.append(comp)
    # Feet and hands may only touch the body through the (removed) outline, so
    # keep every island of real size that has some colour in it; specks and
    # grey-only islands (watermark letters, the odd rock) go.
    comps.sort(key=len, reverse=True)
    MIN_ISLAND = (W * H) // 2500
    for comp in comps[1:]:
        colourful = any(chroma_of(rp[x, y]) > 0.2 for x, y in comp[::7])
        if len(comp) < MIN_ISLAND or not colourful:
            dropped += 1
            for x, y in comp: bg[y][x] = True

    im = raw.filter(ImageFilter.MedianFilter(3))
    px = im.load()
    cls = [[None] * W for _ in range(H)]
    lums = [[0.0] * W for _ in range(H)]
    for y in range(H):
        for x in range(W):
            if not bg[y][x]: cls[y][x], lums[y][x] = classify(px[x, y])

    # 2. palette snap. Shadow tone when a pixel is clearly darker than its class median.
    med = {}
    for k in REF:
        vals = sorted(lums[y][x] for y in range(H) for x in range(W) if not bg[y][x] and cls[y][x] == k)
        med[k] = vals[len(vals) // 2] if vals else 0.5
    out = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    op = out.load()
    for y in range(H):
        for x in range(W):
            if bg[y][x]: continue
            k, lum = cls[y][x], lums[y][x]
            if not palette: op[x, y] = px[x, y] + (255,); continue
            if k == "dark": op[x, y] = DARK + (255,)
            elif k in ("grey", "lgrey"): op[x, y] = (0x8A, 0x8A, 0x8A, 255) if lum < 0.5 else (0xB8, 0xB8, 0xB8, 255)
            else: op[x, y] = (shade(REF[k], 0.72) if lum < med[k] - 0.08 else REF[k]) + (255,)

    # 3. clean the silhouette (open: erode then dilate kills JPEG specks along the
    #    edge), then a uniform outline: transparent pixels within OUTLINE_PX go dark
    alpha = out.getchannel("A").filter(ImageFilter.MinFilter(3)).filter(ImageFilter.MaxFilter(3))
    ap = alpha.load()
    for y in range(H):
        for x in range(W):
            if not ap[x, y]: op[x, y] = (0, 0, 0, 0)
    grown = alpha.filter(ImageFilter.MaxFilter(OUTLINE_PX * 2 + 1))
    gp = grown.load()
    for y in range(H):
        for x in range(W):
            if gp[x, y] and not ap[x, y]: op[x, y] = DARK + (255,)

    # 4. crop, fit to 80% height, centre horizontally, feet 6% above the bottom
    box = out.getbbox()
    sprite = out.crop(box)
    fill = FILL if palette else 0.75
    scale = min((size * fill) / sprite.height, (size * 0.9) / sprite.width)
    sprite = sprite.resize((max(1, round(sprite.width * scale)), max(1, round(sprite.height * scale))), Image.NEAREST if palette else Image.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    y0 = size - sprite.height - int(size * 0.06) if palette else (size - sprite.height) // 2
    canvas.paste(sprite, ((size - sprite.width) // 2, y0), sprite)
    canvas.save(dst)
    kept = sum(1 for y in range(H) for x in range(W) if not bg[y][x])
    print(f"{dst}: checker {Sx}px, sprite {sprite.width}x{sprite.height}, kept {kept * 100 // (W * H)}% of source pixels, {dropped} specks dropped, {len(comps) - 1 - dropped} extra islands kept, medians {{{', '.join(k + ': ' + format(v, '.2f') for k, v in med.items())}}}")

HAIR_COLS = ["spiky", "shaggy", "curly"]
BADGES = ["book", "dumbbell", "steps", "dry"]

def sheet(src, outdir):
    """Find the 13 figures on a white contact sheet and run prep() on each."""
    import os
    im = Image.open(src).convert("RGB"); W, H = im.size; px = im.load()
    step = 4   # coarse grid for blob finding
    gw, gh = W // step, H // step
    def find_blobs(test, y_from=0):
      fg = [[test(px[x * step, y * step]) for x in range(gw)] for y in range(gh)]
      seen = [[False] * gw for _ in range(gh)]
      blobs = []
      for y0 in range(y_from // step, gh):
        for x0 in range(gw):
            if not fg[y0][x0] or seen[y0][x0]: continue
            dq = deque([(x0, y0)]); seen[y0][x0] = True; cells = []
            while dq:
                x, y = dq.popleft(); cells.append((x, y))
                for nx in range(x - 3, x + 4):
                    for ny in range(y - 3, y + 4):
                        if 0 <= nx < gw and 0 <= ny < gh and fg[ny][nx] and not seen[ny][nx]:
                            seen[ny][nx] = True; dq.append((nx, ny))
            if len(cells) < 40: continue
            xs = [c[0] for c in cells]; ys = [c[1] for c in cells]
            blobs.append((min(xs) * step, min(ys) * step, (max(xs) + 1) * step, (max(ys) + 1) * step))
      return blobs
    blobs = find_blobs(lambda p: chroma_of(p) > 0.2)   # the monkeys: anything colourful
    # merge blobs that overlap or nearly touch (a figure split by the watermark, a slash over a glass)
    def merge(blobs, gap=12):
        merged = True
        while merged:
            merged = False
            for i in range(len(blobs)):
                for j in range(i + 1, len(blobs)):
                    a, b = blobs[i], blobs[j]
                    if a[0] < b[2] + gap and b[0] < a[2] + gap and a[1] < b[3] + 40 and b[1] < a[3] + 40:
                        blobs[i] = (min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3])); del blobs[j]; merged = True; break
                if merged: break
        return blobs
    blobs = merge(blobs)
    blobs.sort(key=lambda b: (b[1] + b[3]) / 2)
    rows = []
    for b in blobs:
        cy = (b[1] + b[3]) / 2
        if rows and abs(cy - rows[-1][0]) < H * 0.12: rows[-1][1].append(b); rows[-1][0] = (rows[-1][0] + cy) / 2
        else: rows.append([cy, [b]])
    # the badges are grey, so below the last monkey row look for anything that is not white
    monkey_bottom = max(b[3] for r in rows[:3] for b in r[1]) if len(rows) >= 3 else 0
    badges = find_blobs(lambda p: lum_of(p) < 0.85, y_from=monkey_bottom + 8)
    badges = merge([b for b in badges if b[1] > monkey_bottom], gap=40)   # the two footprints sit apart
    rows = rows[:3] + [[0, badges]]
    print(f"found {len(blobs)} monkeys in {len(rows) - 1} rows (" + ", ".join(str(len(r[1])) for r in rows[:3]) + f") and {len(badges)} badges")
    if [len(r[1]) for r in rows] != [3, 3, 3, 4]:
        sys.exit("expected rows of 3, 3, 3 monkeys and 4 badges; crop the sheet or fix the grid")
    pad = 10
    for si, row in enumerate(rows[:3]):
        for hi, b in enumerate(sorted(row[1], key=lambda b: b[0])):
            tile = im.crop((max(0, b[0] - pad), max(0, b[1] - pad), min(W, b[2] + pad), min(H, b[3] + pad)))
            prep(tile, os.path.join(outdir, f"s{si + 1}-{HAIR_COLS[hi]}.png"))
    for bi, b in enumerate(sorted(rows[3][1], key=lambda b: b[0])):
        tile = im.crop((max(0, b[0] - pad), max(0, b[1] - pad), min(W, b[2] + pad), min(H, b[3] + pad)))
        prep(tile, os.path.join(outdir, f"badge-{BADGES[bi]}.png"), palette=False, size=128)

if __name__ == "__main__":
    if len(sys.argv) == 4 and sys.argv[1] == "--sheet": sheet(sys.argv[2], sys.argv[3])
    elif len(sys.argv) == 3: prep(sys.argv[1], sys.argv[2])
    else: sys.exit(__doc__)
