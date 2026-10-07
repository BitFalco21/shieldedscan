import type { RefObject } from "react";
import type { PulseLedgerRow } from "@/domain";
import { addressLabel } from "@/domain";
import { brandMark, canonicalMarkTicker } from "@/components/brand-marks";
import { formatCount, formatZecAmount, formatZecWhole, shortHash } from "@/lib/format";
import { seededRandom } from "@/lib/seeded-random";
import {
  PULSE_VIEW_H,
  PULSE_VIEW_W,
  type PulseBoxLayout,
  type PulseChainLayout,
  type PulseEdgeLayout,
  type PulseLayout,
} from "./pulse-layout";

/**
 * The stage: what each pool holds, what has crossed between them, and the layers the motion
 * engine draws into.
 *
 * Every figure here is a measurement, and every caveat rides in a `<title>` on the thing it
 * qualifies rather than in a legend. Two structural refusals to overclaim:
 *
 *  - Ribbons stop short of every box. `pulse-layout` pulls each endpoint away from the edge it
 *    points at, so nothing reads as a budget that balances: a stock and a flow are on two
 *    rulers.
 *  - Interiors are what the chain publishes. The transparent box lists real recent outputs; a
 *    shielded pool is redaction because a pool publishes its total and nothing else; the lockbox
 *    is hatched because consensus holds it and no transaction spends it. The cipher glyphs
 *    contain no digits, so a shielded interior never flashes something that reads as an amount.
 */

export interface PulseDiagramProps {
  layout: PulseLayout;
  /** Real recent transparent outputs, drawn as the ledger box's own rows. */
  ledger: readonly PulseLedgerRow[];
  /**
   * Printed inside the ledger box in place of rows when there are none to show honestly — e.g.
   * in replay, where the live rows would be today's outputs under a clock set in the past.
   */
  ledgerNote?: string;
  svgRef?: RefObject<SVGSVGElement | null>;
  pulseLayerRef?: RefObject<SVGGElement | null>;
  pendingLayerRef?: RefObject<SVGGElement | null>;
}

/** An id fragment a `url(#…)` reference can carry. */
const idOf = (key: string): string => key.replace(/[^A-Za-z0-9_-]/g, "-");

const seedOf = (text: string): number => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

/** No digits: a shielded interior must never flash something that reads as an amount. */
const CIPHER = "ΞΨΩλφψχ∂∑∏√∞≡⊕⊗⋈∴◊†‡§¶";

function poolCaveat(box: PulseBoxLayout): string {
  const parts: string[] = [box.label];
  if (box.absent) {
    parts.push("balance unavailable at this block — not zero");
  } else if (box.balanceZat !== null) {
    parts.push(`${formatZecAmount(box.balanceZat)} ZEC`);
  }
  if (box.floored && box.balanceZat !== null) {
    parts.push(`drawn at minimum · true ${formatZecWhole(box.balanceZat)}`);
  }
  if (box.key === "sprout")
    parts.push("public values from JoinSplit vpub · a different measurement");
  if (box.key === "lockbox") parts.push("held by consensus · no transaction spends it");
  if (box.key === "mined") parts.push("issuance · a source, not a stock");
  if (box.kind === "pool") parts.push("the total is public · everything inside it is not");
  return parts.join(" · ");
}

function edgeTitle(edge: PulseEdgeLayout, windowLabel: string): string {
  const parts = [`${edge.from} → ${edge.to}`];
  if (edge.totalZat === null) {
    parts.push("totals unavailable — this width is a placeholder, not a measurement");
  } else {
    parts.push(
      `${formatZecWhole(edge.totalZat)} gross · ${edge.events} movements · ${windowLabel}`,
    );
    if (edge.floored) parts.push(`drawn at minimum · true ${formatZecWhole(edge.totalZat)}`);
  }
  if (edge.venueFloor) parts.push("public venues only");
  if (edge.vpubDerived) parts.push("vpub-derived · a different measurement");
  return parts.join(" · ");
}

