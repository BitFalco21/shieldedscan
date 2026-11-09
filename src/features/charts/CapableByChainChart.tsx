import { ChainLogo } from "@/components/ChainLogo";
import { chainName } from "@/lib/chains";
import { formatCount, formatSharePct } from "@/lib/format";
import { FOLDED_KEY, type ChartTable } from "./chart-table";

export interface CapableByChainChartProps {
  /** The "chain" table `chartTable` builds for the window shown: one row per source chain. */
  table: ChartTable;
}

/** Column positions in the table, by name, so the figure reads what the CSV prints. */
const col = (t: ChartTable, name: string) => t.columns.indexOf(name);

/**
 * One bar per source chain: the swaps into ZEC sent to a shielded-capable address against those
 * sent to a transparent one, each chain's bar its own 100%, with the counts beside it. A chain
 * whose venues published no Zcash address has no share, and says so; unpublished swaps are counted
 * beside the bar, never inside it.
 *
 * The bar's length is an SVG `width`, so `src/` keeps its no-inline-style rule; its numbers are
 * text, so the SVG is decoration and is hidden from a screen reader.
 */
export function CapableByChainChart({ table }: CapableByChainChartProps) {
  const at = {
    chains: col(table, "chains"),
    pct: col(table, "capable_pct"),
    capable: col(table, "capable_swaps"),
    transparent: col(table, "transparent_swaps"),
    unknown: col(table, "unpublished_swaps"),
  };
  return (
    <ol
      className="space-y-3"
      aria-label="Swaps into ZEC sent to a shielded-capable address, per source chain"
    >
      {table.rows.map((row, i) => {
        const key = table.rowKeys?.[i] ?? "";
        const folded = key === FOLDED_KEY;
        const capable = row[at.capable] ?? 0;
        const classified = capable + (row[at.transparent] ?? 0);
        const unknown = row[at.unknown] ?? 0;
        const pct = row[at.pct] ?? null;
        const name = folded ? `Other chains (${formatCount(row[at.chains] ?? 0)})` : chainName(key);
        return (
          <li
            key={key}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 text-sm sm:grid-cols-[10rem_minmax(0,1fr)_12rem]"
          >
            <span className="flex min-w-0 items-center gap-2">
              {folded ? null : <ChainLogo chain={key} />}
              <span className="truncate text-ink">{name}</span>
            </span>
            <span className="text-right text-xs text-ink-dim tabular-nums sm:order-last">
              {pct === null ? (
                <span className="text-ink-faint">no address published</span>
              ) : (
                <>
                  <span className="text-ink">{formatSharePct(pct)}</span> · {formatCount(capable)}{" "}
                  of {formatCount(classified)}
                </>
              )}
              {unknown > 0 && pct !== null ? (
                <span className="block text-ink-faint">+{formatCount(unknown)} unpublished</span>
              ) : null}
              {pct === null ? (
                <span className="block text-ink-faint">{formatCount(unknown)} swaps</span>
              ) : null}
            </span>
            <svg
              className="col-span-2 h-2.5 w-full sm:col-span-1"
              viewBox="0 0 100 10"
              preserveAspectRatio="none"
              aria-hidden="true"
              focusable="false"
            >
              {pct === null ? (
                <rect
                  className="fill-none stroke-current text-edge"
                  x="0.5"
                  y="0.5"
                  width="99"
                  height="9"
                  vectorEffect="non-scaling-stroke"
                />
              ) : (
                <>
                  <rect className="fill-current text-green" x="0" y="0" width={pct} height="10" />
                  <rect
                    className="fill-current text-ink-faint"
                    x={pct}
                    y="0"
                    width={100 - pct}
                    height="10"
                  />
                </>
              )}
            </svg>
          </li>
        );
      })}
    </ol>
  );
}
