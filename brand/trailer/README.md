# Films

Three, all 1920×1080, 30fps, H.264 High + AAC 192k, `+faststart`, sized for a
Twitter/X landscape post:

| file                          | length | subject                               | ends on                        |
| ----------------------------- | ------ | ------------------------------------- | ------------------------------ |
| `shieldedscan-trailer.mp4`    | 24.2s  | launch — the Veil, analytics, the API | `shieldedscan.xyz`             |
| `shieldedscan-crosschain.mp4` | 23.8s  | ZEC cross-chain flow                  | `shieldedscan.xyz/cross-chain` |
| `shieldedscan-agent.mp4`      | 30.8s  | the answering agent                   | `shieldedscan.xyz/ai-agent`    |

The rendered `.mp4` files are not committed; rebuild them with the commands below.

**The end card of `shieldedscan-agent.mp4` names `/ai-agent`** rather than the homepage: a
viewer who watches half a minute about the agent should land on the agent.

`film.js` is the shared drawing kit — palette, easing, panels, the redaction
bar, the shield grammar, Sankey ribbons, the glitch and the CRT post chain. One
copy on purpose: two canvases drifting apart on what a shield looks like is the
duplication this codebase has been bitten by before. Each film owns only its
data, its timeline (`SC`) and its scenes.

Generated, not edited by hand, for the same reason the avatar and banner are
(`brand/README.md`): an exported video drifts from the design it came from, and
nothing about a hand-cut file can be reviewed in a diff.

## Build

```sh
cd brand/trailer

# launch trailer
node audio.mjs                                     # → score-trailer.wav
node render.mjs                                    # → frames/ (~4 min)
ffmpeg -y -framerate 30 -i frames/f%05d.png -i score-trailer.wav \
  -c:v libx264 -preset slow -crf 17 -pix_fmt yuv420p -profile:v high -level 4.0 \
  -c:a aac -b:a 192k -ar 48000 -movflags +faststart -shortest \
  shieldedscan-trailer.mp4

# cross-chain film
node audio.mjs crosschain                          # → score-crosschain.wav
FILM=crosschain.html FRAMES_DIR=frames-cc node render.mjs
ffmpeg -y -framerate 30 -i frames-cc/f%05d.png -i score-crosschain.wav … \
  shieldedscan-crosschain.mp4

# agent film
node audio.mjs agent                               # → score-agent.wav
FILM=agent.html FRAMES_DIR=frames-agent node render.mjs
ffmpeg -y -framerate 30 -i frames-agent/f%05d.png -i score-agent.wav … \
  shieldedscan-agent.mp4
```

`FILM=crosschain.html node preview.mjs 5.4 11.5 21.2` writes stills at those
seconds into `preview/` — use it to review a change without a four-minute
render.

Needs `playwright` (already a devDependency) and any ffmpeg with libx264. The
one bundled with Playwright only has VP8 and will not do.

## How it is built

`trailer.html` is a deterministic canvas renderer exposing `__frame(i)`;
`render.mjs` drives headless Chromium one frame at a time and screenshots each.
Frames are stepped **in order** and never seeked, because the renderer keeps a
phosphor-persistence buffer — frame N is composited over a decayed frame N-1,
which is what puts trails behind fast motion. Type is the site's own
self-hosted JetBrains Mono, loaded from `public/fonts/`; the renderer waits on
`document.fonts.ready` before the first frame, or the whole film lays out in a
fallback face (the same trap `e2e/` layout assertions hit).

`audio.mjs` synthesises the score — sub kick, drone, noise risers, impacts,
terminal ticks, a small plate reverb — and writes a WAV. It is written rather
than licensed so the hits land exactly on the cut points: `SC` in `audio.mjs`
mirrors `SC` in `trailer.html`, and **the two must be edited together** or the
impacts drift off the transitions.

## What the numbers are

Every figure presented as a fact about the chain is live data read from
`https://api.shieldedscan.xyz/v1` on 2026-07-30 and pinned in `DATA` /`SERIES`
at the top of `trailer.html`:

| shown                                                             | source                                           |
| ----------------------------------------------------------------- | ------------------------------------------------ |
| height, price, 24h tx count, 36.3% fully shielded (1,581 / 4,355) | `/v1/status`                                     |
| shielded value, circulating supply, per-pool shares               | `/v1/supply`                                     |
| pools chart — 118 monthly closing balances, 2016→2026             | `/v1/analytics/monthly` (kept in `monthly.json`) |
| cross-chain ribbons, transfer count                               | `/v1/crosschain/flows`, `/health`                |

