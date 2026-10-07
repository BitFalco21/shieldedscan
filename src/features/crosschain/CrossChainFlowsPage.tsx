import type { ChartRange, CrossChainFlow, CrossChainFlowSummary, FlowTrend } from "@/domain";
import { CHART_RANGES, flowRowsWithPrevious, flowTotalZat, flowTrend } from "@/domain";
import { ChainLogo } from "@/components/ChainLogo";
import { CrossChainSankey } from "@/components/CrossChainSankey";
import { DataTable } from "@/components/DataTable";
import { FilterChips } from "@/components/FilterChips";
import { PageHeader } from "@/components/PageHeader";
import { Panel } from "@/components/Panel";
import { chainName } from "@/lib/chains";
import {
  formatCount,
  formatDeltaPct,
  formatUtc,
  formatZec,
  formatZecCompact,
  formatZecTwo,
} from "@/lib/format";
import { CrossChainTabs } from "./CrossChainTabs";
import { flowsHref } from "./crossChainHref";
import { balanceSentence, periodNoun, rangeLabel, windowPhrase } from "./window-copy";

export interface CrossChainFlowsPageProps {
  summary: CrossChainFlowSummary;
  range: ChartRange;
}

/**
 * One table per direction. "Ethereum out" and "Ethereum in" are never compared row to row, and
 * splitting lets each SHARE column denominate against something a reader can name: the share of
 * ZEC leaving, not of all crossings in either direction.
 */
const COLUMNS = [
  { label: "CHAIN" },
  { label: "ZEC", align: "right" as const },
  { label: "TRANSFERS", align: "right" as const },
  { label: "SHARE", align: "right" as const },
];

export function CrossChainFlowsPage({ summary, range }: CrossChainFlowsPageProps) {
  const { flows, firstAt, lastAt } = summary;
  const outZat = flowTotalZat(flows, "out");
  const inZat = flowTotalZat(flows, "in");
  const transfers = flows.reduce((s, f) => s + f.transfers, 0);
  const phrase = windowPhrase(range);

  // The trend column exists only against a previous window we fully observed. `none` is ALL,
  // where there is no previous period at all; `incomplete` is refused and explained below.
  const previousFlows = summary.previous.kind === "flows" ? summary.previous.flows : [];
  const trendLabel = summary.previous.kind === "flows" ? `VS PREV ${rangeLabel(range)}` : null;

  // One zatoshi-per-unit ruler for both diagrams. 520 units is the taller diagram's height; the
  // shorter one comes out proportionally shorter, so the two Zcash bars are directly comparable
  // and their gap is the net flow.
  const unit = 520 / Math.max(outZat, inZat, 1);

  return (
    <>
      <PageHeader eyebrow={<>BRIDGES &amp; SWAPS</>} title="Cross-Chain" />

      <CrossChainTabs active="flows" />

      <div className="mt-4">
        {/* Links, not buttons, though they look like the `RangeToggle` on /charts. That
            control windows a series already on the page; this one re-asks the question — the
            ratio, both totals, both tables and the coverage line are recomputed — which makes
            it a filter, and so a shareable URL. */}
        <FilterChips
          ariaLabel="Filter by time window"
          label="WINDOW"
          activeValue={range}
          options={CHART_RANGES.map((r) => ({
            value: r.value,
            label: r.label,
            href: flowsHref(r.value),
          }))}
        />

        {/* The finding first, the diagram second, so the chart confirms a number the reader
            already has rather than making them derive it from ribbon widths. */}
        <Panel className="mt-3">
          <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2">
            <p className="text-xl font-bold text-ink-bright">
              {balanceSentence(outZat, inZat, range)}
            </p>
            <p className="text-xs text-ink-faint">
              {formatZecCompact(outZat)} out · {formatZecCompact(inZat)} in ·{" "}
              {formatCount(transfers)} transfers · net {formatZecCompact(Math.abs(outZat - inZat))}{" "}
              {outZat >= inZat ? "out" : "in"}
            </p>
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-dim">
            Every crossing recorded at the public swap venues this explorer watches,{" "}
            {phrase === null ? "all-time" : `over ${phrase}`}. Ribbon thickness is ZEC volume on one
            shared scale, so both directions are measured by the same ruler. Chains too small to
            draw are held at a visible minimum rather than dropped, and the tail is folded into a
            single band — the table below carries every chain and its exact figure.
          </p>
        </Panel>

        {/* Two diagrams, one ruler. A shared centre bar would imply inbound value becomes
            outbound value — a Sankey reads a node as conserving what passes through it, and
            these are unrelated transfers. Split, each states only what is true, and because
            both use the same `unit` the difference between the two Zcash bars is the net
            flow. */}
        <FlowDiagram
          title="ZEC ARRIVING"
          flows={flows}
          direction="in"
          unit={unit}
          totalZat={inZat}
          empty={`No ZEC arrived through these venues ${phrase === null ? "at all" : `in ${phrase}`}.`}
        />
        <FlowDiagram
          title="ZEC LEAVING"
          flows={flows}
          direction="out"
          unit={unit}
          totalZat={outZat}
          empty={`No ZEC left through these venues ${phrase === null ? "at all" : `in ${phrase}`}.`}
        />

        <FlowTable
          title="ZEC LEAVING, BY CHAIN"
          rows={flowRowsWithPrevious(flows, previousFlows, "out")}
          directionTotalZat={outZat}
          trendLabel={trendLabel}
        />
        <FlowTable
          title="ZEC ARRIVING, BY CHAIN"
          rows={flowRowsWithPrevious(flows, previousFlows, "in")}
          directionTotalZat={inZat}
          trendLabel={trendLabel}
        />

        {/* Why the trend column is missing, said rather than left as an absence: we decline
            to divide by a period we only partly recorded. It resolves itself as the dataset
            deepens. */}
        {summary.previous.kind === "incomplete" && summary.previous.recordsBeginAt > 0 ? (
          <p className="mt-3 px-1 text-xs text-ink-faint">
            No per-chain comparison at this range: it would be measured against the preceding{" "}
            {periodNoun(range) ?? "period"}, and these records only begin{" "}
            {formatUtc(summary.previous.recordsBeginAt)} — so that earlier period is only partly
            covered, and any change would report when this explorer started watching rather than
            what Zcash did. Shorter ranges carry the comparison.
          </p>
        ) : null}

        <Panel className="mt-3 text-sm leading-relaxed text-ink-dim">
          <p>
            <span className="text-ink">Public swap venues only, so the real total is higher.</span>{" "}
            Those are Maya Protocol, THORChain and NEAR Intents. Custodial routes leave no public
            per-transfer record: an exchange withdrawal or a Binance-peg mint is a real crossing
            that no venue publishes, so none of it is here. Aggregators are excluded too, because
            they settle on these same venues and counting them would double every figure.
          </p>
          <p className="mt-3">
            Wrapped ZEC counts as a crossing. Minting a synthetic claim on another chain moves value
            off Zcash whether or not anyone calls it a bridge.
          </p>
          {lastAt > 0 ? (
            <p className="mt-3 text-xs text-ink-faint">
              Covering {formatUtc(firstAt)} – {formatUtc(lastAt)}.
            </p>
          ) : null}
        </Panel>
      </div>
    </>
  );
}

