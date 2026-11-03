import { allSeriesSpecs, seriesKey, type PlotSeriesSpec, type PlottedChart } from "../src/domain";
import { AgentTools } from "../server/agent/tools";
import { FIXTURE_NOW_MS, makeChain, makeV1 } from "../server/agent/testing/fixture-world";

/**
 * The charts Zeno draws, built the way the console receives them: `make_chart` over the fixture
 * world, at the fixture clock (2026-08-03). Every series the families name (one chain and one
 * venue standing for the rest, which draw alike), and the combinations a reader is likely to ask
 * for, so a layout check covers what the console really renders rather than hand-written payloads.
 */

export interface ChartCase {
  name: string;
  args: Record<string, unknown>;
}

/** A window each family can fill on the fixture world. */
const windowFor = (spec: PlotSeriesSpec): Record<string, string> => {
  if (spec.family === "price") return { from: "2026-07-26" };
  if (spec.family === "shielding") return { from: "2026-07-19", to: "2026-07-27" };
  if (spec.family === "crosschain") {
    return spec.by === "total" ? { from: "2026-07-19", to: "2026-07-27" } : { range: "1y" };
  }
  if (spec.family === "mining" && spec.metric.endsWith("share")) return { range: "1y" };
  return { from: "2026-07-01" };
};

/** Series with nothing to draw on the fixture world (refused as zero throughout), or drawn alike. */
const SKIPPED = (spec: PlotSeriesSpec) =>
  seriesKey(spec) === "pool:sprout:migrated-in" ||
  (spec.family === "crosschain" && spec.by === "chain" && spec.chain !== "BTC") ||
  (spec.family === "crosschain" && spec.by === "venue" && spec.venue !== "near-intents");

const pool = (p: string, metric = "balance") => ({ family: "pool", pool: p, metric });

export const CHART_CASES: readonly ChartCase[] = [
  ...allSeriesSpecs()
    .filter((spec) => !SKIPPED(spec))
    .map((spec) => ({ name: seriesKey(spec), args: { series: [spec], ...windowFor(spec) } })),
  {
    name: "orchard+ironwood",
    args: { series: [pool("orchard"), pool("ironwood")], from: "2026-07-01" },
  },
  {
    name: "sapling+orchard+ironwood",
    args: { series: [pool("sapling"), pool("orchard"), pool("ironwood")], from: "2026-07-01" },
  },
  {
    name: "ironwood+shielded-supply",
    args: {
      series: [pool("ironwood"), { family: "supply", part: "shielded" }],
      from: "2026-07-01",
    },
  },
  {
    name: "sprout+orchard-log",
    args: { series: [pool("sprout"), pool("orchard")], from: "2026-03-01", scale: "log" },
  },
  {
    name: "privacy-kinds",
    args: {
      series: (["transparent", "mixed", "shielded"] as const).map((kind) => ({
        family: "transactions",
        kind,
      })),
      from: "2026-07-01",
    },
  },
  {
    name: "pool-transactions",
    args: {
      series: [
        pool("sapling", "transactions"),
        pool("orchard", "transactions"),
        pool("ironwood", "transactions"),
      ],
      from: "2026-07-01",
    },
  },
  {
    name: "shielded+unshielded",
    args: {
      series: [
        { family: "shielding", direction: "in" },
        { family: "shielding", direction: "out" },
      ],
      from: "2026-07-19",
      to: "2026-07-27",
    },
  },
  {
    name: "btc+eth+sol-in",
    args: {
      series: ["BTC", "ETH", "SOL"].map((chain) => ({
        family: "crosschain",
        direction: "in",
        chain,
      })),
      range: "1y",
    },
  },
  {
    name: "venues-in",
    args: {
      series: ["near-intents", "thorchain"].map((venue) => ({
        family: "crosschain",
        direction: "in",
        venue,
      })),
      range: "1y",
    },
  },
  {
    name: "miner-shares",
    args: {
      series: (["top1-share", "top3-share", "top10-share"] as const).map((metric) => ({
        family: "mining",
        metric,
      })),
      range: "1y",
    },
  },
  {
    name: "fees-area",
    args: { series: [{ family: "fees", stat: "total" }], from: "2026-07-01", type: "area" },
  },
  { name: "orchard-all-monthly", args: { series: [pool("orchard")], range: "all" } },
];

/** The chart `make_chart` draws for a case; throws with the tool's own words if it refuses. */
export async function chartFor(c: ChartCase): Promise<PlottedChart> {
  const tools = new AgentTools(makeV1(), makeChain(), () => FIXTURE_NOW_MS);
  const result = await tools.dispatch("make_chart", JSON.stringify(c.args));
  if (result.chart === undefined) throw new Error(`${c.name}: ${result.content}`);
  return result.chart;
}
