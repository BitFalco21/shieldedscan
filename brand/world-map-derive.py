#!/usr/bin/env python3
"""
Derive the /mining-cost world map from Natural Earth geometry.

    python3 brand/world-map-derive.py

Reads  brand/world-map-source/countries-110m.json  (world-atlas 2.0.2, Natural Earth 1:110m,
                                                    public-domain geometry; the npm wrapper is ISC)
Writes src/features/mining-cost/world-map.generated.ts
       src/features/network/land-dots.generated.ts   (the /network node map's dot-matrix land)

Every country is one SVG path, keyed by ISO 3166-1 alpha-3, projected with Equal Earth into a
1000x520 viewBox and rounded to a tenth of a unit. Antarctica is dropped (nobody mines there
and it would take a third of the frame). Fourteen places the free tariff table lists have no
polygon at this resolution and are committed as POINTS instead, so no row of the data is
silently absent from the map — `MiningCostPage.test.tsx` fails when a tariff row has neither.

Deterministic on purpose: the same input yields the same file byte for byte, so a change to
the map is a diff someone can read — the `hero-city-derive.py` standard. No map library at
runtime and no CDN: the paths ship inside the page, which is what the CSP requires.

The topojson `id` is the ISO 3166-1 NUMERIC code; the alpha-3 mapping below is the ISO table
transcribed for exactly the entries world-atlas carries.
"""

import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "brand" / "world-map-source" / "countries-110m.json"
OUT = ROOT / "src" / "features" / "mining-cost" / "world-map.generated.ts"
DOTS_OUT = ROOT / "src" / "features" / "network" / "land-dots.generated.ts"

# The node map draws land as a matrix of dots rather than filled countries: a node map is
# about where nodes ARE, and a border between two countries neither of which runs a node is
# ink spent on nothing. One dot every DOT_STEP viewBox units, sampled inside the same
# projected polygons the tariff map fills, so the two maps cannot disagree about a coast.
DOT_STEP = 3.4
# Three points the TypeScript projection is pinned against (lon, lat): the origin, a city in
# each hemisphere, and one in the far east where the Equal Earth polynomial bends most.
PROJECTION_PINS = [(0.0, 0.0), (-74.0, 40.7), (151.21, -33.87), (139.69, 35.69)]

W, H = 1000, 520
# Equal Earth's x extent at the equator is ±2.7066 in projection units; scale to the width.
SCALE = W / (2 * 2.7066)
CX, CY = W / 2, H / 2 + 10

# ISO 3166-1 numeric → alpha-3, for the entries in world-atlas 110m.
NUMERIC_TO_ALPHA3 = {
    "004": "AFG", "008": "ALB", "012": "DZA", "024": "AGO", "010": "ATA", "032": "ARG", "051": "ARM",
    "036": "AUS", "040": "AUT", "031": "AZE", "044": "BHS", "050": "BGD", "112": "BLR", "056": "BEL",
    "084": "BLZ", "204": "BEN", "064": "BTN", "068": "BOL", "070": "BIH", "072": "BWA", "076": "BRA",
    "096": "BRN", "100": "BGR", "854": "BFA", "108": "BDI", "116": "KHM", "120": "CMR", "124": "CAN",
    "140": "CAF", "148": "TCD", "152": "CHL", "156": "CHN", "170": "COL", "178": "COG", "188": "CRI",
    "191": "HRV", "192": "CUB", "196": "CYP", "203": "CZE", "384": "CIV", "180": "COD", "208": "DNK",
    "262": "DJI", "214": "DOM", "218": "ECU", "818": "EGY", "222": "SLV", "226": "GNQ", "232": "ERI",
    "233": "EST", "231": "ETH", "238": "FLK", "242": "FJI", "246": "FIN", "260": "ATF", "250": "FRA",
    "266": "GAB", "270": "GMB", "268": "GEO", "276": "DEU", "288": "GHA", "300": "GRC", "304": "GRL",
    "320": "GTM", "324": "GIN", "624": "GNB", "328": "GUY", "332": "HTI", "340": "HND", "348": "HUN",
    "352": "ISL", "356": "IND", "360": "IDN", "364": "IRN", "368": "IRQ", "372": "IRL", "376": "ISR",
    "380": "ITA", "388": "JAM", "392": "JPN", "400": "JOR", "398": "KAZ", "404": "KEN", "-99": "XKX",
    "414": "KWT", "417": "KGZ", "418": "LAO", "428": "LVA", "422": "LBN", "426": "LSO", "430": "LBR",
    "434": "LBY", "440": "LTU", "442": "LUX", "807": "MKD", "450": "MDG", "454": "MWI", "458": "MYS",
    "466": "MLI", "478": "MRT", "484": "MEX", "498": "MDA", "496": "MNG", "499": "MNE", "504": "MAR",
    "508": "MOZ", "104": "MMR", "516": "NAM", "524": "NPL", "528": "NLD", "540": "NCL", "554": "NZL",
    "558": "NIC", "562": "NER", "566": "NGA", "408": "PRK", "578": "NOR", "512": "OMN", "586": "PAK",
    "275": "PSE", "591": "PAN", "598": "PNG", "600": "PRY", "604": "PER", "608": "PHL", "616": "POL",
    "620": "PRT", "630": "PRI", "634": "QAT", "642": "ROU", "643": "RUS", "646": "RWA", "728": "SSD",
    "682": "SAU", "686": "SEN", "688": "SRB", "694": "SLE", "703": "SVK", "705": "SVN", "090": "SLB",
    "706": "SOM", "710": "ZAF", "410": "KOR", "724": "ESP", "144": "LKA", "729": "SDN", "740": "SUR",
    "752": "SWE", "756": "CHE", "760": "SYR", "158": "TWN", "762": "TJK", "834": "TZA", "764": "THA",
    "626": "TLS", "768": "TGO", "780": "TTO", "788": "TUN", "792": "TUR", "795": "TKM", "800": "UGA",
    "804": "UKR", "784": "ARE", "826": "GBR", "840": "USA", "858": "URY", "860": "UZB", "548": "VUT",
    "862": "VEN", "704": "VNM", "732": "ESH", "887": "YEM", "894": "ZMB", "716": "ZWE", "748": "SWZ",
}
# Kosovo has no ISO numeric id in world-atlas (its `id` is absent), so it is keyed by name to
# the user-assigned XKX. Somaliland and Northern Cyprus carry no ISO code at all; they draw
# as land and can hold no tariff.
UNCODED = {"Kosovo": "XKX", "Somaliland": "_SOMALILAND", "N. Cyprus": "_NCYPRUS"}
DROP = {"Antarctica", "Fr. S. Antarctic Lands"}

