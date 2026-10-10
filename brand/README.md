# Brand assets

Generators for the site's brand assets: the social profile artwork, the favicon, the share card
and the derived marks and maps the site embeds. Everything is rendered from the site's own design
tokens and self-hosted JetBrains Mono, so a change to the design is one command away from every
asset, and the output can be reviewed as a diff.

## Prerequisites

- Node.js with the repository's dev dependencies installed (`npm install`) and Playwright's
  Chromium (`npx playwright install chromium`), for the `.mjs` generators.
- Python 3 with Pillow (`pip install pillow`), and fontTools (`pip install fonttools`) for the
  font subset, for the `.py` derivations.

## Social artwork

```
node brand/generate.mjs                        # the shipped avatar, banners and share card
MARK=eyeveil node brand/generate.mjs           # another mark (see mark-candidates.png)
ALT_MARK=facetshield node brand/generate.mjs   # another alternate avatar
SEED=11 node brand/generate.mjs                # another roll of the banner's skyline
```

Only the avatar and the X header are committed; the other files below render locally and are
ignored, so a run never adds them back.

| File                                        | Use                                                                        |
| ------------------------------------------- | -------------------------------------------------------------------------- |
| `shieldedscan-avatar-400.png`               | profile picture; also the source of the favicon                            |
| `shieldedscan-avatar-alt-400.png`           | the alternate mark, same size                                              |
| `shieldedscan-avatar-1000.png`              | master, for platforms wanting more than 400px                              |
| `shieldedscan-banner-1500x500.png`          | X header                                                                   |
| `shieldedscan-banner-1500x500-no-url.png`   | the same header without the domain                                         |
| `shieldedscan-banner-1500x500-safe.png`     | no domain, laid out inside X's vertical crop                               |
| `shieldedscan-linkedin-2256x382.png`        | LinkedIn company cover (2x its 1128x191)                                   |
| `shieldedscan-og-{photo,city}-1200x630.png` | share-card variants; `OG_BACKDROP` picks the one copied to `public/og.png` |
| `shieldedscan-mark.svg`                     | the mark alone, flat                                                       |
| `mark-candidates.png`                       | every mark at 200/96/48/24px, circle-cropped                               |
| `mockup-*.png`                              | checks: each asset composited where the platform shows it                  |

### Design notes

- **The mark** is the wordmark in a terminal window (`wm`); the alternate (`glyphshield`) is the
  site's privacy shield in neon tube carrying the redaction bars. The shield reuses the path from
  `src/components/PrivacyShield.tsx`, and nothing emits an SVG `id`, so one sheet can render
  every mark several times.
- **A wordmark has two costs.** Fourteen characters cannot resolve at a timeline's 48px, and
  `shieldedscan-mark.svg` is `<text>`, so it renders in JetBrains Mono only where that font is
  installed. The PNGs are authoritative; outline the text before using the SVG anywhere else.
- **Zcash's ⓩ is not used as the mark.** Labelling ZEC with it is descriptive use; making it
  this project's identity would imply an affiliation.
- **The banner's city is drawn, not photographed** (`city.mjs`), and seeded, so it follows the
  palette and the same seed always renders the same image. It carries no axis, scale or figure:
  a plausible-looking chart nobody can check would be a fabricated figure.
- **Platforms crop.** X shows roughly the middle half of a header's height and overlays the
  avatar bottom-left; LinkedIn's cover is about 5.6:1 with a large logo tile at the left.
  `SAFE_TOP`/`SAFE_BOTTOM` in `banner.mjs` and `linkedInCoverHtml` lay the copy out inside what
  survives, and the `mockup-*.png` files show the result where the platform puts it.
- **An avatar is cropped to a circle**, so a framed mark must fit inside diameter ÷ √2 of the
  canvas or its corners disappear.

## Other generators

| Command                                | Writes                                                    |
| -------------------------------------- | --------------------------------------------------------- |
| `node brand/favicon.mjs`               | `src/app/icon.png`, `apple-icon.png`, `public/icon-*.png` |
| `node brand/render-alerts.mjs`         | `shieldedscan-alerts-1600x900.png`                        |
| `python3 brand/hero-city-derive.py`    | `public/hero-city/` (the homepage backdrop cuts)          |
| `python3 brand/subset-og-fonts.py`     | `src/features/og/fonts.generated.ts`                      |
| `python3 brand/derive-zebra-badge.py`  | `src/components/zebra-badge.generated.ts`                 |
| `python3 brand/derive-zcashd-badge.py` | `src/components/zcashd-badge.generated.ts`                |
| `python3 brand/derive-mcp-icon.py`     | `server/mcp-icon.generated.ts`                            |
| `npm run map:derive`                   | the `/mining-cost` and `/network` map geometry            |
| `python3 brand/trace-rain.py`          | candidate paths for the RAIN mark in `brand-marks.ts`     |

The films in `trailer/` have their own [README](trailer/README.md).