function LedgerRows({ box, rows }: { box: PulseBoxLayout; rows: readonly PulseLedgerRow[] }) {
  // Below this the rows would be unreadable, so the box shows its label and nothing else — an
  // illegible row is worse than an empty interior, because it looks like data.
  if (box.w < 150 || box.h < 110 || rows.length === 0) return null;
  const rowHeight = 13;
  const colWidth = 158;
  const top = box.y + 74;
  const columns = Math.max(1, Math.floor((box.w - 16) / colWidth));
  const perColumn = Math.max(0, Math.floor((box.y + box.h - 6 - top) / rowHeight));
  const drawn = rows.slice(0, columns * perColumn);
  return (
    <g clipPath={`url(#pulse-clip-${idOf(box.key)})`}>
      {drawn.map((row, i) => {
        const label = addressLabel(row.address);
        const column = Math.floor(i / perColumn);
        const y = top + (i % perColumn) * rowHeight;
        return (
          <a key={`${row.txid}-${i}`} href={`/tx/${row.txid}`} className="pulse-ledger-row">
            <title>{`${label ? `${label.name} · ` : ""}${row.address} · ${formatZecAmount(row.valueZat)} ZEC · block ${formatCount(row.height)}`}</title>
            <text x={box.x + 10 + column * colWidth} y={y}>
              {`${label ? label.name.slice(0, 11) : shortHash(row.address, 4)}  ${formatZecAmount(row.valueZat)}`}
            </text>
          </a>
        );
      })}
    </g>
  );
}

function RedactionRows({ box }: { box: PulseBoxLayout }) {
  // Seeded, so the server's redaction and the client's are the same pixels. The texture is not data.
  const draw = seededRandom(seedOf(box.key));
  const big = box.h >= 130;
  const mid = box.h >= 40;
  const rowHeight = big ? 12 : mid ? 9 : Math.max(5, box.h / 3);
  const barHeight = big ? 7 : mid ? 5 : Math.max(3, rowHeight * 0.55);
  const inset = big ? 10 : 3;
  const left = box.x + inset;
  const right = box.x + box.w - inset;
  const nodes: React.ReactNode[] = [];
  let key = 0;
  for (let y = box.y + inset; y < box.y + box.h - 3; y += rowHeight) {
    let x = left;
    while (x < right - 8) {
      if (big && draw() < 0.22) {
        const glyphs = 3 + Math.floor(draw() * 3);
        let text = "";
        for (let i = 0; i < glyphs; i += 1) text += CIPHER[Math.floor(draw() * CIPHER.length)];
        nodes.push(
          <text key={key++} x={x} y={y + barHeight} className="pulse-cipher">
            {text}
          </text>,
        );
        x += 34;
        continue;
      }
      const width = Math.min(right - x, 18 + draw() * (big ? 110 : right - x));
      nodes.push(
        <rect
          key={key++}
          x={x}
          y={y}
          width={width}
          height={barHeight}
          rx={1}
          className="pulse-rbar"
        />,
      );
      x += width + (big ? 8 : 3);
    }
  }
  return <g clipPath={`url(#pulse-clip-${idOf(box.key)})`}>{nodes}</g>;
}

function HatchRows({ box }: { box: PulseBoxLayout }) {
  const lines: React.ReactNode[] = [];
  for (let d = -box.h; d < box.w; d += 5) {
    lines.push(
      <line
        key={d}
        x1={box.x + d}
        y1={box.y + box.h}
        x2={box.x + d + box.h}
        y2={box.y}
        className="pulse-hatch"
      />,
    );
  }
  return <g clipPath={`url(#pulse-clip-${idOf(box.key)})`}>{lines}</g>;
}