Re-run those calls and update `DATA` before a re-post; the height and price are
the two that visibly age.

### The cross-chain film

`CC` in `crosschain.html`, same date, same API:

| shown                                                                                           | source                     |
| ----------------------------------------------------------------------------------------------- | -------------------------- |
| in / out transfer counts and ZEC totals, per-chain flows, the folded tails, the coverage window | `/v1/crosschain/flows`     |
| the twelve-row transfer table, and the sixty streaks in the cold open                           | `/v1/crosschain/transfers` |

**Nothing in this film is illustrative.** The opening swarm is sixty consecutive
real crossings — `CC.swarm` is [chain, direction, ZEC] straight off the endpoint,
so the mix of chains and directions on screen is the venues' own rather than a
shape picked to look busy — and the table is twelve real crossings with their
real per-leg USD.

The open was rebuilt. It had been a **single** transfer arcing from
Zcash to TRON: accurate, and the sparsest two seconds in the film — one dot on
black at the exact moment a muted autoplay has to earn attention, in the most
conventional composition a bridge can be drawn with. Three things the rebuild
had to get right: streaks anchor on their chain's act-B orbit spoke so the swarm
_resolves into_ that field instead of cutting to an unrelated picture; the
angular jitter is wide (±0.57 rad) because two chains carry two thirds of the
rows and a tight one piled the burst onto two spokes and left half the frame
black; and only three streaks are captioned, on three different chains, since two
labels sharing a spoke land on top of each other. Captions are also bounded to
the frame — a streak may fly off the edge, its caption may not. Two rows carry a
counterpart the venue never gave a ticker for; they render as "unidentified
token" beside the chain, never as the chain's native ticker — an SPL token on
Solana is not SOL.

An act showing the shielded-capable landing split (`/v1/crosschain/destinations`)
was cut. The stat is a good one and honest — it is
`shieldedCapable`, never `shielded`, because which receiver a unified address
paid into is not public — but it stopped the film dead between the transfer list
and the API. `git` has it if it is ever wanted back.

The Sankey follows the page's own rules: **one diagram per direction, one shared
`unit`**, so the two Zcash bars are directly comparable and the gap between them
is the net — stated as `NET 383,133 ZEC OUT`, 1.31×. Drawing both through a
single centre bar would say the inbound value _became_ the outbound value, which
it did not. Both tails are folded and counted (`+ 15 MORE`, `+ 14 MORE`), never
dropped, and the fold takes the neutral slate because it is not a chain. Each
half labels itself from a shared centre column rather than from its own bar:
labelling per-bar put the two totals on top of each other in the middle.

Two things on screen are **illustration, and are kept recognisable as such**:

- The ledger rows in the opening act (act B/C) are generated hex. They stage the
  generic public-ledger model — "sender · receiver · amount · forever" — and are
  never labelled as Zcash records. No real txid, address or amount appears there.
  Their addresses are drawn from a pool of nine and therefore **repeat**, which is
  what the amber tracer needs: a curve is drawn only between two cells holding the
  identical string, and both ends are underlined so a viewer can check the claim
  by reading. An earlier version bowed curves between random rows — it looked like
  linkage without being any, which is the one thing this act must not do, since
  the point is that the inference is available to anyone. The list also stops
  scrolling before the tracer runs; linkage and motion at once read as noise.
- The veil card's `still public` column (act D) is one transaction's worth of
  public facts. Its fee is not invented: 4 logical actions × 5,000 zat is the
  ZIP-317 convention, so the two figures agree by arithmetic — and the count is
  what fixes the fee, not the pool, so naming Ironwood there changes nothing.

The curl in act F must stay **runnable**: the keys, their order and their values
are `/v1/status`'s own, and the trimmed fields are declared (`… 6 more fields`)
rather than silently dropped. An earlier cut highlighted `"keyless": true` in
that response — **`/v1/status` does not return that field**; it belongs to the
`/v1` descriptor. Anyone who ran the command would not have found it. The
highlight is now on `fullyShieldedPct24h`, which the endpoint really emits and
which carries the numerator and denominator the site's rules require. "Keyless"
survives where it is true: the chip, and the end card.

