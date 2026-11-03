import { isOneOf } from "./closed-set";
import type { CrossChainProtocol } from "./crosschain";
import { CROSSCHAIN_PROTOCOLS } from "./crosschain-protocols";
import { POOL_NAMES, type PoolName } from "./pool";

/**
 * What Zeno may plot: a family and parameters, each from a closed list. The model names a series
 * this way and never supplies a figure; the spec is all that crosses the wire about a series, so its
 * label, unit and page are derived from it on both sides (`plottable.ts`) and cannot disagree.
 */

export const PLOT_FAMILIES = [
  "pool",
  "supply",
  "shielding",
  "transactions",
  "fees",
  "mining",
  "network",
  "price",
  "crosschain",
] as const;
export type PlotFamily = (typeof PLOT_FAMILIES)[number];

export const POOL_METRICS = ["balance", "transactions", "migrated-in", "notes"] as const;
export const SUPPLY_PARTS = ["shielded", "transparent", "lockbox", "circulating"] as const;
export const FLOW_DIRECTIONS = ["in", "out"] as const;
/** One spelling for a privacy kind everywhere; the label says "fully shielded". */
export const PLOT_TX_KINDS = ["transparent", "mixed", "shielded"] as const;
export const FEE_STATS = ["total", "median"] as const;
export const MINING_METRICS = [
  "blocks",
  "difficulty",
  "top1-share",
  "top3-share",
  "top10-share",
  "shielded-coinbase-share",
] as const;
export const NETWORK_METRICS = ["block-size", "active-addresses"] as const;
export const CROSSCHAIN_BY = ["total", "chain", "venue"] as const;
export const CROSSCHAIN_MEASURES = ["zec", "transfers"] as const;

/**
 * The counterpart chains a cross-chain series may name, by the ticker the venues publish, with the
 * site's display name where it has one (`src/lib/chains.ts`, checked by test). Closed so a model
 * cannot name a chain into a query; a venue's new chain is added here, site-first.
 */
export const PLOT_CHAINS: Readonly<Record<string, string>> = {
  BTC: "Bitcoin",
  ETH: "Ethereum",
  SOL: "Solana",
  NEAR: "NEAR",
  TRON: "Tron",
  ARB: "Arbitrum",
  BASE: "Base",
  SUI: "Sui",
  BSC: "BNB Chain",
  LTC: "Litecoin",
  DOGE: "Dogecoin",
  XRP: "XRP Ledger",
  BCH: "Bitcoin Cash",
  DASH: "Dash",
  CARDANO: "Cardano",
  APTOS: "Aptos",
  GNOSIS: "GNOSIS",
  STARKNET: "STARKNET",
  POL: "Polygon",
  AVAX: "Avalanche",
  TON: "TON",
  STELLAR: "Stellar",
  MAYA: "Maya Protocol",
  THOR: "THORChain",
  ALEO: "ALEO",
  BERA: "BERA",
  GAIA: "GAIA",
  HOOD: "HOOD",
  KUJI: "KUJI",
  MOVEMENT: "MOVEMENT",
  PLASMA: "PLASMA",
  QTC: "QTC",
  XRD: "XRD",
};
export const PLOT_CHAIN_TICKERS = Object.keys(PLOT_CHAINS);

export type PoolMetric = (typeof POOL_METRICS)[number];
export type PlotSupplyPart = (typeof SUPPLY_PARTS)[number];
export type FlowDirection = (typeof FLOW_DIRECTIONS)[number];
export type PlotTxKind = (typeof PLOT_TX_KINDS)[number];
export type MiningMetric = (typeof MINING_METRICS)[number];
export type NetworkMetric = (typeof NETWORK_METRICS)[number];
export type CrossChainMeasure = (typeof CROSSCHAIN_MEASURES)[number];

export type PlotSeriesSpec =
  | { family: "pool"; pool: PoolName; metric: PoolMetric }
  | { family: "supply"; part: PlotSupplyPart }
  | { family: "shielding"; direction: FlowDirection }
  | { family: "transactions"; kind: PlotTxKind }
  | { family: "fees"; stat: "total" }
  | { family: "fees"; stat: "median"; kind: PlotTxKind }
  | { family: "mining"; metric: MiningMetric }
  | { family: "network"; metric: NetworkMetric }
  | { family: "price" }
  | { family: "crosschain"; direction: FlowDirection; by: "total"; measure: CrossChainMeasure }
  | { family: "crosschain"; direction: FlowDirection; by: "chain"; chain: string }
  | { family: "crosschain"; direction: FlowDirection; by: "venue"; venue: CrossChainProtocol };

/** The parameters each family may carry; anything else is refused by name. */
export const FAMILY_PARAMS: Readonly<Record<PlotFamily, readonly string[]>> = {
  pool: ["pool", "metric"],
  supply: ["part"],
  shielding: ["direction"],
  transactions: ["kind", "pool"],
  fees: ["stat", "kind"],
  mining: ["metric"],
  network: ["metric"],
  price: [],
  crosschain: ["direction", "by", "chain", "venue", "measure"],
};

