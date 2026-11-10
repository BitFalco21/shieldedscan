import { EXCHANGES, EXCHANGE_NAMES, NU7, exchangeAddressCounts } from "@/domain";
import { EXCHANGE_CLASSES } from "@/lib/exchange-palette";
import type { LegendItem } from "@/components/ChartLegend";
import { POOL_CLASSES } from "@/lib/pool-palette";
import { BESIDE_RANKED_LINE, KIND_CLASSES, RANKED_LINES } from "@/lib/ranked-palette";
import type { ChartSlug } from "./catalog";
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
export function chartLegend(slug: ChartSlug): LegendItem[] {
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
    case "notes-added":
      return pools("line", ["sapling", "orchard", "ironwood"]);
    case "issuance-vs-nsm":
      return [
        { label: "Issued", className: "text-green", mark: "line" },
        { label: "Removed into the NSM", className: "text-series", mark: "line" },
      ];
    case "orchard-migration":
      return [
        { label: "Migrated to Ironwood", className: POOL_CLASSES.ironwood, mark: "line" },
        { label: "Left in Orchard", className: POOL_CLASSES.orchard, mark: "line" },
      ];
    case "exchange-reserves":
      // Each total names how many labelled addresses it sums.
      return EXCHANGES.map((e) => ({
        label: `${EXCHANGE_NAMES[e]} · ${exchangeAddressCounts()[e]} addresses`,
        className: EXCHANGE_CLASSES[e],
        mark: "line" as const,
      }));
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
    case "block-arrival-age":
      return [
        { label: "Median, every block", className: RANKED_LINES[0], mark: "line" },
        { label: "90th percentile", className: RANKED_LINES[0], mark: "dashed" },
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
    case "shielded-capable-swaps":
      return [
        { label: "Share of swaps", className: RANKED_LINES[0], mark: "line" },
        { label: "Share of ZEC", className: RANKED_LINES[1], mark: "line" },
      ];
    case "shielded-capable-by-chain":
      return [
        { label: "Shielded-capable", className: "text-green", mark: "bar" },
        { label: "Transparent", className: "text-ink-faint", mark: "bar" },
      ];
    case "shielded-supply":
    case "ironwood-balance":
    case "price":
    case "difficulty":
    case "block-size":
    case "fee-totals":
    case "transparent-activity":
    case "reorgs":
    case "orphan-rate":
    // Their bands are ranked in the window shown, so the chart draws its own key.
    case "node-releases":
    case "node-hosting":
    case "shielded-share":
    case "pools-to-majority":
    // The issuance panel draws its own key beside its figures.
    case "supply-issuance":
    // A ranked key beside the bars is the legend.
    case "inflow-by-chain":
    case "outflow-by-chain":
    case "volume-by-venue":
      return [];
  }
}
