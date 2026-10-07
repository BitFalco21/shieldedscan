import {
  boundaryAmountZat,
  boundaryDirection,
  boundaryIsComplete,
  boundaryPoolLabel,
  boundaryPoolsRanked,
  boundaryUsdValue,
  formatBoundaryUsd,
  formatBoundaryZec,
  poolTitle,
  type BoundaryFigures,
} from "@/domain/boundary";
import { SHIELD, SHIELD_LEFT } from "@/components/PrivacyShield";
import { formatCount, formatUsdExact } from "@/lib/format";
import { poolToneAttr } from "./pool-tone";
import { elideCardTxid, formatCardDate } from "./card-format";

export interface BoundaryCardProps {
  figures: BoundaryFigures;
}

/**
 * Strip geometry, in SVG user units. 1456 = 1600 less the card's 72px padding either
 * side, and 104 blocks of 12 with a 2 gap fill it exactly.
 */
const STRIP_W = 1456;
const STRIP_H = 64;
const BLOCK = 12;
const GAP = 2;
const BLOCKS = Math.floor((STRIP_W + GAP) / (BLOCK + GAP));

/** Smoothstep, so the change of state reads as a transition rather than a hard seam. */
function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * The boundary strip: blocks ramping from plain outline to lit redaction, left to right in
 * the direction the value travelled.
 *
 * It measures nothing and carries no scale: a split point would read as a proportion, and a
 * plausible-looking chart nobody can check would be a fabricated figure. It shows a change of
 * state.
 *
 * Two groups cross-fade rather than one ramp, because the colour travels from neutral ink to
 * the pool's green: each group takes one token colour from its class, and only the per-rect
 * opacity varies, as an SVG attribute rather than an inline style.
 */
function BoundaryStrip({ outward, tone }: { outward: boolean; tone: string }) {
  const plain: number[] = [];
  const lit: number[] = [];
  for (let i = 0; i < BLOCKS; i += 1) {
    const t = smooth(outward ? 1 - i / (BLOCKS - 1) : i / (BLOCKS - 1));
    plain.push(1 - t);
    lit.push(t);
  }
  const rects = (opacities: number[]) =>
    opacities.map((o, i) => (
      <rect
        key={i}
        x={i * (BLOCK + GAP)}
        y={0}
        width={BLOCK}
        height={STRIP_H}
        rx={2}
        fill="currentColor"
        fillOpacity={Number(o.toFixed(3))}
      />
    ));

  return (
    <svg
      aria-hidden
      width={STRIP_W}
      height={STRIP_H}
      viewBox={`0 0 ${STRIP_W} ${STRIP_H}`}
      className={`block ${tone}`}
    >
      <g className="card-boundary-plain">{rects(plain)}</g>
      <g className="card-boundary-lit">{rects(lit)}</g>
    </svg>
  );
}

/** The pool end of the strip: the name, and each pool's own amount when several moved. */
function PoolEnd({ figures }: { figures: BoundaryFigures }) {
  const ranked = boundaryPoolsRanked(figures);
  return (
    <span className="flex flex-col gap-1.5">
      <span className="card-boundary-pool" data-tone={poolToneAttr(ranked[0]!.pool)}>
        {boundaryPoolLabel(figures)}
      </span>
      {ranked.length > 1 && (
        <span className="text-[19px] text-ink-dim tabular-nums">
          {ranked.map((p, i) => (
            <span key={p.pool}>
              {i > 0 && " · "}
              <span className="microlabel text-[19px] text-green-dim">
                {poolTitle(p.pool)}
              </span>{" "}
              {formatBoundaryZec(p.valueBalanceZat)} ZEC
            </span>
          ))}
        </span>
      )}
    </span>
  );
}

export function BoundaryCard({ figures }: BoundaryCardProps) {
  // The single completeness gate, calling the shared predicate rather than re-deriving a
  // subset of it, as `DailyCard` and `SwapCard` do.
  if (!boundaryIsComplete(figures)) {
    throw new Error("BoundaryCard rendered from an incomplete crossing");
  }
  // Non-null assertions, not second decisions: `boundaryIsComplete` just guaranteed both.
  const direction = boundaryDirection(figures)!;
  const usd = boundaryUsdValue(figures)!;
  const shielding = direction === "shielding";
  const ranked = boundaryPoolsRanked(figures);
  const tone = poolToneAttr(ranked[0]!.pool);
  const stripTone =
    tone === "dim" ? "text-green-dim" : tone === "faint" ? "text-ink-faint" : "text-green";

  return (
    // `data-social-card` is the X poster's screenshot hook: it captures this element, never
    // the viewport, because the page around it carries the site's nav, footer and banner.
    <div className="card-boundary" data-social-card>
      <header className="flex items-baseline justify-between">
        <span className="text-[26px] font-bold text-green">
          ./shieldedscan
          <i aria-hidden className="cursor-block logo-cursor ml-1" />
        </span>
        <span className="microlabel text-[19px]">{formatCardDate(figures.timestamp)}</span>
      </header>

      <div className="flex items-center gap-7">
        {/* The `mixed` shield on both cards: a crossing has a transparent side and a shielded
            one, so the word and the strip carry the direction, never the mark. */}
        <svg aria-hidden width={62} height={62} viewBox="0 0 24 24">
          <path
            d={SHIELD}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.3}
            className={shielding ? "text-green" : "text-ink-dim"}
          />
          <path
            d={SHIELD_LEFT}
            fill="currentColor"
            className={shielding ? "text-green" : "text-ink-dim"}
          />
        </svg>
        <span className="card-boundary-word" data-dir={direction}>
          {shielding ? "SHIELDING" : "UNSHIELDING"}
        </span>
      </div>

      <div
        className="flex flex-col gap-3.5"
        role="group"
        aria-label={`${formatBoundaryZec(boundaryAmountZat(figures))} ZEC ${
          shielding ? "shielded into" : "unshielded from"
        } the ${boundaryPoolLabel(figures)}`}
      >
        <div className="flex items-baseline gap-6">
          <span className="card-boundary-figure" data-dir={direction}>
            {formatBoundaryZec(boundaryAmountZat(figures))}
          </span>
          <span className="text-[34px] tracking-[0.18em] text-ink-dim">ZEC</span>
        </div>
        <div className="flex items-baseline gap-5">
          <span className="card-boundary-usd">{formatBoundaryUsd(usd)}</span>
          {/* The rate travels with the figure, so the card states what it was worth then
              rather than implying what it is worth whenever it is next screenshotted. */}
          <span className="microlabel text-[19px] text-ink-faint">
            at {formatUsdExact(figures.priceUsd!)} / ZEC
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <BoundaryStrip outward={!shielding} tone={stripTone} />
        <div className="flex items-start justify-between">
          {shielding ? (
            <>
              <span className="card-boundary-transparent">Transparent</span>
              <PoolEnd figures={figures} />
            </>
          ) : (
            <>
              <PoolEnd figures={figures} />
              <span className="card-boundary-transparent">Transparent</span>
            </>
          )}
        </div>
      </div>

      <footer className="flex items-baseline justify-between">
        <span className="text-[20px] text-ink-faint">
          {elideCardTxid(figures.txid)} · BLOCK {formatCount(figures.blockHeight)}
        </span>
        <span className="text-[22px] text-green-dim">shieldedscan.xyz</span>
      </footer>
    </div>
  );
}
