#!/usr/bin/env python3
"""Fetch each `/ecosystem` entry's own icon and commit it as a 64x64 PNG.

The page may not load a logo from another host: the CSP is `img-src 'self' data:`, and a
third-party image request per project would tell every one of ninety-five sites who is
reading the map. So the icons are fetched ONCE, here, by a person, and committed under
`public/ecosystem/logos/`. The diff is the review, as with the tariff refresh.

Where an icon comes from, in order:
  - a repository home (github.com/<owner>/...): the owner's avatar, which is what GitHub
    itself shows beside the project -- but ONLY when the owner is an organisation. A person's
    avatar is a photo or a cartoon of them, not the project's mark, and putting it on a map
    of projects labels their face with a product name;
  - a site: the largest raster icon its own page declares (apple-touch-icon first), then
    /apple-touch-icon.png, then /favicon.ico.
An icon that would vanish on this site's near-black page (dark ink on a transparent ground)
is set on a WHITE disc, as the brand's own white site shows it — an invisible logo reads as a
missing one, and recolouring a mark would no longer be the brand's mark. A site that publishes
only an SVG icon has it rendered by the Chromium Playwright installs (`rasterize-svg.mjs`), so
the icon is the site's own rather than a guess; the page draws an honest initial only where
this finds nothing at all.

An EXCHANGE takes the square logo CoinGecko publishes for it, read from one call to CoinGecko's
public exchange list: a site's favicon is often an old or tiny mark (Coinbase's was its retired
square "C"), while that list carries each venue's current one. Descriptive use, the same basis
as a favicon.

Writes `src/features/ecosystem/logos.generated.ts` from the icons ON DISK, so the page never
points at a file that is not there and a partial run cannot drop an existing icon. Run from the
repo root — all entries, or only some, so a new project does not refetch (and silently change)
every icon already reviewed:

    python3 scripts/ecosystem/fetch-logos.py
    python3 scripts/ecosystem/fetch-logos.py --only gemini,bitget
    python3 scripts/ecosystem/fetch-logos.py --manifest-only
"""

from __future__ import annotations

import io
import json
import re
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
ENTRIES = ROOT / "src/domain/ecosystem-entries.ts"
OUT_DIR = ROOT / "public/ecosystem/logos"
MANIFEST = ROOT / "src/features/ecosystem/logos.generated.ts"
SIZE = 64
UA = "Mozilla/5.0 (compatible; shieldedscan-ecosystem-logos/1.0; +https://shieldedscan.xyz)"
TIMEOUT = 12

# Entry id -> CoinGecko exchange id, for venues whose logo comes from CoinGecko's exchange list.
# Binance Pay is Binance's own product and carries the same mark.
COINGECKO_EXCHANGES = {
    "kraken": "kraken",
    "coinbase": "gdax",
    "binance": "binance",
    "binance-pay": "binance",
    "okx": "okex",
    "kucoin": "kucoin",
    "bitfinex": "bitfinex",
    "htx": "huobi",
    "gemini": "gemini",
    "bitget": "bitget",
    "gate": "gate",
    "whitebit": "whitebit",
    "poloniex": "poloniex",
}


def entries() -> list[tuple[str, str]]:
    """(id, url) pairs, read from the committed TypeScript so there is one list."""
    text = ENTRIES.read_text()
    text = text[text.index("ECOSYSTEM_ENTRIES") :]
    ids = re.findall(r'id: "([^"]+)"', text)
    urls = re.findall(r'url: "([^"]+)"', text)
    if len(ids) != len(urls):
        sys.exit(f"entries parse mismatch: {len(ids)} ids, {len(urls)} urls")
    return list(zip(ids, urls))


def get(url: str) -> tuple[bytes, str] | None:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as res:
            if res.status != 200:
                return None
            return res.read(2_000_000), res.headers.get("Content-Type", "")
    except Exception:  # noqa: BLE001 — any failure means "no icon from here"
        return None