/**
 * One direction's diagram, or a sentence saying why there isn't one. `CrossChainSankey` returns
 * null for a direction with no rows; under a window that is ordinary, and an empty bordered
 * panel reads as a chart that failed to draw rather than a period in which nothing crossed.
 */
function FlowDiagram({
  title,
  flows,
  direction,
  unit,
  totalZat,
  empty,
}: {
  title: string;
  flows: CrossChainFlow[];
  direction: CrossChainFlow["direction"];
  unit: number;
  totalZat: number;
  empty: string;
}) {
  return (
    <Panel title={title} className="mt-3">
      {totalZat === 0 ? (
        <p className="py-2 text-sm text-ink-dim">{empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[680px] py-1">
            <CrossChainSankey flows={flows} direction={direction} unit={unit} />
          </div>
        </div>
      )}
    </Panel>
  );
}

/**
 * The trend cell: how this chain moved against the window before it.
 *
 * A ▲/▼ glyph plus a magnitude — green up, red down, direction carried by shape as well as
 * colour (both glyphs are known to render in JetBrains Mono). Two cases are not percentages:
 * - `new` — nothing crossed for this chain in the previous window, so the change has no
 *   denominator; +100% or ∞ would invent one.
 * - an exact zero — unchanged is a measurement, and an arrow beside it would claim a direction.
 */
function TrendCell({ trend }: { trend: FlowTrend }) {
  if (trend.kind === "absent") return <span className="text-ink-faint">—</span>;
  if (trend.kind === "new") return <span className="text-ink-dim">new</span>;
  if (trend.pct === 0) return <span className="text-ink-faint">unchanged</span>;
  const up = trend.pct > 0;
  return (
    <span className={up ? "text-green" : "text-red"}>
      {up ? "▲" : "▼"} {formatDeltaPct(trend.pct)}
    </span>
  );
}

/**
 * One direction's chains, ranked by volume.
 *
 * SHARE denominates against that direction's own total. ZEC is shown at two decimals with the
 * exact amount in a `title` — these are summed volumes, not ledger amounts. The trend column
 * appears only when a fully covered previous window exists; otherwise the comparison is refused
 * rather than divided by a period we only partly observed.
 */
function FlowTable({
  title,
  rows,
  directionTotalZat,
  trendLabel,
}: {
  title: string;
  rows: { flow: CrossChainFlow; previousZat: number }[];
  directionTotalZat: number;
  /** The column heading, e.g. "VS PREV 30D"; `null` renders no trend column at all. */
  trendLabel: string | null;
}) {
  if (rows.length === 0) return null;
  const columns =
    trendLabel === null ? COLUMNS : [...COLUMNS, { label: trendLabel, align: "right" as const }];
  return (
    <Panel title={title} className="mt-3">
      <DataTable caption={title.toLowerCase()} columns={columns}>
        {rows.map(({ flow: f, previousZat }) => (
          <tr key={`${f.direction}-${f.chain}`} className="row-hover hairline-b last:border-0">
            <td>
              <span className="inline-flex items-center gap-2">
                <ChainLogo chain={f.chain} emphasis="normal" />
                {chainName(f.chain)}
              </span>
            </td>
            <td className="text-right tabular-nums" title={formatZec(f.zecAmountZat)}>
              {formatZecTwo(f.zecAmountZat)}
            </td>
            <td className="text-right text-xs text-ink-dim tabular-nums">
              {formatCount(f.transfers)}
            </td>
            <td className="text-right text-xs text-ink-faint tabular-nums">
              {directionTotalZat === 0
                ? "—"
                : `${((f.zecAmountZat / directionTotalZat) * 100).toFixed(2)}%`}
            </td>
            {trendLabel === null ? null : (
              <td className="text-right text-xs whitespace-nowrap tabular-nums">
                <TrendCell trend={flowTrend(f.zecAmountZat, previousZat)} />
              </td>
            )}
          </tr>
        ))}
      </DataTable>
    </Panel>
  );
}