/** Every parameter name any family takes: the flat schema the model fills. */
export const PLOT_PARAM_NAMES = [
  "pool",
  "metric",
  "part",
  "direction",
  "kind",
  "stat",
  "by",
  "chain",
  "venue",
  "measure",
] as const;

/** Why a spec was refused: a value outside a list, or a combination that names no series. */
export type SpecProblemReason = "not-chartable" | "bad-parameter" | "names-nothing";

export type SpecParse =
  { ok: true; spec: PlotSeriesSpec } | { ok: false; reason: SpecProblemReason; message: string };

/** A model-supplied string quoted back in a message, kept short: it is a pointer, not a payload. */
const clip = (s: string) => (s.length > 40 ? `${s.slice(0, 39)}…` : s);

const fail = (reason: SpecProblemReason, message: string): SpecParse => ({
  ok: false,
  reason,
  message,
});

/** A string parameter, trimmed and lower-cased, or undefined when absent. */
function param(r: Record<string, unknown>, key: string): string | undefined | null {
  const v = r[key];
  if (v === undefined) return undefined;
  return typeof v === "string" ? v.trim().toLowerCase() : null;
}

/** A counterpart chain by ticker or by its display name, in any case; null if not listed. */
export function plotChainTicker(raw: string): string | null {
  const up = raw.trim().toUpperCase();
  if (up in PLOT_CHAINS) return up;
  const byName = Object.entries(PLOT_CHAINS).find(([, name]) => name.toUpperCase() === up);
  return byName?.[0] ?? null;
}

/**
 * One series spec off the model or the wire, canonical (fixed key order, one spelling per series),
 * or why it is not one. Pure and shared, so the console re-validates exactly what the server sent.
 */
export function parseSeriesSpec(raw: unknown): SpecParse {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return fail(
      "bad-parameter",
      `each series is an object such as {"family":"pool","pool":"orchard","metric":"balance"}, not ${clip(JSON.stringify(raw) ?? String(raw))}`,
    );
  }
  const r = raw as Record<string, unknown>;
  const family = param(r, "family");
  if (family === undefined || family === null) {
    return fail("bad-parameter", `each series needs a family: ${PLOT_FAMILIES.join(", ")}`);
  }
  if (!isOneOf(PLOT_FAMILIES, family)) {
    return fail(
      "not-chartable",
      `no series family "${clip(family)}" — families are ${PLOT_FAMILIES.join(", ")}`,
    );
  }
  const allowed = FAMILY_PARAMS[family];
  const extra = Object.keys(r).filter((k) => k !== "family" && !allowed.includes(k));
  if (extra.length > 0) {
    return fail(
      "bad-parameter",
      `${family} takes ${allowed.length === 0 ? "no parameters" : allowed.join(", ")}, not ${clip(extra.join(", "))}`,
    );
  }
  const values = Object.fromEntries(allowed.map((k) => [k, param(r, k)]));
  const notText = allowed.find((k) => values[k] === null);
  if (notText !== undefined) return fail("bad-parameter", `${family}'s ${notText} must be a word`);
  return familySpec(family, values as Record<string, string | undefined>);
}

/** One of a closed list, or the message naming the list. */
function pick<T extends string>(
  family: string,
  key: string,
  list: readonly T[],
  value: string | undefined,
): T | SpecParse {
  if (value === undefined)
    return fail("bad-parameter", `${family} needs ${key}: ${list.join(", ")}`);
  if (!isOneOf(list, value)) {
    return fail(
      "bad-parameter",
      `${family}'s ${key} must be one of ${list.join(", ")}, not "${clip(value)}"`,
    );
  }
  return value;
}

const isProblem = (v: unknown): v is SpecParse => typeof v === "object" && v !== null;
const ok = (spec: PlotSeriesSpec): SpecParse => ({ ok: true, spec });

function familySpec(family: PlotFamily, v: Record<string, string | undefined>): SpecParse {
  switch (family) {
    case "pool":
      return poolSpec(v.pool, v.metric);
    case "supply": {
      const part = pick(family, "part", SUPPLY_PARTS, v.part);
      return isProblem(part) ? part : ok({ family, part });
    }
    case "shielding": {
      const direction = pick(family, "direction", FLOW_DIRECTIONS, v.direction);
      return isProblem(direction) ? direction : ok({ family, direction });
    }
    case "transactions": {
      if (v.kind !== undefined && v.pool !== undefined) {
        return fail(
          "names-nothing",
          "transactions are split by kind OR by pool, never both: one transaction is counted in each split",
        );
      }
      // Per pool, the same series as the pool family's: one spelling, so dedupe and ink agree.
      if (v.pool !== undefined) return poolSpec(v.pool, "transactions");
      const kind = pick(family, "kind", PLOT_TX_KINDS, v.kind);
      return isProblem(kind) ? kind : ok({ family, kind });
    }
    case "fees": {
      const stat = pick(family, "stat", FEE_STATS, v.stat);
      if (isProblem(stat)) return stat;
      if (stat === "total") {
        if (v.kind !== undefined) {
          return fail("names-nothing", "the fee total is not split by kind; the median is");
        }
        return ok({ family, stat });
      }
      const kind = pick(family, "kind", PLOT_TX_KINDS, v.kind);
      return isProblem(kind) ? kind : ok({ family, stat, kind });
    }
    case "mining": {
      const metric = pick(family, "metric", MINING_METRICS, v.metric);
      return isProblem(metric) ? metric : ok({ family, metric });
    }
    case "network": {
      const metric = pick(family, "metric", NETWORK_METRICS, v.metric);
      return isProblem(metric) ? metric : ok({ family, metric });
    }
    case "price":
      return ok({ family });
    case "crosschain":
      return crosschainSpec(v);
  }
}