# Places in the tariff table with no 110m polygon: (lon, lat) of the capital or centre.
POINTS = {
    "BMU": (-64.75, 32.30), "MLT": (14.40, 35.90), "SGP": (103.80, 1.35), "HKG": (114.20, 22.30),
    "BHR": (50.55, 26.10), "BRB": (-59.55, 13.10), "MUS": (57.55, -20.30), "MDV": (73.50, 4.20),
    "CPV": (-23.60, 15.10), "ABW": (-70.00, 12.50), "CYM": (-81.25, 19.30), "AND": (1.50, 42.50),
    "LIE": (9.55, 47.15), "MAC": (113.55, 22.20),
}

A1, A2, A3, A4 = 1.340264, -0.081106, 0.000893, 0.003796
M = math.sqrt(3) / 2


def equal_earth(lon, lat):
    lam, phi = math.radians(lon), math.radians(lat)
    theta = math.asin(M * math.sin(phi))
    t2 = theta * theta
    t6 = t2 ** 3
    x = 2 * math.sqrt(3) * lam * math.cos(theta) / (
        3 * (A1 + 3 * A2 * t2 + t6 * (7 * A3 + 9 * A4 * t2))
    )
    y = theta * (A1 + A2 * t2 + t6 * (A3 + A4 * t2))
    return x, y


def px(lon, lat):
    x, y = equal_earth(lon, lat)
    return round(CX + x * SCALE, 1), round(CY - y * SCALE, 1)


def main():
    topo = json.loads(SRC.read_text())
    sx, sy = topo["transform"]["scale"]
    tx, ty = topo["transform"]["translate"]
    arcs = []
    for arc in topo["arcs"]:
        x = y = 0
        pts = []
        for dx, dy in arc:
            x += dx
            y += dy
            pts.append((x * sx + tx, y * sy + ty))
        arcs.append(pts)

    def ring(indices):
        out = []
        for i in indices:
            a = arcs[~i][::-1] if i < 0 else arcs[i]
            out += a if not out else a[1:]
        return out

    def split_antimeridian(pts):
        """A ring that crosses ±180° (Russia's Chukotka, Fiji) projects as a line across the
        whole map. Cut it wherever two consecutive points are more than 180° apart; each
        piece closes on itself, which loses a sliver of area at the seam and no country."""
        pieces, cur = [], [pts[0]]
        for prev, p in zip(pts, pts[1:]):
            if abs(p[0] - prev[0]) > 180:
                pieces.append(cur)
                cur = []
            cur.append(p)
        pieces.append(cur)
        return [pc for pc in pieces if len(pc) >= 3]

    paths = {}
    names = {}
    rings = []  # every projected ring, unrounded, for the dot sample
    for g in topo["objects"]["countries"]["geometries"]:
        name = g["properties"]["name"]
        if name in DROP:
            continue
        key = UNCODED.get(name) or NUMERIC_TO_ALPHA3.get(g.get("id"))
        if key is None:
            raise SystemExit(f"no alpha-3 for {name!r} (id {g.get('id')!r}) — extend NUMERIC_TO_ALPHA3")
        polys = g["arcs"] if g["type"] == "MultiPolygon" else [g["arcs"]]
        d = ""
        for poly in polys:
            for rg in poly:
                for piece in split_antimeridian(ring(rg)):
                    projected = [px(*p) for p in piece]
                    rings.append(projected)
                    d += "M" + " ".join(f"{x},{y}" for x, y in projected) + "Z"
        paths[key] = d
        names[key] = name

    lines = [
        "// GENERATED by brand/world-map-derive.py — do not edit. Re-run the script instead.",
        "// Natural Earth 1:110m (public domain) via world-atlas 2.0.2, Equal Earth projection.",
        "",
        f"export const WORLD_MAP_WIDTH = {W};",
        f"export const WORLD_MAP_HEIGHT = {H};",
        "",
        "/** One SVG path per country, keyed by ISO 3166-1 alpha-3 (two uncoded territories keyed `_NAME`). */",
        "export const WORLD_MAP_PATHS: Readonly<Record<string, string>> = {",
    ]
    for k in sorted(paths):
        lines.append(f'  {k}: "{paths[k]}",')
    lines += [
        "};",
        "",
        "/** Natural Earth's own name for each path, for the no-tariff hover. */",
        "export const WORLD_MAP_NAMES: Readonly<Record<string, string>> = {",
    ]
    for k in sorted(names):
        lines.append(f"  {k}: {json.dumps(names[k])},")
    lines += [
        "};",
        "",
        "/** Places with a tariff but no polygon at this resolution, as projected points. */",
        "export const WORLD_MAP_POINTS: Readonly<Record<string, readonly [number, number]>> = {",
    ]
    for k in sorted(POINTS):
        x, y = px(*POINTS[k])
        lines.append(f"  {k}: [{x}, {y}],")
    lines += ["};", ""]
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text("\n".join(lines))
    print(
        f"wrote {OUT.relative_to(ROOT)}: {len(paths)} paths, {len(POINTS)} points, "
        f"{OUT.stat().st_size // 1024} KB"
    )
    write_land_dots(rings)