The boot lines in act A once read `peers 8`. **No endpoint publishes a peer
count**, so that figure was invented and was cut. Nothing in the film may state a
quantity that cannot be pulled from the table above; a plausible number on a surface
nobody can check is a fabricated figure.

The charts follow the rules the site holds itself to. The pools chart plots real
figures, so it may carry a scale and does. The Sankey's tail is **folded, not
dropped** (`+ 16 MORE`, 105,617 ZEC) — dropping it would silently shrink the
boundary the diagram claims to measure — and the fold takes the neutral slate,
because it is not a chain. Every percentage on screen appears with its
denominator.

## Copy

`keyless · no accounts · no trackers` on the end card is grounded in what `/v1`
publishes about itself (`keyless: true`, and the rate-limit note stating no
identity is stored).

## The chain field (cross-chain film, act B)

`chain-marks.js` is **generated** from `src/components/brand-marks.ts` and the
`.brand-*` classes in `src/app/styles/brand-marks.css` — the site's own path data and its own
lifted-for-dark brand hexes. Regenerate it rather than hand-editing, or the film
starts drawing logos the site does not.

Brand colour here does **not** contradict "charts use the flow palette, not brand
colours". That rule exists because ribbons must be told apart, and it gave the
Sankey a grey Ethereum as the largest flow on the page. The field is a wall of
logos — identification, which is the job brand colour is for — so the two acts
use different palettes on purpose, and the Sankey in act C still uses the flow
palette. Two chains share the same grey (Ethereum, NEAR) because both published
hexes are achromatic and lift to grey; distinct silhouettes carry them.

The geometry is read off the data, not chosen: orbit radius is rank by total ZEC
crossed, mark size is √volume, and the number of particles on a spoke is that
chain's share of transfers, split green (into Zcash) and amber (out). The key is
on screen — a field whose positions meant nothing would be the same class of
error as a chart with an invented axis. It holds the nine chains that have their
own mark, and says `9 of 23 chains shown` rather than implying it holds them all.

Zcash sits at the centre as a green node, **not** as ⓩ: the trademark labels ZEC
in a row (ordinary descriptive use), but wearing it as the centre of our own film
is closer to implying affiliation.

## The agent film

`agent.html`, `AG`. Four answers, escalating — a crossover, a superlative over a
period, a four-way breakdown, then the matrix — and then act F pulls back to the
console the answers came out of. `SC` is
`{ A: 0, B: 2.3, C: 6.8, D: 10.8, E: 15.1, F: 21.6, G: 25.8, END: 30.8 }` and
`audio.mjs`'s `agent` entry mirrors it — **edit the two together**.

That is not advice, it is a bug this film already caused. The `agent` cue block was
patched using an anchor (`/* the drop into the end card */`) that BOTH the trailer
and the agent arrangement contain, so the interface cues silently landed in the
**trailer's** block and altered a shipped film's score. It surfaced only as
`score-trailer.wav`'s peak moving 0.788 → 0.839 between two runs. It is fixed, and
the check that settles it is that `audio.mjs trailer` and `audio.mjs crosschain`
reproduce HEAD's peaks and a byte-identical WAV. **Rebuild all three scores after
touching this file and compare, not just the one you edited.**

**Every figure is an answer the deployed agent actually gave**, read from
`https://api.shieldedscan.xyz/agent/ask` on 2026-08-21 and pinned in `AG` with
the tool that produced it:

| shown                                       | question asked, and the tool it routed to                                                 |
| ------------------------------------------- | ----------------------------------------------------------------------------------------- |
| BTC 421,395 ZEC vs ETH ≥ $149,325,780       | "which chain sends the most zec to zcash?" → `crosschain` aggregate · in · by chain       |
| 2026-02-16, 3,896 shielded, 232 days ranked | "which day this year had the most shielding transactions?" → `chain_activity` window      |
| the Ironwood balance and its four sources   | "where did ironwood's ZEC come from?" → `explorer_insights` ironwood-inflow               |
| the pool-to-pool matrix in ZEC and USD      | "how many txns between each pool in the last week…" → `explorer_insights` ironwood-inflow |

**The questions on screen are the questions that were asked, verbatim.** A tool
description is the routing table, so a paraphrase is a routing claim nobody
verified — the failure that had the deployed agent refusing questions its own
index answered, eleven recorded times. Every phrasing drawn here was probed
against the live agent first, including the short ones written for the frame
rather than lifted from an earlier answer.