function ChainNode({ chain }: { chain: PulseChainLayout }) {
  const mark = chain.folded ? null : brandMark(chain.ticker);
  const canonical = chain.folded ? null : canonicalMarkTicker(chain.ticker);
  const size = 22;
  const viewSize = mark ? Number(mark.viewBox.split(/\s+/)[2] ?? 24) : 24;
  const scale = size / viewSize;
  return (
    <g className={chain.colorClass}>
      <title>
        {chain.folded
          ? `${chain.foldedCount} more chains · folded · public venues only`
          : `${chain.ticker} ↔ zcash · swaps through the venues this site indexes · public venues only`}
      </title>
      <circle
        cx={chain.cx}
        cy={chain.cy}
        r={chain.r}
        className="pulse-chain"
        data-box={chain.node ?? chain.key}
      />
      {mark ? (
        // The chain's real mark, in its brand colour: a logo beside a name is an
        // identification, and the flow palette is for telling ribbons apart.
        <g
          transform={`translate(${chain.cx - size / 2} ${chain.cy - size / 2}) scale(${scale})`}
          className={canonical ? `brand-${canonical.toLowerCase()}` : undefined}
        >
          <path
            d={mark.d}
            fill="currentColor"
            fillRule={mark.fillRule}
            transform={mark.transform}
          />
        </g>
      ) : (
        // An honest initial beats a wrong logo, and the fold is not a chain at all.
        <text x={chain.cx} y={chain.cy + 4} className="pulse-chain-mark" textAnchor="middle">
          {chain.folded ? chain.ticker : chain.ticker.slice(0, 4)}
        </text>
      )}
      <text
        x={chain.cx - chain.r - 12}
        y={chain.sub === "" ? chain.cy + 4 : chain.cy - 1}
        className="pulse-chain-label"
      >
        {chain.folded ? "others" : chain.label}
      </text>
      {chain.sub === "" ? null : (
        <text x={chain.cx - chain.r - 12} y={chain.cy + 11} className="pulse-chain-sub">
          {chain.sub}
        </text>
      )}
    </g>
  );
}

/**
 * What a box prints where its figure goes, or null when there is nothing to print.
 *
 * Three states, which is why this is a branch and not `balanceZat ?? 0`: a read balance prints
 * itself; one that should exist and was not read prints `unavailable` (`absent`); `mined` has no
 * stock by construction and prints nothing. `?? 0` would report an unread pool as empty.
 */
function boxValueText(box: PulseBoxLayout): string | null {
  if (box.balanceZat !== null) return formatZecWhole(box.balanceZat);
  return box.absent ? "unavailable" : null;
}

function Box({
  box,
  ledger,
  ledgerNote,
}: {
  box: PulseBoxLayout;
  ledger: readonly PulseLedgerRow[];
  ledgerNote?: string;
}) {
  const pool = box.kind === "pool";
  // An absent box is drawn at a size that carries no label: its figures go beside it, the
  // way the lockbox's do, rather than spilling out of an outline they no longer fit inside.
  const inside = (box.kind === "ledger" || box.kind === "mined") && !box.absent;
  // Joined from an array, never a template literal with a conditional fragment: the Tailwind
  // formatter trims the leading space inside one, and `pulse-boxis-floored` matches no rule — an
  // SVG path without `fill: none` then paints its closing chord solid black.
  const classes = [
    "pulse-box",
    box.kind === "ledger" ? "is-glass" : "",
    pool ? "is-sealed" : "",
    box.absent ? "is-absent" : "",
    box.floored ? "is-floored" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <g className={box.colorClass}>
      <clipPath id={`pulse-clip-${idOf(box.key)}`}>
        <rect
          x={box.x + 1}
          y={box.y + 1}
          width={Math.max(0, box.w - 2)}
          height={Math.max(0, box.h - 2)}
          rx={2}
        />
      </clipPath>
      <rect
        x={box.x}
        y={box.y}
        width={box.w}
        height={box.h}
        rx={3}
        className={classes}
        data-box={box.key}
        strokeDasharray={box.kind === "mined" || box.floored || box.absent ? "4 3" : undefined}
      >
        <title>{poolCaveat(box)}</title>
      </rect>
      {box.absent ? null : box.kind === "ledger" ? (
        ledgerNote !== undefined && ledger.length === 0 ? (
          <text x={box.x + 10} y={box.y + 74} className="pulse-box-sub">
            {ledgerNote}
          </text>
        ) : (
          <LedgerRows box={box} rows={ledger} />
        )
      ) : box.kind === "lockbox" ? (
        <HatchRows box={box} />
      ) : pool ? (
        <RedactionRows box={box} />
      ) : null}

      {pool ? (
        // Above the box, left-aligned to it: the right side belongs to the migration ribbons.
        <g>
          <text x={box.x} y={box.y - 34} className="pulse-box-label">
            {box.label}
          </text>
          <text x={box.x} y={box.y - 19} className="pulse-box-value">
            {boxValueText(box)}
          </text>
          <text x={box.x} y={box.y - 6} className="pulse-box-sub">
            {box.sub}
          </text>
        </g>
      ) : inside ? (
        <g>
          <rect
            x={box.x + 4}
            y={box.y + 4}
            width={Math.min(176, Math.max(0, box.w - 8))}
            height={box.kind === "mined" ? 34 : 62}
            rx={2}
            className="pulse-label-bed"
          />
          <text x={box.x + 10} y={box.y + 18} className="pulse-box-label">
            {box.label}
          </text>
          {boxValueText(box) !== null ? (
            <text x={box.x + 10} y={box.y + 36} className="pulse-box-value">
              {boxValueText(box)}
            </text>
          ) : null}
          <text
            x={box.x + 10}
            y={box.y + (boxValueText(box) !== null ? 52 : 32)}
            className="pulse-box-sub"
          >
            {box.sub}
          </text>
        </g>
      ) : (
        <g>
          <text x={box.x + box.w + 12} y={box.y + 10} className="pulse-box-label">
            {box.label}
          </text>
          <text x={box.x + box.w + 12} y={box.y + 25} className="pulse-box-value">
            {boxValueText(box)}
          </text>
          <text x={box.x + box.w + 12} y={box.y + 39} className="pulse-box-sub">
            {box.sub}
          </text>
        </g>
      )}
    </g>
  );
}