def land_dots(rings, step):
    """Even-odd scanline sample: for each grid row, every ring edge crossing it yields an x;
    sorted, consecutive pairs bound land. Holes and disjoint rings fall out of the parity for
    free, so no per-country geometry is consulted — 150 rows against ~11k edges."""
    edges = []
    for rg in rings:
        for (x1, y1), (x2, y2) in zip(rg, rg[1:] + rg[:1]):
            if y1 != y2:
                edges.append((x1, y1, x2, y2))
    rows = []
    y = step / 2
    while y < H:
        xs = []
        for x1, y1, x2, y2 in edges:
            if (y1 <= y < y2) or (y2 <= y < y1):
                xs.append(x1 + (y - y1) * (x2 - x1) / (y2 - y1))
        xs.sort()
        dots = []
        for a, b in zip(xs[0::2], xs[1::2]):
            # First grid column at or after the left edge.
            k = math.ceil((a - step / 2) / step)
            x = step / 2 + k * step
            while x <= b and x < W:
                dots.append(round(x, 1))
                x += step
        if dots:
            rows.append((round(y, 1), dots))
        y += step
    return rows


def write_land_dots(rings):
    rows = land_dots(rings, DOT_STEP)
    count = sum(len(dots) for _, dots in rows)
    # Zero-length subpaths with a round line cap render as dots; a relative move between
    # neighbours keeps the string short (the step repeats, so gzip folds it further).
    parts = []
    for y, dots in rows:
        prev = None
        for x in dots:
            if prev is None:
                parts.append(f"M{x} {y}h0")
            else:
                parts.append(f"m{round(x - prev, 1)} 0h0")
            prev = x
    d = "".join(parts)
    lines = [
        "// GENERATED by brand/world-map-derive.py — do not edit. Re-run the script instead.",
        "// Natural Earth 1:110m (public domain) via world-atlas 2.0.2, Equal Earth projection,",
        "// sampled as a dot matrix inside the same projected polygons the /mining-cost map fills.",
        "",
        f"export const LAND_DOTS_WIDTH = {W};",
        f"export const LAND_DOTS_HEIGHT = {H};",
        f"export const LAND_DOT_STEP = {DOT_STEP};",
        f"export const LAND_DOTS_COUNT = {count};",
        "",
        "/**",
        " * Every land dot as ONE path: zero-length subpaths, drawn with `stroke-linecap: round` so",
        " * each renders as a circle of the stroke width. Absolute move to start a row, relative",
        " * moves between neighbours.",
        " */",
        f'export const LAND_DOTS_D = "{d}";',
        "",
        "/** (lon, lat, x, y) the TypeScript projection must reproduce to a tenth of a unit. */",
        "export const PROJECTION_PINS: ReadonlyArray<readonly [number, number, number, number]> = [",
    ]
    for lon, lat in PROJECTION_PINS:
        x, y = px(lon, lat)
        lines.append(f"  [{lon}, {lat}, {x}, {y}],")
    lines += ["];", ""]
    DOTS_OUT.parent.mkdir(parents=True, exist_ok=True)
    DOTS_OUT.write_text("\n".join(lines))
    print(f"wrote {DOTS_OUT.relative_to(ROOT)}: {count} dots, {DOTS_OUT.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
