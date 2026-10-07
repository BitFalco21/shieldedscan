#!/usr/bin/env python3
"""
Derive the homepage backdrop cuts from the source photograph.

    python3 brand/hero-city-derive.py

Reads  brand/hero-city-clean.png          (1764×892, generated photograph, no UI baked in)
Writes public/hero-city/city-{2560,1920,1280}.{webp,jpg}

The 2560 cut is an UPSCALE — the source is 1764px wide and a 2× laptop wants ~2560 device
pixels across — and an upscale is where a full-bleed photograph goes soft. Lanczos plus a
restrained unsharp mask (radius 1.6, 85%) puts the edge acuity back without halos on the
neon; verified by eye on a 1:1 crop of the ZCASH sign before this was committed. Downscales
get a lighter touch so the dense window grids do not start to shimmer.

WebP is the served format (universal since 2020) with progressive JPEG as the `<img>`
fallback. No AVIF: Pillow here has no encoder, and a format nobody can regenerate is a
format that drifts. Same argument as `brand/generate.mjs` — an asset the repo cannot
re-derive is an asset nobody can review.

Requires Pillow. Committed for the same reason `trace-rain.py` is: a derived asset is only
defensible while its derivation is reproducible.
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "brand" / "hero-city-clean.png"
OUT = ROOT / "public" / "hero-city"
WIDTHS = (2560, 1920, 1280)

# Besides the ⓩ emblem and the ZCASH sign, the photograph carries a highway sign reading
# "Shielded Privacy Freedom" on the mid-left building, legible on wide screens; it is
# removed. The patch is applied here rather than in the plate, so the source image stays
# untouched and the removal is reproducible: the sign region is covered with the same
# building's facade cloned from directly above it, through a feathered mask so the seam
# dissolves into the window grid. Coordinates are in the 1764x892 source.
SIGN_BOX = (430, 364, 532, 468)


def remove_sign(im: Image.Image) -> Image.Image:
    x0, y0, x1, y1 = SIGN_BOX
    h = y1 - y0
    donor = im.crop((x0, y0 - h - 6, x1, y0 - 6))
    mask = Image.new("L", donor.size, 0)
    ImageDraw.Draw(mask).rectangle((8, 8, donor.size[0] - 9, donor.size[1] - 9), fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(6))
    out = im.copy()
    out.paste(donor, (x0, y0), mask)
    return out


def main() -> None:
    src = remove_sign(Image.open(SRC).convert("RGB"))
    w0, h0 = src.size
    OUT.mkdir(parents=True, exist_ok=True)
    for w in WIDTHS:
        h = round(h0 * w / w0)
        im = src.resize((w, h), Image.LANCZOS)
        if w > w0:
            im = im.filter(ImageFilter.UnsharpMask(radius=1.6, percent=85, threshold=2))
        else:
            im = im.filter(ImageFilter.UnsharpMask(radius=0.8, percent=45, threshold=3))
        webp = OUT / f"city-{w}.webp"
        jpg = OUT / f"city-{w}.jpg"
        im.save(webp, "WEBP", quality=86, method=6)
        im.save(jpg, "JPEG", quality=84, optimize=True, progressive=True)
        print(f"{w}x{h}  {webp.name} {webp.stat().st_size // 1024} KB  {jpg.name} {jpg.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
