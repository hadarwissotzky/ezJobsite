#!/usr/bin/env python3
"""
Turn a raw icon drop into a tintable glyph.

WHY THIS EXISTS: `assets/icon-*.png` are the raw drops — 1024x1536 canvases with the
glyph floating in the middle of a flat background (black, grey, olive, ochre; it
varies per drop). `assets/icons/*.png` are what the app actually loads, and icon.tsx
renders them through `tintColor`, which only works on an ALPHA MASK: the colour has
to come from the app, not from the file. A raw drop used directly renders as a grey
rectangle with the glyph faintly inside it.

icon.tsx says of the processed set: "cropped to the glyph + 9% breathing room and
downscaled to 128 square, with the background-removal residue stripped ... The raw
drops are kept as the source of truth — regenerate, don't edit." That instruction had
no script behind it, so the second batch of drops sat unused and the app drew generic
substitutes instead of the approved artwork. This is the script.

WHAT IT DOES, and why each step is not optional:
  1. Samples the background from the border ring, PER FILE. The drops do not share a
     background, so a hardcoded colour would silently mangle half of them.
  2. Builds alpha from distance-to-background, not from a luminance threshold. A
     threshold turns anti-aliased strokes into staircases at 128px; distance keeps the
     soft edge that makes a 22pt glyph legible.
  3. Puts ALL the information in alpha and sets RGB to pure white. This is what makes
     `tintColor` exact — any residual colour in RGB tints toward itself.
  4. Drops alpha below a floor. The drops carry a faint gradient across the whole
     canvas (icon.tsx names icon-flash.png specifically); without this the "empty"
     area keeps a few percent alpha and the glyph renders inside a visible tinted box.
  5. Crops to the alpha bounding box, then pads to a square with 9% breathing room,
     so glyphs of different aspect ratios end up optically the same size in a row.

Needs Pillow. Usage:
    python3 scripts/crop-icons.py doc coin calendar bell buble pen send clock
    python3 scripts/crop-icons.py                    # every icon-*.png
Output: apps/mobile/assets/icons/<name>.png at 128x128 RGBA.
"""
import sys, os, glob
from PIL import Image

RAW = 'apps/mobile/assets'
OUT = 'apps/mobile/assets/icons'
SIZE = 128
PAD = 0.09          # icon.tsx's stated breathing room
ALPHA_FLOOR = 0.16  # below this is background residue, not stroke

# The drops are named for what they are; a couple are misspelled at source.
RENAME = {'locaiton': 'location', 'shiled': 'shield', 'buble': 'bubble'}


def background(im):
    """The border ring's mean colour. Sampled per file — the drops do not agree."""
    w, h = im.size
    px = im.load()
    ring = []
    for x in range(0, w, 4):
        ring += [px[x, 0], px[x, h - 1]]
    for y in range(0, h, 4):
        ring += [px[0, y], px[w - 1, y]]
    n = len(ring)
    return tuple(sum(c[i] for c in ring) // n for i in range(3))


def convert(path):
    im = Image.open(path).convert('RGB')
    bg = background(im)
    w, h = im.size
    src = im.load()

    # Distance for every pixel first, then normalise against the 99.5th PERCENTILE
    # rather than the single strongest pixel.
    #
    # The max is the wrong reference twice over. Several drops sit on a radial glow
    # or vignette, whose brightest point beats the glyph itself — normalising to it
    # scaled the real strokes down until `bell` and `send` came out nearly invisible,
    # while the glow survived as a halo around `bubble` and `lock-check`. A high
    # percentile ignores that handful of outlier pixels, so the STROKE ends up at
    # full opacity and the glow falls under the floor where it belongs.
    dist = [0.0] * (w * h)
    for y in range(h):
        row = y * w
        for x in range(w):
            p = src[x, y]
            dist[row + x] = abs(p[0] - bg[0]) + abs(p[1] - bg[1]) + abs(p[2] - bg[2])
    ordered = sorted(dist)
    peak = ordered[int(len(ordered) * 0.995)] or (ordered[-1] or 1)

    out = Image.new('RGBA', (w, h), (255, 255, 255, 0))
    dst = out.load()
    for y in range(h):
        row = y * w
        for x in range(w):
            d = dist[row + x] / peak
            if d < ALPHA_FLOOR:
                continue
            dst[x, y] = (255, 255, 255,
                         int(min(1.0, (d - ALPHA_FLOOR) / (1 - ALPHA_FLOOR)) * 255))

    box = out.getbbox()
    if box is None:
        raise SystemExit(f'{path}: nothing survived background removal')
    glyph = out.crop(box)

    side = int(max(glyph.size) * (1 + PAD * 2))
    square = Image.new('RGBA', (side, side), (255, 255, 255, 0))
    square.paste(glyph, ((side - glyph.width) // 2, (side - glyph.height) // 2))
    return square.resize((SIZE, SIZE), Image.LANCZOS)


def main():
    names = sys.argv[1:]
    files = ([os.path.join(RAW, f'icon-{n}.png') for n in names] if names
             else sorted(glob.glob(os.path.join(RAW, 'icon-*.png'))))
    os.makedirs(OUT, exist_ok=True)
    for f in files:
        stem = os.path.basename(f)[len('icon-'):-len('.png')]
        name = RENAME.get(stem, stem)
        convert(f).save(os.path.join(OUT, name + '.png'))
        print('wrote', name + '.png')


if __name__ == '__main__':
    main()
