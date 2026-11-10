#!/usr/bin/env python3
"""
monkey-prep.py — clean a Flora-generated monkey sprite into a game-ready PNG.

  python3 scripts/monkey-prep.py "<downloaded>.png" docs/images/monkeys/s1-spiky.png

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

def prep(src, dst):
    raw = Image.open(src).convert("RGB")
    W, H = raw.size
    rp = raw.load()
    Sx, ox, Sy, oy = checker_grid(raw)
    dark_first = lum_of(rp[ox + Sx // 2 if ox + Sx // 2 < W else Sx // 2, oy + Sy // 2 if oy + Sy // 2 < H else Sy // 2]) < 0.5
    def expected_dark(x, y): return ((((x - ox) // Sx) + ((y - oy) // Sy)) % 2 == 0) == dark_first
    def near_line(x, y):
        dx, dy = (x - ox) % Sx, (y - oy) % Sy
        return dx < 3 or dx > Sx - 3 or dy < 3 or dy > Sy - 3
    def checker(x, y):
        p = rp[x, y]
        if chroma_of(p) > 0.12: return False
        l = lum_of(p)
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
    # keep every island of real size; only specks and watermark crumbs go.
    comps.sort(key=len, reverse=True)
    MIN_ISLAND = (W * H) // 2500
    for comp in comps[1:]:
        if len(comp) < MIN_ISLAND:
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
    scale = (SIZE * FILL) / sprite.height
    sprite = sprite.resize((max(1, round(sprite.width * scale)), round(SIZE * FILL)), Image.NEAREST)
    canvas = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    canvas.paste(sprite, ((SIZE - sprite.width) // 2, SIZE - sprite.height - int(SIZE * 0.06)), sprite)
    canvas.save(dst)
    kept = sum(1 for y in range(H) for x in range(W) if not bg[y][x])
    print(f"{dst}: checker {Sx}px, sprite {sprite.width}x{sprite.height}, kept {kept * 100 // (W * H)}% of source pixels, {dropped} specks dropped, {len(comps) - 1 - dropped} extra islands kept, medians {{{', '.join(k + ': ' + format(v, '.2f') for k, v in med.items())}}}")

if __name__ == "__main__":
    if len(sys.argv) != 3: sys.exit(__doc__)
    prep(sys.argv[1], sys.argv[2])
