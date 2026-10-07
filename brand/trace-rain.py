"""Trace RAIN's mark from its official artwork into the path in `src/components/brand-marks.ts`.

Committed for the same reason `server/Caddyfile` and the donate-QR script are: RAIN is the one
mark on this site that is TRACED rather than sourced from simple-icons, cryptocurrency-icons or
@web3icons/core, because it is in none of them and the token's own site refuses automation. A
traced mark is only defensible while the tracing is reproducible, so the tracer ships with it.

Usage:
    cd brand && curl -sL -o rain-official.png \
      "https://coin-images.coingecko.com/coins/images/69134/large/Rain_logo_1_.png"
    python3 trace-rain.py            # writes rain_candidates.json

Then rank the candidates by measured agreement against the source rather than by eye, and paste
the winner into `brand-marks.ts`. The installed mark came out of this at
n=44, sigma=0.8, tension=0.34, corner=110 — 1.38px mean boundary error on the 250px source.

Two things here were wrong on the first attempt and are worth not repeating:

  - Ramer-Douglas-Peucker straight off the pixel contour keeps stair-step aliasing as real
    vertices, which made the droplet's bottom — a clean arc in the original — visibly lumpy.
    Resampling at uniform arc length and smoothing FIRST puts the vertices on the shape.
  - The disc's radius must be the per-ray MEDIAN of the yellow, not a bounding box. A bounding
    box takes the outermost bright pixel anywhere, overshoots by 1.7%, and paints the drawn
    disc over the official mark's black ring.
"""

import json
import math
from PIL import Image

im = Image.open("rain-official.png").convert("RGBA")
W, H = im.size
px = im.load()


def lum(p):
    return (0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]) / 255


bright = [[lum(px[x, y]) > 0.45 and px[x, y][3] > 128 for x in range(W)] for y in range(H)]
xs = [x for y in range(H) for x in range(W) if bright[y][x]]
ys = [y for y in range(H) for x in range(W) if bright[y][x]]
cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
# The disc radius from a BOUNDING BOX overshoots by 1.7% — it takes the outermost bright
# pixel anywhere, including antialiasing, so the drawn disc paints over the official mark's
# black ring. Measured per ray and taken as the median instead, which is robust to the
# droplet's base reaching the rim.
_radii = []
for _k in range(720):
    _a = 2 * math.pi * _k / 720
    _last, _r = None, 0.0
    while _r < W / 2:
        _x, _y = int(round(cx + math.cos(_a) * _r)), int(round(cy + math.sin(_a) * _r))
        if 0 <= _x < W and 0 <= _y < H and bright[_y][_x]:
            _last = _r
        _r += 0.25
    if _last is not None:
        _radii.append(_last)
