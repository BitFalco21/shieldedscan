import { PLOT_SERIES_IDS, type PlotSeriesId, type PlottedChart } from "../src/domain";
import { AgentTools } from "../server/agent/tools";
import { FIXTURE_NOW_MS, makeChain, makeV1 } from "../server/agent/testing/fixture-world";

/**
 * The charts Zeno draws, built the way the console receives them: `make_chart` over the fixture
 * world, at the fixture clock (2026-08-03). Every catalogue series alone, and the combinations a
 * reader is likely to ask for, so a layout check covers what the console really renders rather
 * than hand-written payloads.
 */

export interface ChartCase {
  name: string;
  args: Record<string, unknown>;
}

/** A window each series can fill on the fixture world: its flows and closes start where noted. */
const windowFor = (id: PlotSeriesId): Record<string, string> =>
  id === "zec-price"
    ? { from: "2026-07-26" }
    : id === "zec-shielded" || id === "zec-unshielded"
      ? { from: "2026-07-19", to: "2026-07-27" }
      : { from: "2026-07-01" };

export const CHART_CASES: readonly ChartCase[] = [
  ...PLOT_SERIES_IDS.map((id) => ({ name: id, args: { series: [id], ...windowFor(id) } })),
  {
    name: "orchard+ironwood",
    args: { series: ["orchard-balance", "ironwood-balance"], from: "2026-07-01" },
  },
  {
    name: "sapling+orchard+ironwood",
    args: {
      series: ["sapling-balance", "orchard-balance", "ironwood-balance"],
      from: "2026-07-01",
    },
  },
  {
    name: "ironwood+shielded-supply",
    args: { series: ["ironwood-balance", "shielded-supply"], from: "2026-07-01" },
  },
  {
    name: "sprout+orchard-log",
    args: { series: ["sprout-balance", "orchard-balance"], from: "2026-03-01", scale: "log" },
  },
  {
    name: "privacy-kinds",
    args: {
      series: ["transparent-transactions", "mixed-transactions", "fully-shielded-transactions"],
      from: "2026-07-01",
    },
  },
  {
    name: "pool-transactions",
    args: {
      series: ["sapling-transactions", "orchard-transactions", "ironwood-transactions"],
      from: "2026-07-01",
    },
  },
  {
    name: "shielded+unshielded",
    args: { series: ["zec-shielded", "zec-unshielded"], from: "2026-07-19", to: "2026-07-27" },
  },
  { name: "fees-area", args: { series: ["fees-paid"], from: "2026-07-01", type: "area" } },
  { name: "orchard-all-monthly", args: { series: ["orchard-balance"], range: "all" } },
];

/** The chart `make_chart` draws for a case; throws with the tool's own words if it refuses. */
export async function chartFor(c: ChartCase): Promise<PlottedChart> {
  const tools = new AgentTools(makeV1(), makeChain(), () => FIXTURE_NOW_MS);
  const result = await tools.dispatch("make_chart", JSON.stringify(c.args));
  if (result.chart === undefined) throw new Error(`${c.name}: ${result.content}`);
  return result.chart;
}
