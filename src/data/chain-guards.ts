import type {
  HalvingEvent,
  MarketAsset,
  MempoolEntry,
  MinerAddressRow,
  MinerSeries,
  MinerTotals,
  MinerUsdParts,
  MinersOverview,
  MinersWindowKey,
  MiningPoolBlocks,
  NsmDay,
  NsmOverview,
  PulseEdgeTotal,
  PulseRibbonWindow,
  ReorgEvent,
  RichListEntry,
  ShieldingFlowPoint,
} from "@/domain";
import { isFiniteNumber, isFiniteOrNull } from "@/lib/finite";
import { isTransaction } from "./shape-guards";

/**
 * Shape checks for the payloads only `chain-api-source.ts` reads. Like every guard here they
 * are version-skew tripwires against our own API, not validation against a hostile source.
 */

/**
 * Shape check for one market asset. Unlike the chain-data guards, numeric fields must be
 * finite: these figures originate with a third party, and a `NaN` would render as "$NaN"
 * beside a real ticker.
 */
export function isMarketAsset(value: unknown): value is MarketAsset {
  if (typeof value !== "object" || value === null) return false;
  const a = value as Record<string, unknown>;
  return (
    typeof a.id === "string" &&
    typeof a.symbol === "string" &&
    typeof a.name === "string" &&
    isFiniteNumber(a.marketCapUsd) &&
    isFiniteNumber(a.priceUsd) &&
    isFiniteNumber(a.circulatingSupply) &&
    (a.rank === null || typeof a.rank === "number") &&
    typeof a.isStablecoin === "boolean"
  );
}

function isSubsidySplit(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Record<string, unknown>;
  return (
    typeof s.totalZat === "number" &&
    typeof s.minerZat === "number" &&
    typeof s.fundingStreamsZat === "number" &&
    typeof s.lockboxZat === "number"
  );
}

/**
 * Shape check for one halving. Both `before` and `after` are required: the page's claim
 * is their difference, so serving only one would render a change of zero. `at` is null
 * for a halving still ahead.
 */
export function isHalvingEvent(value: unknown): value is HalvingEvent {
  if (typeof value !== "object" || value === null) return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e.height === "number" &&
    (e.at === null || typeof e.at === "number") &&
    isSubsidySplit(e.before) &&
    isSubsidySplit(e.after)
  );
}

/**
 * Shape check for one rich-list row. No `label` check: names are resolved from the address
 * by `addressLabel`, not sent on the wire, so a stray key is ignored.
 */
export function isRichListEntry(value: unknown): value is RichListEntry {
  if (typeof value !== "object" || value === null) return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e.rank === "number" &&
    typeof e.address === "string" &&
    typeof e.balanceZat === "number" &&
    typeof e.receivedZat === "number" &&
    typeof e.firstHeight === "number" &&
    typeof e.lastHeight === "number" &&
    // An explicit null is required and `undefined` rejected: a missing key means an API too
    // old to know the column, and treating that as "no count" would render an unknown as a fact.
    (e.txCount === null || typeof e.txCount === "number")
  );
}

export function isMempoolEntry(value: unknown): value is MempoolEntry {
  if (typeof value !== "object" || value === null) return false;
  const e = value as Record<string, unknown>;
  return (
    isTransaction(e.transaction) &&
    typeof e.seenAt === "number" &&
    typeof e.feeRateZatPerByte === "number" &&
    Array.isArray(e.dependsOn)
  );
}

export function isReorgEvent(value: unknown): value is ReorgEvent {
  if (typeof value !== "object" || value === null) return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e.id === "number" &&
    typeof e.detectedAt === "number" &&
    typeof e.height === "number" &&
    typeof e.depth === "number" &&
    typeof e.orphanedHash === "string" &&
    typeof e.replacedBy === "string"
  );
}

export function isShieldedPoolBalance(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const p = value as Record<string, unknown>;
  return typeof p.pool === "string" && typeof p.balanceZat === "number";
}