export function PulseDiagram({
  layout,
  ledger,
  svgRef,
  pulseLayerRef,
  pendingLayerRef,
  ledgerNote,
}: PulseDiagramProps) {
  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${PULSE_VIEW_W} ${PULSE_VIEW_H}`}
      role="img"
      className="pulse-stage-svg"
      aria-label="Zcash as stock and flow: other chains, the transparent ledger, the four shielded pools, and every movement between them."
    >
      {/* The two rulers are stated in the SVG's <desc>, not printed on the page or in a
          tooltip: a size on this page means nothing without its scale, and the <desc> is read
          by assistive technology and by anyone who opens the markup. */}
      <desc>{`boxes: ${layout.boxRuler} · ribbons: ${layout.ribbonRuler}`}</desc>
      <g className={layout.ribbonsAvailable ? "pulse-ribbons" : "pulse-ribbons is-unavailable"}>
        {layout.edges.map((edge) => {
          const id = `pulse-grad-${idOf(edge.key)}`;
          return (
            // A gradient per edge, data-derived and inside its own group, so a second stage on
            // one page could not collide with this one's ids.
            <g key={edge.key} className={edge.fromClass}>
              <linearGradient
                id={id}
                gradientUnits="userSpaceOnUse"
                x1={edge.p0.x}
                y1={edge.p0.y}
                x2={edge.p1.x}
                y2={edge.p1.y}
              >
                <stop offset="0" stopColor="currentColor" />
                <stop offset="1" stopColor="currentColor" className={edge.toClass} />
              </linearGradient>
              <path
                d={edge.d}
                stroke={`url(#${id})`}
                strokeWidth={edge.width}
                className={[
                  "pulse-ribbon",
                  edge.venueFloor ? "is-venue" : "",
                  edge.floored ? "is-floored" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <title>{edgeTitle(edge, layout.windowLabel)}</title>
              </path>
            </g>
          );
        })}
      </g>

      <g>
        {layout.boxes.map((box) => (
          <Box key={box.key} box={box} ledger={ledger} ledgerNote={ledgerNote} />
        ))}
        {layout.chains.map((chain) => (
          <ChainNode key={chain.key} chain={chain} />
        ))}
      </g>

      {/* The two layers the motion engine owns. Empty in the server's frame 0 by design:
          nothing moved while nobody was watching. */}
      <g ref={pendingLayerRef} className="pulse-pending-layer" aria-hidden />
      <g ref={pulseLayerRef} className="pulse-layer" aria-hidden />
    </svg>
  );
}