Act B shows **both** metrics on **both** cards. The finding is that they cross
over — Bitcoin leads by ZEC, Ethereum by dollars — and showing each chain only the
metric it wins would read as the other one being unknown. The `≥` stays on the
dollar figures because a crossing no venue priced is excluded rather than assumed,
so those are a floor inside the public-swap-venue floor; the ZEC totals carry no
`≥` because that leg's coverage is complete. "A floor, never a total" sits in the
subline, in the same frame as the headline.

**232, and why it is not 233.** Act C's denominator is 2026-01-01 through
2026-08-20 inclusive — year-to-date MINUS today. Today is a partial day, and
ranking a day that is not over either robs it of the crown or hands it one on
incomplete data, so the agent's window stops at the last complete day and the film
states that on screen ("today excluded, it is not over"). The figure is the agent's
own, and it was checked arithmetically rather than trusted: 2026 is not a leap
year, and Jan 1 → Aug 20 inclusive is 232 days. The lit tick is at zero-based index
46 because 2026-02-16 is the 47th day of that range — a real position, so the tick
sits where the day falls.

The count is stated **once**, on the strip's own label, with the range beside it.
An earlier cut also put "232 days ordered" in the subline, which both repeated the
number and used a second verb for one thing.

**Nothing in this film is illustrative.** There is no invented series. In
particular the 232-tick strip in act C is a **tally, uniform in height** — one
tick per day the ranking considered, with the winner's tick at its real index
(day 46). Giving the ticks varying heights would draw a daily series we do not
hold, which would be a fabricated figure; a plausible chart on a surface
nobody can check is exactly what this pipeline must not emit.

Three shape decisions worth keeping:

- **Act D holds two different quantities and keeps them apart.** The four shares
  are shares _of the current pool balance_, and the migration total
  (14,231 txns · 2,990,812 ZEC · ≈ $1.47bn) sits below a rule in its own labelled
  row. Putting them in one block would let a viewer read 93.9% as a share of the
  dollars — every number right, and the arrangement asking a question nobody
  should have to answer.
- **Act B's two bars carry the same visual weight**, because their _length_ is
  the fee. The first cut drew the transparent bar at 0.3 alpha: it is the longer
  one, and beside a bright short green bar it read as an empty track, so the
  picture said the opposite of the finding.
- **ZEC follows the site's own `formatZecBalance` rule** — whole coins at or above
  1 ZEC, real precision below it, so the 0.409442-ZEC row is not rounded to "0".
  The rounding is declared under the table rather than applied silently.

The trail rows (`looking up · explorer_insights · transaction-costs`) are the one
piece of product UI in the film, and they are our own execution — never the
model's reasoning, which is off. They name the tools the deployed agent really
called, captured from the response stream.

The agent is named **once**, plainly, on the end card: a name is an identifier,
not a character.

### Act F — the interface

The pull-back: four acts of poster-scale answers, then the box they came out of, so
a viewer knows what they are being invited to do. Every string in it is the
console's **own** copy, read out of
`features/agent/{AgentPage,AgentConsole,AgentTrail}.tsx` rather than written for the
film — a trailer that invents a product's UI is showing a product that does not
exist. That includes the lowercase meta text: `> clear`, `edit`,
`worked for 14.1s ›` and the `enter sends · …` line all go through `uiText` rather
than `microlabel`, because `microlabel` force-uppercases and this is the one act
whose whole job is that the page is recognisable on arrival.

The exchange in the panel is act B's question and the opening of the answer the
deployed agent actually gave — verbatim, bold spans included, with the final clause
elided and MARKED (`…`) rather than trimmed into a sentence it did not write.
`worked for 14.1s` is that turn's real measured duration.

**`[ send ⏎ ]` is U+23CE, not U+21B5.** The console's own comment says ↵ is absent
from the self-hosted woff2. A `fontTools` probe of
`public/fonts/JetBrainsMono-Regular.woff2` confirms it — and confirms that every
other non-ASCII glyph this film draws (`→ ▓ ≈ — · ›`) is present. Same trap this
codebase already hit with ◐: check the font file, never the character as it renders
in an editor.

The composer's border and wash breathe rather than sitting static. The brighter box
is the live one, and pointing the eye at the thing you want pressed is the whole
reason this act exists.