class IconLinks(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.found: list[tuple[int, str]] = []
        self.svg: list[str] = []
        # An <img> named as a logo, and the share image: tried last, and only kept if square.
        self.logos: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        a = {k.lower(): (v or "") for k, v in attrs}
        if tag == "img" and re.search(r"logo|brand", a.get("src", ""), re.I):
            self.logos.append(a["src"])
            return
        if tag == "meta" and a.get("property", "").lower() == "og:image" and a.get("content"):
            self.logos.append(a["content"])
            return
        if tag != "link":
            return
        rel = a.get("rel", "").lower()
        href = a.get("href", "")
        if not href or "icon" not in rel or "mask-icon" in rel:
            return
        if href.lower().split("?")[0].endswith(".svg") or "svg" in a.get("type", ""):
            self.svg.append(href)
            return
        size = 0
        m = re.search(r"(\d+)x\d+", a.get("sizes", ""))
        if m:
            size = int(m.group(1))
        elif "apple-touch-icon" in rel:
            size = 180
        self.found.append((size, href))


def is_organisation(owner: str) -> bool:
    """GitHub's own answer; unauthenticated, 60 an hour, and there are ~20 repo homes."""
    got = get(f"https://api.github.com/users/{owner}")
    return bool(got) and b'"type": "Organization"' in got[0].replace(b'":"', b'": "')


# Icons refused by a person after looking at them, each with the reason, so a rerun cannot bring
# one back. The page draws the project's initial instead.
NO_ICON: dict[str, str] = {
}

# Icons supplied by hand, committed as given (through `to_png`) and never refetched or removed by
# a run: the project's site offers nothing usable, and a person has checked each one.
HAND_SUPPLIED = {
    "zechub": "supplied by hand: zechub.org serves no usable raster or SVG icon",
    "zingo": "supplied by hand: zingolabs.org serves no usable icon",
    "foundry": "supplied by hand: foundrydigital.com offers no usable icon",
    "cypherschool": "supplied by hand",
}

_exchange_images: dict[str, str] | None = None


def exchange_image(entry_id: str) -> str | None:
    """CoinGecko's current logo for a venue, the LARGE size, from one cached list call."""
    global _exchange_images
    cg = COINGECKO_EXCHANGES.get(entry_id)
    if cg is None:
        return None
    if _exchange_images is None:
        _exchange_images = {}
        got = get("https://api.coingecko.com/api/v3/exchanges?per_page=250&page=1")
        if got:
            for ex in json.loads(got[0]):
                _exchange_images[ex["id"]] = ex["image"].replace("/small/", "/large/")
    return _exchange_images.get(cg)


def candidates(entry_id: str, url: str) -> list[str]:
    first = exchange_image(entry_id)
    if first:
        return [first]
    u = urllib.parse.urlparse(url)
    if u.netloc == "github.com":
        owner = u.path.strip("/").split("/")[0]
        return [f"https://github.com/{owner}.png?size=128"] if is_organisation(owner) else []
    out: list[str] = []
    page = get(url)
    if page and "html" in page[1]:
        parser = IconLinks()
        try:
            parser.feed(page[0].decode("utf-8", "replace"))
        except Exception:  # noqa: BLE001
            pass
        for _, href in sorted(parser.found, key=lambda f: -f[0]):
            out.append(urllib.parse.urljoin(url, href))
    base = f"{u.scheme}://{u.netloc}"
    out += [f"{base}/apple-touch-icon.png", f"{base}/favicon.ico"]
    # SVG, then logo images and the share image, last: a raster icon the site ships is
    # preferred, but a site without one still gets its own mark.
    if page and "html" in page[1]:
        out += [urllib.parse.urljoin(url, h) for h in parser.svg]
        out += [urllib.parse.urljoin(url, h) for h in parser.logos]
    return list(dict.fromkeys(out))


def vanishes_on_dark(im: Image.Image) -> bool:
    """Dark opaque ink over a mostly transparent ground: invisible on a #050805 page."""
    px = list(im.convert("RGBA").resize((32, 32)).getdata())
    opaque = [p for p in px if p[3] > 128]
    if not opaque or len(opaque) > 0.7 * len(px):
        return False
    lum = sum(0.2126 * r + 0.7152 * g + 0.0722 * b for r, g, b, _ in opaque) / len(opaque) / 255
    return lum < 0.18


def to_png(data: bytes) -> bytes | None:
    try:
        im = Image.open(io.BytesIO(data))
        if im.format == "ICO":
            im.size = max(im.ico.sizes(), key=lambda s: s[0])
        im.load()
    except Exception:  # noqa: BLE001 — not a raster we can read
        return None
    if max(im.size) < 16:
        return None
    # A logo is square; a wide share banner is not one, however much of the brand it shows.
    if not 0.8 <= im.size[0] / im.size[1] <= 1.25:
        return None
    im = im.convert("RGBA")
    canvas = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    if vanishes_on_dark(im):
        # Dark ink on a transparent ground: set it on a white disc, inset so it sits inside.
        disc = Image.new("L", (SIZE * 4, SIZE * 4), 0)
        ImageDraw.Draw(disc).ellipse((0, 0, SIZE * 4 - 1, SIZE * 4 - 1), fill=255)
        canvas.paste((255, 255, 255, 255), (0, 0), disc.resize((SIZE, SIZE), Image.LANCZOS))
        inner = int(SIZE * 0.66)
        im.thumbnail((inner, inner), Image.LANCZOS)
    else:
        im.thumbnail((SIZE, SIZE), Image.LANCZOS)
    canvas.paste(im, ((SIZE - im.width) // 2, (SIZE - im.height) // 2), im)
    buf = io.BytesIO()
    canvas.save(buf, "PNG", optimize=True)
    return buf.getvalue()


def rasterize_svg(url: str) -> bytes | None:
    """The SVG rendered to a PNG by Chromium, or None if it cannot be fetched or drawn."""
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "icon.png"
        run = subprocess.run(
            ["node", str(ROOT / "scripts/ecosystem/rasterize-svg.mjs"), url, str(out)],
            capture_output=True,
            timeout=60,
        )
        return out.read_bytes() if run.returncode == 0 and out.exists() else None


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    only: set[str] | None = None
    if "--only" in sys.argv:
        only = set(sys.argv[sys.argv.index("--only") + 1].split(","))
    # Rewrite the manifest from the files on disk and fetch nothing: for an icon restored from
    # history or supplied by hand, where a refetch could silently replace a reviewed mark.
    if "--manifest-only" in sys.argv:
        only = set()
    all_entries = entries()
    known = {e for e, _ in all_entries}
    if only and not only <= known:
        sys.exit(f"--only names ids that are not entries: {sorted(only - known)}")
    got: list[str] = []
    missed: list[str] = []
    for entry_id, url in all_entries:
        if only is not None and entry_id not in only:
            continue
        if entry_id in HAND_SUPPLIED:
            got.append(entry_id)
            print(f"  kept {entry_id}  ({HAND_SUPPLIED[entry_id]})")
            continue
        if entry_id in NO_ICON:
            (OUT_DIR / f"{entry_id}.png").unlink(missing_ok=True)
            missed.append(entry_id)
            print(f"  --   {entry_id}  (refused: {NO_ICON[entry_id]})")
            continue
        png = None
        for cand in candidates(entry_id, url):
            if cand.lower().split("?")[0].endswith(".svg"):
                png = to_png(rasterize_svg(cand) or b"")
                if png:
                    break
                continue
            fetched = get(cand)
            if fetched is None or "svg" in fetched[1]:
                continue
            png = to_png(fetched[0])
            if png:
                break
            time.sleep(0.2)
        if png:
            (OUT_DIR / f"{entry_id}.png").write_bytes(png)
            got.append(entry_id)
            print(f"  ok   {entry_id}")
        else:
            missed.append(entry_id)
            print(f"  --   {entry_id}  (lettermark)")
        time.sleep(0.3)

    # The manifest is what is ON DISK for a current entry: a partial run keeps every icon it did
    # not touch, and an icon left behind by a removed entry is not advertised.
    on_disk = sorted(e for e in known if (OUT_DIR / f"{e}.png").exists())
    ids = ",\n".join(f'  "{i}"' for i in on_disk)
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST.write_text(
        "// Generated by scripts/ecosystem/fetch-logos.py. Do not edit by hand.\n"
        "// The ids that have a committed icon under public/ecosystem/logos/.\n"
        f"export const ECOSYSTEM_LOGOS: ReadonlySet<string> = new Set([\n{ids},\n]);\n"
    )
    print(f"\n{len(got)} icons, {len(missed)} lettermarks: {', '.join(missed)}")


if __name__ == "__main__":
    main()
