import type { CrossChainDirection, CrossChainFlow } from "@/domain";
import { foldFlows } from "@/domain";
import { chainName } from "@/lib/chains";
import { flowPaletteClass } from "@/lib/flow-palette";
import { formatZecCompact } from "@/lib/format";

export interface CrossChainSankeyProps {
  flows: CrossChainFlow[];
  direction: CrossChainDirection;
  /**
   * Zatoshis per user unit of height, computed once by the caller from both directions so the
   * two diagrams share a ruler. Deriving it per diagram would leave each internally tidy and
   * mutually meaningless.
   */
  unit: number;
  /** How many chains get their own ribbon before the tail is folded. */
  topN?: number;
}

/**
 * One direction of ZEC crossing the Zcash boundary, as a Sankey.
 *
 * One direction per diagram: a Sankey's grammar is conservation — what enters a node leaves
 * it — so a shared centre bar with ribbons in on one side and out on the other would read as
 * the same value passing through. Inbound and outbound transfers are unrelated events, and
 * their totals need not match. Split, each diagram states only what is true. Both are drawn at
 * the same `unit`, so the Zcash bars are directly comparable and the gap between them is the
 * net flow.
 *
 * `MIN_RIBBON` is a rendering floor for the long tail, so no chain is silently dropped from a
 * diagram that claims to show them. A floor, not a scale; the table beneath carries every
 * exact figure.
 *
 * Colour comes from the flow palette, not the chains' brand colours — see
 * `lib/flow-palette.ts`. It arrives through `currentColor`, so the gradient stop resolves
 * against the token layer, which is why the gradient sits inside its coloured group.
 *
 * Hand-rolled SVG: no chart library, per the stack rules.
 */

const W = 1000;
const PAD_Y = 18;
/** Width of the chain column — the label block, full-bleed to the outer edge. */
const COL = 268;
/** The coloured spine at a chain row's outer edge. */
const SPINE = 4;
/** Width of the Zcash bar. Wider than a spine: it is a node, and carries a label. */
const ZBAR = 12;
const MIN_RIBBON = 3;
/** Vertical room a chain row needs for its name and figure. */
const MIN_ROW = 40;
const ROW_GAP = 2;

interface Row {
  key: string;
  label: string;
  chain: string;
  zat: number;
}

interface Band {
  row: Row;
  /** Contiguous position against the Zcash bar — the truthful, proportional side. */
  zY0: number;
  zY1: number;
  /** The chain row: full height, holds the label. */
  rowY0: number;
  rowY1: number;
  /** Where the ribbon meets the chain — same thickness, centred in the row. */
  nodeY0: number;
  nodeY1: number;
}

function ribbon(
  xFrom: number,
  xTo: number,
  from: { y0: number; y1: number },
  to: { y0: number; y1: number },
): string {
  const cx = (xFrom + xTo) / 2;
  return [
    `M${xFrom},${from.y0}`,
    `C${cx},${from.y0} ${cx},${to.y0} ${xTo},${to.y0}`,
    `L${xTo},${to.y1}`,
    `C${cx},${to.y1} ${cx},${from.y1} ${xFrom},${from.y1}`,
    "Z",
  ].join(" ");
}