export function isDailyClose(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;
  return typeof c.day === "string" && typeof c.usd === "number";
}

export function isShieldingFlowPoint(value: unknown): value is ShieldingFlowPoint {
  if (typeof value !== "object" || value === null) return false;
  const f = value as Record<string, unknown>;
  return (
    typeof f.timestamp === "number" &&
    typeof f.shieldedZat === "number" &&
    typeof f.unshieldedZat === "number"
  );
}

/**
 * The pulse ribbons, which no client parser reads; the block, event and pool-close guards are
 * shared with the client in `shape-guards.ts`. Every amount must be finite: a NaN would size a
 * ribbon as a confident mark.
 */
function isPulseEdgeTotal(value: unknown): value is PulseEdgeTotal {
  if (typeof value !== "object" || value === null) return false;
  const e = value as Record<string, unknown>;
  return (
    isFiniteNumber(e.totalZat) &&
    isFiniteNumber(e.events) &&
    typeof e.from === "string" &&
    typeof e.to === "string"
  );
}

export function isPulseRibbonWindow(value: unknown): value is PulseRibbonWindow {
  if (typeof value !== "object" || value === null) return false;
  const w = value as Record<string, unknown>;
  const span = w.window as Record<string, unknown> | undefined;
  const unpaired = w.unpaired as Record<string, unknown> | undefined;
  if (span === undefined || unpaired === undefined) return false;
  return (
    isFiniteNumber(span.fromSeconds) &&
    isFiniteNumber(span.toSeconds) &&
    Array.isArray(w.edges) &&
    w.edges.every(isPulseEdgeTotal) &&
    // The remainder is what says what the drawn ribbons leave out; without it a payload cannot
    // state its own coverage.
    isFiniteNumber(unpaired.hubZat) &&
    isFiniteNumber(unpaired.hubTxs) &&
    isFiniteNumber(unpaired.multiMigrationZat) &&
    isFiniteNumber(unpaired.multiMigrationTxs)
  );
}

const isUsdParts = (u: unknown): boolean => {
  if (typeof u !== "object" || u === null) return false;
  const p = u as Partial<MinerUsdParts>;
  return isFiniteNumber(p.closedUsd) && isFiniteNumber(p.unpricedZat) && isFiniteNumber(p.todayZat);
};

const isMinerAddressRow = (r: unknown): boolean => {
  if (typeof r !== "object" || r === null) return false;
  const a = r as Partial<MinerAddressRow>;
  return (
    typeof a.address === "string" &&
    (a.miningPool === null || typeof a.miningPool === "string") &&
    isFiniteNumber(a.blocks) &&
    isFiniteOrNull(a.rewardZat) &&
    isFiniteOrNull(a.feeZat) &&
    isFiniteNumber(a.firstHeight) &&
    isFiniteNumber(a.lastHeight) &&
    isUsdParts(a.usd)
  );
};

const isMinerTotals = (t: unknown): boolean => {
  if (typeof t !== "object" || t === null) return false;
  const m = t as Partial<MinerTotals>;
  return (
    isFiniteNumber(m.blocks) &&
    isFiniteNumber(m.addresses) &&
    isFiniteOrNull(m.rewardZat) &&
    isFiniteOrNull(m.feeZat) &&
    isUsdParts(m.usd)
  );
};

/**
 * The miners overview for the window asked for. The window is checked, not displayed: an API that
 * ignored `?window=` would answer the default window under a different chip.
 */
