import type {
  HalvingEvent,
  MarketAsset,
  MempoolEntry,
  MiningOverview,
  MiningWindowKey,
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

/** A mining overview for the window asked for. Shallow version-skew check. */
export function isMiningOverview(b: unknown, window: MiningWindowKey): b is MiningOverview {
  if (typeof b !== "object" || b === null) return false;
  const o = b as Partial<MiningOverview>;
  const w = o.window;
  return (
    typeof w === "object" &&
    w !== null &&
    w.key === window &&
    isFiniteNumber(w.fromHeight) &&
    isFiniteNumber(w.toHeight) &&
    isFiniteNumber(w.blocks) &&
    isFiniteNumber(w.spanSeconds) &&
    isFiniteNumber(w.avgDifficulty) &&
    isFiniteNumber(w.avgTxCount) &&
    isFiniteOrNull(w.avgFeeZat) &&
    isFiniteOrNull(w.solutionsPerSecond) &&
    Array.isArray(o.groups) &&
    o.groups.every(
      (g) =>
        (g.address === null || typeof g.address === "string") &&
        (g.name === null || typeof g.name === "string") &&
        (g.basis === "self-declared" || g.basis === "external" || g.basis === "unattributed") &&
        isFiniteNumber(g.blocks) &&
        isFiniteNumber(g.selfDeclaredBlocks) &&
        isFiniteNumber(g.rewardZat) &&
        isFiniteOrNull(g.feeZat) &&
        isFiniteOrNull(g.avgIntervalSeconds),
    ) &&
    Array.isArray(o.trend) &&
    o.trend.every(
      (t) =>
        isFiniteNumber(t.timestamp) && isFiniteNumber(t.height) && isFiniteNumber(t.difficulty),
    ) &&
    typeof o.software === "object" &&
    o.software !== null &&
    isFiniteNumber(o.software.zebra) &&
    isFiniteNumber(o.software.unidentified)
  );
}
