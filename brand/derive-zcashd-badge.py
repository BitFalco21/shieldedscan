#!/usr/bin/env python3
"""
Derive the zcashd mark the /network page shows from zcashd's OWN terminal logo.

    python3 brand/derive-zcashd-badge.py

Reads  brand/zcashd-metrics.h   (github.com/zcash/zcash, src/metrics.h at commit
                                 558f686599586f55def3db86955d74d3be44605e, fetched 2026-09-26)
Writes src/components/zcashd-badge.generated.ts

zcashd prints `METRICS_ART` on its metrics screen when it starts: a coloured ⓩ coin beside a
heart, drawn in text cells with ANSI colour escapes, above "Thank you for running a zcashd
node!". It is used instead of the Electric Coin Company ring logo because it is
what zcashd itself shows its operator, and it reads as zcashd's own mark rather than the
currency's.

Derived from the SOURCE string rather than traced from a screenshot, the Zebra badge's
standard: the escapes give each cell an exact foreground, background and glyph, so the result
is reproducible and exact. Each cell's colour is its background blended toward its foreground
by how much ink its glyph carries (a space is all background, '8' mostly foreground), which is
what the glyphs look like from a distance and why the logo looks "blurred" in a terminal. The
palette is VGA's, measured off a reference screenshot of the art — "yellow" is the brown
(170,85,0) the coin is known by.

A terminal cell is about twice as tall as it is wide, so each cell is drawn 1x2 pixels before
scaling, which is what makes the coin round. Only the coin's columns are kept: the heart is
separated from it by two empty columns (the coin is columns 0-39, 40x20 cells). Cells with the default background (after a reset)
are transparent, so the coin sits on any theme.
"""

import base64
import hashlib
import io
import re
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "brand" / "zcashd-metrics.h"
OUT = ROOT / "src" / "components" / "zcashd-badge.generated.ts"
SCALE = 6  # output pixels per cell width; a cell is SCALE wide and 2*SCALE tall
MAX_BYTES = 6144

# VGA palette, the terminal the art was shown in (sampled off a reference screenshot).
BASE = [(0, 0, 0), (170, 0, 0), (0, 170, 0), (170, 85, 0),
        (0, 0, 170), (170, 0, 170), (0, 170, 170), (170, 170, 170)]
BRIGHT = [(85, 85, 85), (255, 85, 85), (85, 255, 85), (255, 255, 85),
          (85, 85, 255), (255, 85, 255), (85, 255, 255), (255, 255, 255)]

# How much of a cell's area a glyph inks in a monospace font, relative to one another; scaled by
# STROKE because real strokes are thin — measured against a reference screenshot, where the
# background colour dominates every cell and the glyphs read as texture, not as fill.
STROKE = 0.3
INK = {" ": 0.0, ".": 0.12, ":": 0.2, ";": 0.28, "t": 0.42, "%": 0.5, "S": 0.55,
       "X": 0.6, "@": 0.7, "8": 0.72}


def art_lines(text: str) -> list[str]:
    start = text.index("METRICS_ART")
    # The art itself contains semicolons, so the declaration ends at the first `";` closing a
    # string literal, not at the first semicolon.
    end = re.search(r'"\s*;', text[start:]).end() + start
    lits = re.findall(r'"((?:[^"\\]|\\.)*)"', text[start:end])
    joined = "".join(lits).replace("\\n", "\n").replace('\\"', '"').replace("\\\\", "\\")
    return [ln for ln in joined.split("\n") if ln.strip()]


def parse(line: str):
    """Yield (char, fg, bg) per cell; None means the terminal default."""
    fg = bg = None
    i = 0
    cells = []
    while i < len(line):
        if line[i] == "\x1b":
            m = re.match(r"\x1b\[([0-9;]*)m", line[i:])
            if not m:
                raise SystemExit(f"unparsed escape near {line[i:i + 12]!r}")
            for code in [int(c) for c in m.group(1).split(";") if c]:
                if code == 0:
                    fg = bg = None
                elif 30 <= code <= 37:
                    fg = BASE[code - 30]
                elif 90 <= code <= 97:
                    fg = BRIGHT[code - 90]
                elif 40 <= code <= 47:
                    bg = BASE[code - 40]
                elif 100 <= code <= 107:
                    bg = BRIGHT[code - 100]
            i += len(m.group(0))
            continue
        cells.append((line[i], fg, bg))
        i += 1
    return cells


def main():
    raw = SRC.read_bytes()
    rows = [parse(ln) for ln in art_lines(raw.decode("utf-8"))]
    width = max(len(r) for r in rows)
    rows = [r + [(" ", None, None)] * (width - len(r)) for r in rows]
    used = [any(r[c][2] is not None for r in rows) for c in range(width)]
    # The coin is the first run of used columns; the heart follows after a gap of empty ones.
    first = used.index(True)
    last = first
    gap = 0
    for c in range(first, width):
        if used[c]:
            last, gap = c, 0
        else:
            gap += 1
            if gap >= 2:
                break
    top = next(i for i, r in enumerate(rows) if any(cell[2] for cell in r[first:last + 1]))
    bottom = max(i for i, r in enumerate(rows) if any(cell[2] for cell in r[first:last + 1]))
    cols, nrows = last - first + 1, bottom - top + 1
    im = Image.new("RGBA", (cols * SCALE, nrows * 2 * SCALE), (0, 0, 0, 0))
    px = im.load()
    for y in range(nrows):
        for x in range(cols):
            ch, fg, bg = rows[top + y][first + x]
            if bg is None:
                continue
            k = INK.get(ch, 0.5) * STROKE
            f = fg or bg
            col = tuple(round(bg[j] * (1 - k) + f[j] * k) for j in range(3)) + (255,)
            for dy in range(2 * SCALE):
                for dx in range(SCALE):
                    px[x * SCALE + dx, y * 2 * SCALE + dy] = col
    # Square canvas, coin centred, so every caller can size it like the other marks.
    side = max(im.size)
    sq = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    sq.paste(im, ((side - im.size[0]) // 2, (side - im.size[1]) // 2))
    buf = io.BytesIO()
    sq.save(buf, "PNG", optimize=True)
    png = buf.getvalue()
    if len(png) > MAX_BYTES:
        raise SystemExit(f"badge is {len(png)} bytes, over the {MAX_BYTES} budget")
    b64 = base64.b64encode(png).decode("ascii")
    OUT.write_text("\n".join([
        "// GENERATED by brand/derive-zcashd-badge.py — do not edit. Re-run the script instead.",
        "// zcashd's own terminal logo (METRICS_ART in github.com/zcash/zcash src/metrics.h, commit",
        f"// 558f6865), {cols}x{nrows} text cells. Source sha256 {hashlib.sha256(raw).hexdigest()[:16]}…",
        "",
        f"export const ZCASHD_BADGE_PX = {side};",
        f"export const ZCASHD_BADGE_BYTES = {len(png)};",
        f'export const ZCASHD_BADGE_DATA_URI = "data:image/png;base64,{b64}";',
        "",
    ]))
    print(f"coin {cols}x{nrows} cells -> {side}x{side}px, {len(png)} bytes; wrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