export function CrossChainSankey({ flows, direction, unit, topN = 7 }: CrossChainSankeyProps) {
  const folded = foldFlows(flows, direction, topN);
  const rows: Row[] = [
    ...folded.top.map((r) => ({
      key: `${direction}-${r.chain}`,
      label: chainName(r.chain),
      chain: r.chain,
      zat: r.zecAmountZat,
    })),
    ...(folded.otherChains > 0
      ? [
          {
            key: `${direction}-other`,
            label: `${folded.otherChains} more chains`,
            chain: "UNKNOWN",
            zat: folded.otherZat,
          },
        ]
      : []),
  ];
  if (rows.length === 0) return null;

  const inbound = direction === "in";
  const thickness = rows.map((r) => Math.max(MIN_RIBBON, r.zat * unit));
  const total = thickness.reduce((a, b) => a + b, 0);

  // Rows are floored at MIN_ROW so a name fits; the ribbon keeps its true thickness inside
  // the row. Only position is adjusted, never width — width is the diagram's only claim.
  const rowH = thickness.map((t) => Math.max(MIN_ROW, t));
  const rowsH = rowH.reduce((a, b) => a + b, 0) + ROW_GAP * (rows.length - 1);

  // As tall as whichever side needs more: the label column, or the Zcash bar — whose height
  // IS this direction's total at the shared scale, and therefore the comparison itself.
  const H = Math.max(rowsH, total) + PAD_Y * 2;

  const zTop = PAD_Y + (H - PAD_Y * 2 - total) / 2;
  let zy = zTop;
  const zSlots = thickness.map((t) => {
    const slot = { y0: zy, y1: zy + t };
    zy += t;
    return slot;
  });

  let ry = PAD_Y + (H - PAD_Y * 2 - rowsH) / 2;
  const bands: Band[] = rows.map((row, i) => {
    const h = rowH[i]!;
    const t = thickness[i]!;
    const centre = ry + h / 2;
    const band: Band = {
      row,
      zY0: zSlots[i]!.y0,
      zY1: zSlots[i]!.y1,
      rowY0: ry,
      rowY1: ry + h,
      nodeY0: centre - t / 2,
      nodeY1: centre + t / 2,
    };
    ry += h + ROW_GAP;
    return band;
  });

  // Chains outside, Zcash inside: inbound reads left-to-right into Zcash, outbound
  // left-to-right out of it. Stacked, the two read as one continuous narrative.
  const colX = inbound ? 0 : W - COL;
  const spineX = inbound ? 0 : W - SPINE;
  const chainX = inbound ? COL : W - COL;
  const zX = inbound ? W - ZBAR - 96 : 96;
  const zInner = inbound ? zX : zX + ZBAR;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-auto w-full"
      role="img"
      aria-label={
        inbound
          ? `ZEC arriving on Zcash from ${rows.length} sources.`
          : `ZEC leaving Zcash to ${rows.length} destinations.`
      }
    >
      {bands.map((b) => {
        const gid = `sk-${b.row.key}`;
        return (
          <g key={b.row.key} className={`sankey-flow ${flowPaletteClass(b.row.chain)}`}>
            <linearGradient id={gid} x1="0" x2="1" y1="0" y2="0">
              <stop offset="0%" stopColor="currentColor" stopOpacity={inbound ? 0.95 : 0.2} />
              <stop offset="55%" stopColor="currentColor" stopOpacity={inbound ? 0.62 : 0.44} />
              <stop offset="100%" stopColor="currentColor" stopOpacity={inbound ? 0.2 : 0.95} />
            </linearGradient>

            <path
              d={ribbon(
                inbound ? chainX : zInner,
                inbound ? zInner : chainX,
                inbound ? { y0: b.nodeY0, y1: b.nodeY1 } : { y0: b.zY0, y1: b.zY1 },
                inbound ? { y0: b.zY0, y1: b.zY1 } : { y0: b.nodeY0, y1: b.nodeY1 },
              )}
              fill={`url(#${gid})`}
              className="sankey-ribbon"
            />

            <rect
              x={spineX}
              y={b.rowY0}
              width={SPINE}
              height={b.rowY1 - b.rowY0}
              fill="currentColor"
            />
            <line x1={colX} x2={colX + COL} y1={b.rowY1} y2={b.rowY1} className="sankey-rule" />
            <text
              x={inbound ? SPINE + 16 : W - COL + 16}
              y={(b.rowY0 + b.rowY1) / 2}
              dominantBaseline="middle"
              className="sankey-name"
            >
              {b.row.label}
            </text>
            <text
              x={inbound ? COL - 16 : W - SPINE - 16}
              y={(b.rowY0 + b.rowY1) / 2}
              textAnchor="end"
              dominantBaseline="middle"
              className="sankey-value"
            >
              {formatZecCompact(b.row.zat)}
            </text>
          </g>
        );
      })}

      {/* Zcash. Its height is this direction's total at the shared scale, so comparing this
          bar with the other diagram's IS the comparison — no third number needed. */}
      <rect x={zX} y={zTop} width={ZBAR} height={total} rx={2} className="sankey-zcash" />
      <text
        x={inbound ? zX + ZBAR + 14 : zX - 14}
        y={zTop + total / 2}
        textAnchor={inbound ? "start" : "end"}
        dominantBaseline="middle"
        className="sankey-zcash-label"
      >
        ZCASH
      </text>
    </svg>
  );
}
