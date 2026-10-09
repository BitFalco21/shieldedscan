import { NU7 } from "@/domain";
import type { LegendItem } from "@/components/ChartLegend";
import { chainName } from "@/lib/chains";
import { FOLDED_FLOW_CLASS, flowPaletteClass } from "@/lib/flow-palette";
import { POOL_CLASSES } from "@/lib/pool-palette";
import { BESIDE_RANKED_LINE, KIND_CLASSES, RANKED_LINES } from "@/lib/ranked-palette";
import type { ChartSlug } from "./catalog";
import type { ChartData } from "./chart-data";
import { chartTable, INFLOW_OTHER } from "./chart-table";
import { POOL_STACK } from "./pool-series";
import { capitalise } from "@/lib/format";

/** The three privacy kinds in the ink grammar every kind chart draws them in. */
const KIND_LINES: LegendItem[] = [
  { label: "Fully shielded", className: KIND_CLASSES.shielded, mark: "line" },
  { label: "Mixed", className: KIND_CLASSES.mixed, mark: "line" },
  { label: "Transparent", className: KIND_CLASSES.transparent, mark: "line" },
];

const pools = (mark: LegendItem["mark"], only?: readonly string[]): LegendItem[] =>
  POOL_STACK.filter((p) => !only || only.includes(p)).map((pool) => ({
    label: capitalise(pool),
    className: POOL_CLASSES[pool],
    mark,
  }));

/**
 * What each colour stands for, per chart, in the order and the ink the chart draws them. A chart
 * of one series gets none: its title names it. Stacks list bottom band first, as they are drawn.
 */
export function chartLegend(slug: ChartSlug, data: ChartData): LegendItem[] {
  switch (slug) {
    case "transactions-by-kind":
      return [
        { label: "Transparent", className: "band-transparent", mark: "area" },
        { label: "Mixed", className: "band-mixed", mark: "area" },
        { label: "Fully shielded", className: "band-shielded", mark: "area" },
      ];
    case "pool-balances":
    case "pool-migrations":
      return pools("area");
    case "pool-usage":
      return pools("line");
    case "anonymity-set":
      return pools("line", ["sapling", "orchard", "ironwood"]);
    case "shielding-flow":
      return [
        { label: "Shielded", className: "text-series", mark: "bar" },
        { label: "Unshielded", className: "text-series", mark: "bar", weight: "faint" },
      ];
    case "crosschain-volume":
      return [
        { label: "Inbound", className: "text-series", mark: "bar" },
        { label: "Outbound", className: "text-series", mark: "bar", weight: "faint" },
      ];
    case "median-fee":
    case "privacy-share":
      return KIND_LINES;
    case "blocks-per-day":
      return [
        { label: "Blocks", className: "text-green", mark: "line" },
        { label: "Target", className: "text-ink-faint", mark: "dashed" },
      ];
    case "upgrade-readiness":
      return [
        { label: "Ready", className: RANKED_LINES[0], mark: "line" },
        {
          label: `Declare ${NU7.minProtocolVersion.mainnet}+`,
          className: RANKED_LINES[1],
          mark: "line",
        },
        { label: "Behind our tip", className: RANKED_LINES[2], mark: "line" },
      ];
    case "miner-concentration":
      return [
        { label: "Largest address", className: RANKED_LINES[0], mark: "line" },
        { label: "Largest 3", className: RANKED_LINES[1], mark: "line" },
        { label: "Largest 10", className: RANKED_LINES[2], mark: "line" },
        { label: "Paid to a shielded address", className: BESIDE_RANKED_LINE, mark: "line" },
      ];
    case "inflow-by-chain":
      return (chartTable(slug, data, "all")?.keys ?? []).map((key) => ({
        label: key === INFLOW_OTHER ? "Other chains" : chainName(key),
        className: key === INFLOW_OTHER ? FOLDED_FLOW_CLASS : flowPaletteClass(key),
        mark: "area" as const,
      }));
    case "shielded-supply":
    case "ironwood-balance":
    case "price":
    case "difficulty":
    case "block-size":
    case "fee-totals":
    case "transparent-activity":
    case "reorgs":
      return [];
  }
}
