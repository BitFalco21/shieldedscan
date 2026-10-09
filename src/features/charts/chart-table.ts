import type { ChartRange, FeeSpreadKind } from "@/domain";
import {
  blocksTargetForDay,
  NU7,
  NU7_RELEASES,
  readinessHistory,
  sliceRange,
  sliceTail,
  utcDayFromSeconds,
} from "@/domain";
import type { ChartSlug } from "./catalog";
import type { ChartData } from "./chart-data";

/** One cell: a number as published (zatoshi, counts, USD), or null where the chart draws a gap. */
export type ChartCell = number | null;

/**
 * The points a chart plots, as a table: the first column labels the period, the rest are the
 * series in their published units.
 *
 * Each case picks the same source and the same window as `ChartFigure` does for that slug, so the
 * CSV a reader downloads, the gallery's sparkline and its headline figure all come from what the
 * chart draws. Amounts stay in zatoshi, as the API publishes them: a CSV is for computing with,
 * and a formatted ZEC string is not a number.
 */
export interface ChartTable {
  /** "day", "week" (ISO, labelled by its Monday), "month" or "hour". */
  period: "day" | "week" | "month" | "hour";
  columns: string[];
  /**
   * What each column stands for, where the column name alone cannot carry it: the source chain's
   * ticker behind each of `inflow-by-chain`'s columns, so the figure colours and names it.
   */
  keys?: string[];
  /** Unix seconds of each row, oldest first. */
  timestamps: number[];
  rows: ChartCell[][];
}

/** `YYYY-MM` for a month point. */
const utcMonth = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 7);

/** `YYYY-MM-DDTHH:00Z` for an hourly point. */
const utcHour = (ts: number) => `${new Date(ts * 1000).toISOString().slice(0, 13)}:00Z`;

/** The period label of a row, as the CSV's first column prints it. */
export function periodLabel(table: ChartTable, index: number): string {
  const ts = table.timestamps[index]!;
  if (table.period === "month") return utcMonth(ts);
  if (table.period === "hour") return utcHour(ts);
  return utcDayFromSeconds(ts);
}

function table<T extends { timestamp: number }>(
  period: ChartTable["period"],
  points: readonly T[],
  columns: { name: string; value: (p: T) => ChartCell }[],
): ChartTable {
  return {
    period,
    columns: columns.map((c) => c.name),
    timestamps: points.map((p) => p.timestamp),
    rows: points.map((p) => columns.map((c) => c.value(p))),
  };
}

/**
 * Charts with no range control: their whole series is either narrower than the shortest range
 * (ironwood-balance), or monthly or weekly with no daily sibling, where thirty days would be one
 * or four points.
 */
export const UNRANGED: ReadonlySet<ChartSlug> = new Set([
  "ironwood-balance",
  "miner-concentration",
  "reorgs",
  "inflow-by-chain",
]);

/** Source chains drawn on their own in `inflow-by-chain`; the rest are folded into one band. */
export const INFLOW_CHAINS_SHOWN = 6;

/** The fold's key: not a chain, and coloured as the Sankey colours its folded tail. */
export const INFLOW_OTHER = "OTHER";

/** A share of a whole in percent, to the hundredth of a point; null over nothing. */
const share = (part: number, whole: number): ChartCell =>
  whole === 0 ? null : Math.round((10_000 * part) / whole) / 100;

const FEE_KINDS = [
  ["fully_shielded", "shielded"],
  ["mixed", "mixed"],
  ["transparent", "transparent"],
] as const;