_radii.sort()
r_disc = _radii[len(_radii) // 2]
inner = r_disc * 0.90
mask = [
    [
        (math.hypot(x - cx, y - cy) < inner) and lum(px[x, y]) <= 0.45 and px[x, y][3] > 128
        for x in range(W)
    ]
    for y in range(H)
]


def boundary():
    start = next((x, y) for y in range(H) for x in range(W) if mask[y][x])
    nbrs = [(1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0), (-1, -1), (0, -1), (1, -1)]
    contour, cur, bdir = [start], start, 0
    for _ in range(200000):
        for k in range(8):
            d = (bdir + 6 + k) % 8
            nx, ny = cur[0] + nbrs[d][0], cur[1] + nbrs[d][1]
            if 0 <= nx < W and 0 <= ny < H and mask[ny][nx]:
                cur, bdir = (nx, ny), d
                contour.append(cur)
                break
        else:
            break
        if len(contour) > 3 and cur == start:
            break
    return [(float(a), float(b)) for a, b in contour[:-1]]


raw = boundary()


def resample(points, n):
    """Uniform arc-length resampling — vertices land on the shape, not on the aliasing."""
    closed = points + [points[0]]
    seg = [math.dist(closed[i], closed[i + 1]) for i in range(len(closed) - 1)]
    total = sum(seg)
    out, target, acc, i = [], 0.0, 0.0, 0
    for _ in range(n):
        while i < len(seg) and acc + seg[i] < target:
            acc += seg[i]
            i += 1
        if i >= len(seg):
            break
        t = (target - acc) / seg[i] if seg[i] else 0
        a, b = closed[i], closed[i + 1]
        out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
        target += total / n
    return out


def smooth(points, sigma):
    if sigma <= 0:
        return points
    half = max(1, int(sigma * 2))
    ker = [math.exp(-(k * k) / (2 * sigma * sigma)) for k in range(-half, half + 1)]
    tot = sum(ker)
    n = len(points)
    return [
        (
            sum(points[(i + k - half) % n][0] * ker[k] for k in range(len(ker))) / tot,
            sum(points[(i + k - half) % n][1] * ker[k] for k in range(len(ker))) / tot,
        )
        for i in range(n)
    ]


def angle_at(p, i):
    a, b, c = p[(i - 1) % len(p)], p[i], p[(i + 1) % len(p)]
    v1, v2 = (a[0] - b[0], a[1] - b[1]), (c[0] - b[0], c[1] - b[1])
    n1, n2 = math.hypot(*v1), math.hypot(*v2)
    if not n1 or not n2:
        return math.pi
    return math.acos(max(-1, min(1, (v1[0] * v2[0] + v1[1] * v2[1]) / (n1 * n2))))


SCALE = 24 / W


def build(n_pts, sigma, tension, corner_deg):
    pts = smooth(resample(raw, n_pts), sigma)
    corner = math.radians(corner_deg)
    corners = {i for i in range(len(pts)) if angle_at(pts, i) < corner}
    s = lambda v: round(v * SCALE, 3)
    d, n = [], len(pts)
    for i in range(n):
        p0, p1, p2, p3 = pts[(i - 1) % n], pts[i], pts[(i + 1) % n], pts[(i + 2) % n]
        if i == 0:
            d.append(f"M{s(p1[0])} {s(p1[1])}")
        if i in corners or (i + 1) % n in corners:
            d.append(f"L{s(p2[0])} {s(p2[1])}")
            continue
        c1 = (p1[0] + (p2[0] - p0[0]) * tension, p1[1] + (p2[1] - p0[1]) * tension)
        c2 = (p2[0] - (p3[0] - p1[0]) * tension, p2[1] - (p3[1] - p1[1]) * tension)
        d.append(f"C{s(c1[0])} {s(c1[1])} {s(c2[0])} {s(c2[1])} {s(p2[0])} {s(p2[1])}")
    d.append("Z")
    return "".join(d), len(corners)


R = round(r_disc * SCALE, 3)
CX, CY = round(cx * SCALE, 3), round(cy * SCALE, 3)
disc = (
    f"M{CX} {round(CY - R, 3)}A{R} {R} 0 1 0 {CX} {round(CY + R, 3)}"
    f"A{R} {R} 0 1 0 {CX} {round(CY - R, 3)}Z"
)

candidates = []
for n_pts in (26, 34, 44, 56):
    for sigma in (0.8, 1.4, 2.2):
        for tension in (0.22, 0.28, 0.34):
            for corner_deg in (110, 125):
                droplet, ncorners = build(n_pts, sigma, tension, corner_deg)
                candidates.append(
                    {
                        "params": f"n={n_pts} sigma={sigma} tension={tension} corner={corner_deg}",
                        "corners": ncorners,
                        "d": disc + droplet,
                        "chars": len(disc + droplet),
                    }
                )

json.dump(candidates, open("rain_candidates.json", "w"))
print(f"{len(candidates)} candidates, {min(c['chars'] for c in candidates)}-{max(c['chars'] for c in candidates)} chars")