export function isMinersOverview(b: unknown, window: MinersWindowKey): b is MinersOverview {
  if (typeof b !== "object" || b === null) return false;
  const o = b as Partial<MinersOverview>;
  return (
    o.window === window &&
    typeof o.fromDay === "string" &&
    typeof o.toDay === "string" &&
    isFiniteOrNull(o.fromHeight) &&
    isFiniteOrNull(o.toHeight) &&
    isFiniteNumber(o.daysComputed) &&
    isFiniteNumber(o.daysExpected) &&
    isFiniteNumber(o.blocks) &&
    isFiniteNumber(o.unrecordedBlocks) &&
    isFiniteNumber(o.shieldedBlocks) &&
    isFiniteNumber(o.noAddressBlocks) &&
    isMinerTotals(o.transparent) &&
    isMinerTotals(o.unattributed) &&
    Array.isArray(o.unattributed?.largest) &&
    o.unattributed.largest.every(isMinerAddressRow) &&
    Array.isArray(o.labelled) &&
    o.labelled.every(isMinerAddressRow) &&
    typeof o.topBlocks === "object" &&
    o.topBlocks !== null &&
    isFiniteNumber(o.topBlocks.top1) &&
    isFiniteNumber(o.topBlocks.top3) &&
    isFiniteNumber(o.topBlocks.top10) &&
    Array.isArray(o.registry) &&
    o.registry.every((a) => typeof a === "string")
  );
}

/** A miners series at the interval asked for. */
export function isMinerSeries(b: unknown, interval: "month" | "day"): b is MinerSeries {
  if (typeof b !== "object" || b === null) return false;
  const s = b as Partial<MinerSeries>;
  return (
    s.interval === interval &&
    typeof s.fromDay === "string" &&
    typeof s.toDay === "string" &&
    Array.isArray(s.periods) &&
    s.periods.every(
      (p) =>
        typeof p.period === "string" &&
        isFiniteNumber(p.blocks) &&
        isFiniteOrNull(p.firstHeight) &&
        isFiniteOrNull(p.lastHeight) &&
        typeof p.partial === "boolean",
    ) &&
    Array.isArray(s.points) &&
    s.points.every(
      (p) =>
        typeof p.period === "string" &&
        typeof p.group === "string" &&
        isFiniteNumber(p.blocks) &&
        isFiniteOrNull(p.rewardZat) &&
        isFiniteOrNull(p.feeZat),
    )
  );
}

/** One pool's newest blocks, for the pool asked for. */
export function isMiningPoolBlocks(b: unknown, id: string): b is MiningPoolBlocks {
  if (typeof b !== "object" || b === null) return false;
  const o = b as Partial<MiningPoolBlocks>;
  return (
    o.miningPool === id &&
    Array.isArray(o.blocks) &&
    o.blocks.every(
      (x) =>
        isFiniteNumber(x.height) &&
        isFiniteNumber(x.timestamp) &&
        typeof x.address === "string" &&
        isFiniteOrNull(x.rewardZat),
    )
  );
}

function isNsmDay(d: unknown): d is NsmDay {
  if (typeof d !== "object" || d === null) return false;
  const x = d as Partial<NsmDay>;
  return (
    typeof x.day === "string" &&
    isFiniteNumber(x.blocks) &&
    isFiniteOrNull(x.feeZat) &&
    isFiniteOrNull(x.nsmZat) &&
    // One is never known without the other: a lone figure is a server bug, not a day.
    (x.feeZat === null) === (x.nsmZat === null) &&
    isFiniteOrNull(x.closeUsd) &&
    typeof x.partial === "boolean"
  );
}

/** The NSM's days and balance. A null balance is the node not answering, and is allowed. */
export function isNsmOverview(b: unknown): b is NsmOverview {
  if (typeof b !== "object" || b === null) return false;
  const o = b as Partial<NsmOverview>;
  const balance = o.balance;
  return (
    isFiniteNumber(o.activationHeight) &&
    (o.activationDay === null || typeof o.activationDay === "string") &&
    (balance === null ||
      (typeof balance === "object" &&
        balance !== undefined &&
        isFiniteNumber(balance.height) &&
        isFiniteOrNull(balance.zat) &&
        isFiniteOrNull(balance.carriedInZat))) &&
    Array.isArray(o.days) &&
    o.days.every(isNsmDay)
  );
}
