# Monkey art: what the game expects in `docs/images/monkeys/`

Everyone in Lock-In Party is a monkey with three evolution stages: **Orangupe** (stage 1, nerdy starter), **Primacho** (stage 2, fitness), **Mega-Simian** (stage 3, mystic). One neutral body per stage. Players customise hair style, fur colour, hair colour and outfit colour. Goal badges sit under the monkey, one per locked goal.

The art is generated (Flora or similar) and dropped in as PNGs. `docs/monkey.js` recolours fur, hair and outfit at draw time by hunting for three **reference hues**, so every generated file must use exactly these colours:

| Part | Reference colour | Why |
| --- | --- | --- |
| Fur | `#F28C28` orange | shifted to the player's fur colour |
| Hair | `#2ECC71` green | shifted to the player's hair colour |
| Clothing | `#3B82F6` blue | shifted to the player's outfit colour |
| Face, ears, hands, feet | `#F5E6C8` pale cream | low chroma, never recoloured |

Keep every other colour (outlines, glasses, props) dark or grey. Anything colourful within about 28° of a reference hue gets recoloured with it.

## Files (13)

Nine monkeys, 512×512 PNG, transparent background, full body standing, facing front, feet at the bottom, centred, about 80% of the height:

```
s1-spiky.png  s1-shaggy.png  s1-curly.png
s2-spiky.png  s2-shaggy.png  s2-curly.png
s3-spiky.png  s3-shaggy.png  s3-curly.png
```

Four badges, 128×128 PNG, transparent background:

```
badge-book.png  badge-dumbbell.png  badge-steps.png  badge-dry.png
```

## Prompt that produced the spec

```
Single full-body monkey character, standing, facing front, feet at the
bottom, centered, filling about 80% of a 512x512 square. Transparent
background. 16-bit pixel art, flat shading, crisp dark outlines, no
gradients, no glow or aura, no props, no text, no watermark.
Fur colour exactly #F28C28 (orange). Hair exactly #2ECC71 (green).
Clothing exactly #3B82F6 (blue). Face, ears, hands and feet pale cream
#F5E6C8. Keep every other colour out of those four.
Stage 1: slim, young, nerdy posture, round glasses, t-shirt and shorts.
Stage 2: muscular, athletic stance, tank top and shorts, headband.
Stage 3: calm, eyes closed, long robe, standing on a small rock.
Hair: [spiky short hair | shaggy medium hair | short curly hair].
```

Badges: `Single pixel-art icon, 16-bit style, flat colours, crisp outline, transparent background, centered in a 128x128 square, no text: [open book | dumbbell | pair of footprints | cocktail glass with a red slash].`

## How the files were made (2026-11-09)

Flora generated one white-background contact sheet (3×3 monkeys, hair columns spiky / shaggy / curly, plus the four grey badges) from the prompt above. `scripts/monkey-prep.py --sheet <sheet>.png docs/images/monkeys/` slices it, keys out the background (white, or a drawn checkerboard, or real transparency), drops watermark specks, snaps every pixel to the exact reference palette (two tones per part plus a `#1A1A1A` outline), redraws a uniform outline and refits each monkey to 80% of a 512 square with its feet near the bottom. Badges are resized to 128 with their own colours kept. The same script also handles single 1024px Flora exports.

Known quirks of this generation: stage 3 shaggy and curly have no robe (bare chest), and only stage 3 spiky stands on the rock. Regenerate and rerun the script if that bothers you; the game code does not care. If a file is missing the game draws a grey block with a question mark instead of breaking.

## Checking a generated file

```bash
python3 -c "from PIL import Image; im=Image.open('docs/images/monkeys/s1-spiky.png').convert('RGBA'); print(im.size, im.getpixel((0,0)))"
```

Size should be `(512, 512)` and the corner pixel should have alpha 0.