/** Null when the chart's series is unreadable, exactly when `ChartFigure` renders "unavailable". */
export function chartTable(
  slug: ChartSlug,
  data: ChartData,
  requested: ChartRange,
): ChartTable | null {
  const range: ChartRange = UNRANGED.has(slug) ? "all" : requested;
  // The monthly charts read their daily sibling for every range short of ALL, as the figure does.
  const daily = range !== "all";
  const grain = daily ? "day" : "month";
  switch (slug) {
    case "transactions-by-kind": {
      const source = daily ? data.days : data.months;
      if (!source) return null;
      return table(
        grain,
        sliceRange(source, (p) => p.timestamp, range),
        [
          { name: "transparent_txs", value: (p) => p.transparentTxs },
          { name: "mixed_txs", value: (p) => p.mixedTxs },
          { name: "fully_shielded_txs", value: (p) => p.shieldedTxs },
        ],
      );
    }
    case "pool-balances": {
      const source = daily ? data.days : data.months;
      if (!source) return null;
      return table(
        grain,
        sliceRange(source, (p) => p.timestamp, range),
        [
          { name: "sprout_zat", value: (p) => p.sproutZat },
          { name: "sapling_zat", value: (p) => p.saplingZat },
          { name: "orchard_zat", value: (p) => p.orchardZat },
          { name: "ironwood_zat", value: (p) => p.ironwoodZat },
        ],
      );
    }
    case "pool-usage": {
      if (!data.poolUsage) return null;
      return table(
        "day",
        sliceRange(data.poolUsage, (p) => p.timestamp, range),
        [
          { name: "sprout_txs", value: (p) => p.sproutTxs },
          { name: "sapling_txs", value: (p) => p.saplingTxs },
          { name: "orchard_txs", value: (p) => p.orchardTxs },
          { name: "ironwood_txs", value: (p) => p.ironwoodTxs },
        ],
      );
    }
    case "pool-migrations": {
      if (!data.poolMigrations) return null;
      return table(
        "day",
        sliceRange(data.poolMigrations, (p) => p.timestamp, range),
        [
          { name: "to_sprout_zat", value: (p) => p.toSproutZat },
          { name: "to_sapling_zat", value: (p) => p.toSaplingZat },
          { name: "to_orchard_zat", value: (p) => p.toOrchardZat },
          { name: "to_ironwood_zat", value: (p) => p.toIronwoodZat },
        ],
      );
    }
    case "shielding-flow": {
      const source = daily ? data.flowDays : data.flow;
      if (!source) return null;
      return table(
        grain,
        sliceRange(source, (p) => p.timestamp, range),
        [
          { name: "shielded_zat", value: (p) => p.shieldedZat },
          { name: "unshielded_zat", value: (p) => p.unshieldedZat },
        ],
      );
    }
    case "median-fee": {
      const source = daily ? data.feesDaily : (data.fees?.monthly ?? null);
      if (!source) return null;
      return table(
        grain,
        sliceRange(source, (p) => p.timestamp, range),
        [
          { name: "fully_shielded_median_zat", value: (p) => p.shieldedZat },
          { name: "mixed_median_zat", value: (p) => p.mixedZat },
          { name: "transparent_median_zat", value: (p) => p.transparentZat },
        ],
      );
    }
    case "shielded-supply": {
      if (!data.supply) return null;
      return table("day", sliceTail(data.supply, range), [
        { name: "shielded_zat", value: (p) => p.totalZat },
      ]);
    }
    case "ironwood-balance": {
      // No range control on this chart: its whole series is the window.
      if (!data.ironwood) return null;
      return table("hour", data.ironwood.balance, [
        { name: "ironwood_zat", value: (p) => p.ironwoodZat },
      ]);
    }
    case "price": {
      if (!data.prices) return null;
      const prices = data.prices;
      const days = sliceTail(Object.keys(prices).sort(), range);
      return {
        period: "day",
        columns: ["usd_close"],
        timestamps: days.map((d) => Date.parse(`${d}T00:00:00Z`) / 1000),
        rows: days.map((d) => [prices[d] ?? null]),
      };
    }
    case "difficulty": {
      if (!data.network) return null;
      return table(
        "day",
        sliceRange(data.network, (p) => p.timestamp, range),
        [{ name: "avg_difficulty", value: (p) => p.avgDifficulty }],
      );
    }
    case "block-size": {
      if (!data.network) return null;
      return table(
        "day",
        sliceRange(data.network, (p) => p.timestamp, range),
        [{ name: "avg_block_bytes", value: (p) => p.avgBlockBytes }],
      );
    }
    case "fee-totals": {
      if (!data.feeTotals) return null;
      const source = daily ? data.feeTotals.daily : data.feeTotals.monthly;
      // The block counts travel with each total: a period whose blocks are not all covered sums
      // fewer fees than were paid, and the CSV must say so as the chart's readout does.
      return table(
        grain,
        sliceRange(source, (p) => p.timestamp, range),
        [
          { name: "fee_zat", value: (p) => p.feeZat },
          { name: "blocks_covered", value: (p) => p.blocksCovered },
          { name: "blocks", value: (p) => p.blocks },
        ],
      );
    }
    case "crosschain-volume": {
      if (!data.crosschainVolume) return null;
      const source = daily ? data.crosschainVolume.daily : data.crosschainVolume.monthly;
      return table(
        grain,
        sliceRange(source, (p) => p.timestamp, range),
        [
          { name: "inbound_zat", value: (p) => p.inZat },
          { name: "outbound_zat", value: (p) => p.outZat },
        ],
      );
    }
    case "privacy-share": {
      const source = daily ? data.days : data.months;
      if (!source) return null;
      const total = (p: (typeof source)[number]) => p.transparentTxs + p.mixedTxs + p.shieldedTxs;
      return table(
        grain,
        sliceRange(source, (p) => p.timestamp, range),
        [
          { name: "fully_shielded_pct", value: (p) => share(p.shieldedTxs, total(p)) },
          { name: "mixed_pct", value: (p) => share(p.mixedTxs, total(p)) },
          { name: "transparent_pct", value: (p) => share(p.transparentTxs, total(p)) },
          { name: "transactions", value: (p) => total(p) },
        ],
      );
    }
    case "anonymity-set": {
      if (!data.noteTrees) return null;
      return table(
        "day",
        sliceRange(data.noteTrees, (p) => p.timestamp, range),
        [
          { name: "sapling_notes", value: (p) => p.saplingNotes },
          { name: "orchard_notes", value: (p) => p.orchardNotes },
          { name: "ironwood_notes", value: (p) => p.ironwoodNotes },
        ],
      );
    }
    case "fee-spread": {
      const series = data.feeSpread;
      if (!series) return null;
      const source = daily ? series.daily : series.monthly;
      const field =
        (kind: "shielded" | "mixed" | "transparent", f: keyof FeeSpreadKind) =>
        (p: (typeof source)[number]): ChartCell =>
          p[kind]?.[f] ?? null;
      return table(
        grain,
        sliceRange(source, (p) => p.timestamp, range),
        FEE_KINDS.flatMap(([label, kind]) => [
          { name: `${label}_p25_zat`, value: field(kind, "p25Zat") },
          { name: `${label}_median_zat`, value: field(kind, "medianZat") },
          { name: `${label}_p75_zat`, value: field(kind, "p75Zat") },
          { name: `${label}_txs`, value: field(kind, "txs") },
        ]),
      );
    }
    case "blocks-per-day": {
      if (!data.blocksDaily) return null;
      return table(
        "day",
        sliceRange(data.blocksDaily, (p) => p.timestamp, range),
        [
          { name: "blocks", value: (p) => p.blocks },
          { name: "target_blocks", value: (p) => blocksTargetForDay(p) },
          { name: "top_height", value: (p) => p.topHeight },
        ],
      );
    }
    case "transparent-activity": {
      if (!data.transparentDays) return null;
      return table(
        "day",
        sliceRange(data.transparentDays, (p) => p.timestamp, range),
        [
          { name: "active_addresses", value: (p) => p.activeAddresses },
          { name: "outputs_zat", value: (p) => p.outputsZat },
        ],
      );
    }
    case "upgrade-readiness": {
      if (!data.releases) return null;
      const days = readinessHistory(data.releases.history, NU7, "mainnet", NU7_RELEASES).map(
        (d) => ({ ...d, timestamp: Date.parse(`${d.day}T00:00:00Z`) / 1000 }),
      );
      return table(
        "day",
        sliceRange(days, (p) => p.timestamp, range),
        [
          { name: "answering", value: (p) => p.answering },
          { name: "ready", value: (p) => p.ready },
          { name: "declares", value: (p) => p.declares },
          { name: "behind_tip", value: (p) => p.behindTip },
          { name: "tip_known", value: (p) => p.tipKnown },
        ],
      );
    }
    case "miner-concentration": {
      if (!data.minerShares) return null;
      return table("month", data.minerShares, [
        { name: "top1_pct", value: (p) => share(p.top1Blocks, p.blocks) },
        { name: "top3_pct", value: (p) => share(p.top3Blocks, p.blocks) },
        { name: "top10_pct", value: (p) => share(p.top10Blocks, p.blocks) },
        { name: "blocks", value: (p) => p.blocks },
        { name: "days_computed", value: (p) => p.days },
      ]);
    }
    case "reorgs": {
      if (!data.reorgWeeks || data.reorgWeeks.observingSince === null) return null;
      return table("week", data.reorgWeeks.weeks, [
        { name: "reorgs", value: (p) => p.reorgs },
        { name: "deepest", value: (p) => p.deepest },
      ]);
    }
    case "inflow-by-chain": {
      if (!data.chainInflow) return null;
      // The largest sources by all-time inflow, then one band for the rest, so the colours and the
      // order hold still as the months go by.
      const totals = new Map<string, number>();
      for (const p of data.chainInflow) totals.set(p.chain, (totals.get(p.chain) ?? 0) + p.inZat);
      const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([chain]) => chain);
      const shown = ranked.slice(0, INFLOW_CHAINS_SHOWN);
      const keys = ranked.length > shown.length ? [...shown, INFLOW_OTHER] : shown;
      const months = new Map<number, Map<string, number>>();
      for (const p of data.chainInflow) {
        const key = shown.includes(p.chain) ? p.chain : INFLOW_OTHER;
        const month = months.get(p.timestamp) ?? new Map<string, number>();
        month.set(key, (month.get(key) ?? 0) + p.inZat);
        months.set(p.timestamp, month);
      }
      // Every month from the first to the last, so time keeps its spacing: a month with no inbound
      // swap is a measured zero, since every indexed swap is counted.
      const seen = [...months.keys()].sort((a, b) => a - b);
      const timestamps: number[] = [];
      if (seen.length > 0) {
        const last = seen.at(-1)!;
        for (let d = new Date(seen[0]! * 1000); d.getTime() / 1000 <= last;) {
          timestamps.push(d.getTime() / 1000);
          d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1));
        }
      }
      return {
        period: "month",
        columns: keys.map((k) => `${k.toLowerCase()}_in_zat`),
        keys,
        timestamps,
        // A month a chain sent nothing is a measured zero: every inbound swap indexed is counted.
        rows: timestamps.map((ts) => keys.map((k) => months.get(ts)?.get(k) ?? 0)),
      };
    }
  }
}

/** The table as CSV: a header row, then one row per period. A null cell is an empty field. */
export function chartCsv(t: ChartTable): string {
  const header = [t.period, ...t.columns].join(",");
  const lines = t.rows.map((row, i) =>
    [periodLabel(t, i), ...row.map((cell) => (cell === null ? "" : String(cell)))].join(","),
  );
  return [header, ...lines].join("\n") + "\n";
}