function poolSpec(rawPool: string | undefined, rawMetric: string | undefined): SpecParse {
  const pool = pick("pool", "pool", POOL_NAMES, rawPool);
  if (isProblem(pool)) return pool;
  const metric = pick("pool", "metric", POOL_METRICS, rawMetric);
  if (isProblem(metric)) return metric;
  if (metric === "notes" && pool === "sprout") {
    return fail("names-nothing", "the node reports no note tree size for Sprout");
  }
  return ok({ family: "pool", pool, metric });
}

function crosschainSpec(v: Record<string, string | undefined>): SpecParse {
  const direction = pick("crosschain", "direction", FLOW_DIRECTIONS, v.direction);
  if (isProblem(direction)) return direction;
  // `by` follows from the parameter given when it is left out.
  const by = pick(
    "crosschain",
    "by",
    CROSSCHAIN_BY,
    v.by ?? (v.chain !== undefined ? "chain" : v.venue !== undefined ? "venue" : "total"),
  );
  if (isProblem(by)) return by;
  const stray = (key: string) => fail("names-nothing", `crosschain by ${by} takes no ${key}`);
  if (by !== "chain" && v.chain !== undefined) return stray("chain");
  if (by !== "venue" && v.venue !== undefined) return stray("venue");
  if (by !== "total" && v.measure !== undefined && v.measure !== "zec") {
    return fail(
      "names-nothing",
      "per chain and per venue the series is ZEC; transfer counts are per total only",
    );
  }
  if (by === "total") {
    const measure = pick("crosschain", "measure", CROSSCHAIN_MEASURES, v.measure ?? "zec");
    return isProblem(measure) ? measure : ok({ family: "crosschain", direction, by, measure });
  }
  if (by === "venue") {
    const venue = pick("crosschain", "venue", CROSSCHAIN_PROTOCOLS, v.venue);
    return isProblem(venue) ? venue : ok({ family: "crosschain", direction, by, venue });
  }
  if (v.chain === undefined)
    return fail("bad-parameter", "crosschain by chain needs chain, e.g. BTC");
  const chain = plotChainTicker(v.chain);
  if (chain === null) {
    return fail(
      "names-nothing",
      `${clip(v.chain.toUpperCase())} is not among the chains this tool can chart (${PLOT_CHAIN_TICKERS.join(", ")})`,
    );
  }
  return ok({ family: "crosschain", direction, by, chain });
}

/** A series' one spelling as text: its identity for dedupe, keys and order. */
export function seriesKey(spec: PlotSeriesSpec): string {
  return Object.values(spec).join(":");
}

/**
 * Every series the families can name, each once in its canonical spelling: what the colour test,
 * the source sweep and the layout suite run over, so a new parameter value is covered the day it
 * is added.
 */
export function allSeriesSpecs(): PlotSeriesSpec[] {
  const out: PlotSeriesSpec[] = [];
  for (const pool of POOL_NAMES) {
    for (const metric of POOL_METRICS) {
      if (!(metric === "notes" && pool === "sprout")) out.push({ family: "pool", pool, metric });
    }
  }
  for (const part of SUPPLY_PARTS) out.push({ family: "supply", part });
  for (const direction of FLOW_DIRECTIONS) out.push({ family: "shielding", direction });
  for (const kind of PLOT_TX_KINDS) out.push({ family: "transactions", kind });
  out.push({ family: "fees", stat: "total" });
  for (const kind of PLOT_TX_KINDS) out.push({ family: "fees", stat: "median", kind });
  for (const metric of MINING_METRICS) out.push({ family: "mining", metric });
  for (const metric of NETWORK_METRICS) out.push({ family: "network", metric });
  out.push({ family: "price" });
  for (const direction of FLOW_DIRECTIONS) {
    for (const measure of CROSSCHAIN_MEASURES) {
      out.push({ family: "crosschain", direction, by: "total", measure });
    }
    for (const chain of PLOT_CHAIN_TICKERS) {
      out.push({ family: "crosschain", direction, by: "chain", chain });
    }
    for (const venue of CROSSCHAIN_PROTOCOLS) {
      out.push({ family: "crosschain", direction, by: "venue", venue });
    }
  }
  return out;
}
