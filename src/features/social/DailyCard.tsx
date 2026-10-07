import { ZATS_PER_ZEC } from "@/domain";
import {
  snapshotIsComplete,
  snapshotSharePct,
  snapshotShieldedZat,
  type SocialSnapshot,
} from "@/domain/social";
import { allocateRedactionBlocks } from "./redaction-bar";
import {
  formatCount,
  formatDeltaPct,
  formatSharePct,
  formatUsdExact,
  formatZecWhole,
} from "@/lib/format";
import { POOL_TONE } from "./pool-tone";

/**
 * A flow figure at two decimals without its own ticker: `formatZecTwo` embeds " ZEC" in every
 * call, and the flow row states the unit once, after both figures.
 */
function formatFlowAmount(zat: number): string {
  return (zat / ZATS_PER_ZEC).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export interface DailyCardProps {
  snapshot: SocialSnapshot;
}

/** Bar geometry, in SVG user units. 1440 = 1600 less the card's 80px padding either side. */
const BAR_W = 1440;
const BAR_H = 64;
const BLOCK = 12;
const GAP = 2;
const BLOCKS = Math.floor(BAR_W / (BLOCK + GAP));

/** The four pools, largest balance first — the same order the redaction bar reads in. */
function rankedPools(snapshot: SocialSnapshot) {
  return [...snapshot.pools].sort((a, b) => b.balanceZat - a.balanceZat);
}

/**
 * "29 AUG 2026 · 18:00 CEST" — the Paris time the snapshot was read at, since the daily post
 * always fires at a fixed Paris hour and that is the clock a reader following the account
 * actually keeps. `Intl` carries the tz database, so summer/winter time needs no table of
 * our own; the abbreviation comes from the same call, never hand-picked.
 */
function formatCardStamp(unixSeconds: number): string {
  const date = new Date(unixSeconds * 1000);
  // `hourCycle: "h23"`, not `hour12: false`: under `hour12: false` ICU can render local
  // midnight as "24" rather than "00" (see `src/lib/paris-day.ts`).
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Paris",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZoneName: "short",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${get("day")} ${get("month").toUpperCase()} ${get("year")} · ${get("hour")}:${get("minute")} ${get("timeZoneName")}`;
}

export function DailyCard({ snapshot }: DailyCardProps) {
  // The single completeness gate: this must call `snapshotIsComplete`, never restate part of
  // what it checks. The route only renders claimed snapshots, but anything incomplete that
  // reaches this component must fail loudly rather than publish a blank cell or a NaN.
  if (!snapshotIsComplete(snapshot)) {
    throw new Error("DailyCard rendered from an incomplete snapshot");
  }
  const shielded = snapshotShieldedZat(snapshot);
  // Non-null assertions, not a second decision: `snapshotIsComplete` just guaranteed every
  // one of these, so there is nothing left to check, only to unwrap.
  const share = snapshotSharePct(snapshot)!;
  const priceUsd = snapshot.priceUsd!;
  const priceChange24hPct = snapshot.priceChange24hPct!;
  const flow24h = snapshot.flow24h!;
  const ranked = rankedPools(snapshot);
  const closes = snapshot.recentCloses.map((c) => c.usd);
  const lo = Math.min(...closes);
  const hi = Math.max(...closes);

  return (
    // `data-social-card` is the X poster's screenshot hook: it captures this element, never
    // the viewport, because the page around it carries the site's nav, footer and banner.
    <div className="card-daily" data-social-card>
      <header className="flex items-center justify-between">
        <span className="text-[26px] font-bold text-green">
          ./shieldedscan
          <i aria-hidden className="cursor-block logo-cursor ml-1" />
        </span>
        <span className="microlabel text-[19px] text-ink-dim">
          {formatCardStamp(snapshot.readAtUnix)}
        </span>
      </header>
      <div className="h-px bg-edge-faint" />

      <section className="flex items-end justify-between">
        <div className="flex items-end gap-10">
          <div>
            <p className="microlabel text-[19px] text-ink-dim">ZEC / USD</p>
            <p className="crt-digit card-price">{formatUsdExact(priceUsd)}</p>
          </div>
          <div className="pb-2.5">
            {priceChange24hPct === 0 ? (
              <p className="text-[40px] font-bold text-ink-faint">unchanged</p>
            ) : (
              <p
                className={`text-[40px] font-bold ${priceChange24hPct > 0 ? "text-green" : "text-red"}`}
              >
                {priceChange24hPct > 0 ? "▲" : "▼"} {formatDeltaPct(priceChange24hPct)}
              </p>
            )}
            <p className="microlabel text-[19px] text-ink-dim">24 HOURS</p>
          </div>
        </div>
        <div className="pb-2.5 text-right">
          <Sparkline closes={closes} />
          {/* The label follows the data, not the query's limit: `snapshotIsComplete` requires
              only two closes, so the range can genuinely be shorter than 30 days. */}
          <p className="microlabel text-[19px] text-ink-dim">
            {snapshot.recentCloses.length} DAY{snapshot.recentCloses.length === 1 ? "" : "S"} ·{" "}
            {formatUsdExact(lo)} – {formatUsdExact(hi)}
          </p>
        </div>
      </section>

      <SupplyBar pools={snapshot.pools} sharePct={share} />
      <div className="flex items-baseline justify-between">
        <span className="microlabel text-[19px] text-green">
          SHIELDED {formatSharePct(share, 2)}
        </span>
        <span className="microlabel text-[19px] text-ink-dim">
          TRANSPARENT {formatSharePct(100 - share, 2)}
        </span>
      </div>
      {/* The one stated denominator: a percentage never appears on this site without one,
          and "of what" is the fact a bare "28.65%" cannot carry on its own. */}
      <p className="text-center text-[13px] text-ink-faint">share of circulating supply</p>

      <section className="grid grid-cols-4 gap-6">
        {ranked.map((p) => (
          <div key={p.pool}>
            <p className={`microlabel text-[19px] ${POOL_TONE[p.pool]}`}>{p.pool}</p>
            <p className="card-figure">{formatZecWhole(p.balanceZat)}</p>
            <p className="microlabel text-[19px] text-ink-faint">
              {formatSharePct((p.balanceZat / shielded) * 100)} OF SHIELDED
            </p>
          </div>
        ))}
      </section>

      {/* A state is shielded/transparent; a flow is shielding/unshielding.

          A label and the figure it names are one atom, wrapped in `.card-flow-pair`, and the gap
          between atoms is wider than the gap inside one, so the row reads as two pairs rather
          than six loose items. The grouping lives in the markup, not a per-item margin. */}
      <section className="card-flow">
        <span className="microlabel text-[19px] text-ink-dim">LAST 24H</span>
        <span className="card-flow-pair">
          <span className="microlabel text-[19px] text-green">SHIELDING</span>
          <span className="text-[34px] text-green tabular-nums">
            +{formatFlowAmount(flow24h.shieldedZat)}
          </span>
        </span>
        <span className="card-flow-pair">
          <span className="microlabel text-[19px] text-ink-dim">UNSHIELDING</span>
          <span className="text-[34px] text-ink-dim tabular-nums">
            -{formatFlowAmount(flow24h.unshieldedZat)}
          </span>
        </span>
        <span className="microlabel text-[19px] text-ink-faint">ZEC</span>
      </section>

      <footer className="flex items-baseline justify-between">
        <span className="microlabel text-[19px] text-ink-faint">
          READ AT BLOCK {formatCount(snapshot.readAtHeight)}
        </span>
        <span className="text-[22px] text-ink-dim">shieldedscan.xyz</span>
      </footer>
    </div>
  );
}

/**
 * The signature: circulating supply as a row of blocks, the shielded part drawn in the
 * site's redaction grammar and split by pool, the transparent remainder left as an open,
 * hairline-hatched track. Nothing here is redacted because nothing here is hidden — it is
 * the shape of that grammar borrowed to state a public share, not an application of it.
 *
 * SVG `<rect>`s, not styled `<div>`s: a runtime-computed width is an SVG attribute rather
 * than an inline style prop, which the project-wide ban on those requires and which
 * `SupplyBreakdownPanel`'s own share bars already do.
 */
function SupplyBar({ pools, sharePct }: { pools: SocialSnapshot["pools"]; sharePct: number }) {
  // Clamped at both ends: at least one block so a real-but-tiny share is never drawn
  // identically to zero (the rule `SourceRow`'s own bars already follow), and never more
  // than the track holds — `sharePct` is a measurement, not a value this component controls,
  // so a data anomaly must not turn into a crash in `Array.from`'s length below.
  const lit = Math.min(BLOCKS, Math.max(1, Math.round((sharePct / 100) * BLOCKS)));
  const segments = allocateRedactionBlocks(pools, lit);
  const cells: { x: number; tone: string }[] = [];
  let i = 0;
  for (const seg of segments) {
    for (let n = 0; n < seg.blocks; n += 1, i += 1) {
      cells.push({ x: i * (BLOCK + GAP), tone: POOL_TONE[seg.pool] });
    }
  }
  return (
    <svg
      viewBox={`0 0 ${BAR_W} ${BAR_H}`}
      className="h-16 w-full"
      role="img"
      aria-label={`${sharePct.toFixed(2)}% of circulating supply is shielded`}
    >
      {Array.from({ length: BLOCKS - lit }, (_, n) => (
        <rect
          key={`open-${n}`}
          x={(lit + n) * (BLOCK + GAP)}
          y={0}
          width={BLOCK}
          height={BAR_H}
          fill="none"
          className="text-green-faint"
          stroke="currentColor"
          strokeWidth="1"
        />
      ))}
      {cells.map((c) => (
        <rect
          key={c.x}
          x={c.x}
          y={0}
          width={BLOCK}
          height={BAR_H}
          className={c.tone}
          fill="currentColor"
        />
      ))}
    </svg>
  );
}

/**
 * Settled daily closes as a bare line, with a faint fill under it. No axis, no scale, no
 * gridlines: a chart a reader cannot check must not look like a measurement, the rule
 * `HalvingScene` follows. Green rather than the chart palette's `--series`: this is a
 * sparkline riding beside the price it illustrates, not an analytics chart, and it takes
 * that price's own accent.
 */
function Sparkline({ closes }: { closes: number[] }) {
  const w = 380;
  const h = 96;
  const lo = Math.min(...closes);
  const span = Math.max(...closes) - lo || 1;
  const points = closes.map((v, i): [number, number] => [
    (i / Math.max(1, closes.length - 1)) * w,
    h - ((v - lo) / span) * h,
  ]);
  const line = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const firstPoint = points[0];
  const lastPoint = points[points.length - 1];
  const area =
    firstPoint && lastPoint
      ? `${firstPoint[0].toFixed(1)},${h} ${line} ${lastPoint[0].toFixed(1)},${h}`
      : line;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" className="ml-auto">
      <polygon points={area} className="text-green/15" fill="currentColor" stroke="none" />
      <polyline
        points={line}
        fill="none"
        className="text-green"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
