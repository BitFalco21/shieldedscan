import {
  estimateSecondsBetween,
  MAX_SUPPLY_ZAT,
  minerRewardZat,
  type ChainMonthPoint,
  type CrossChainFlowSummary,
  type CrossChainTransfer,
  type MempoolStats,
  type ReorgEvent,
  type ReorgSummary,
  type AddressLabel,
  MINING_POOLS,
  type MiningPoolLabel,
  type LabelledBalances,
  type RichListEntry,
  type RichListSummary,
  type SupplyBreakdown,
  type BlockSummary,
  type Transaction,
  assetTickerIsKnown,
  classifyZcashAddress,
  fullyShieldedPct,
  minedZat,
  monthNetFlowZat,
  monthTotalTxs,
  poolMigration,
  publicValueZat,
  reportsValueBalance,
  netShieldedZat,
  shieldedZat,
  txActionText,
  txDirection,
  txKind,
  txPools,
  unminedZat,
  circulatingZat,
  type HalvingEvent,
  type UpgradeNetwork,
  MINERS_HISTORY_FROM_DAY,
  MINING_POOL_LABELS,
  NO_ADDRESS_GROUP,
  NSM_FEE_SHARE_PCT,
  SHIELDED_GROUP,
  UNATTRIBUTED_GROUP,
  groupMinersByPool,
  minerValueUsd,
  nsmWindow,
  type MinerAddressRow,
  isShieldedCapableKind,
  poolsToMajority,
  type MinerSeries,
  type PoolMajority,
  type MinersOverview,
  type MinersWindowKey,
  type MinerUsdParts,
  type MiningPool,
  type MiningPoolBlock,
  type MiningPoolGroup,
  type MiningPoolId,
  type NsmOverview,
} from "@/domain";
import { unspendablePools } from "@/domain/consensus";
import type { AddressKindBucket, CrossChainEdgeRow, VenueHealth } from "@/data/crosschain/store";
import type {
  V1Label,
  V1Labels,
  V1ChainDestinations,
  V1DestinationBucket,
  V1Destinations,
  V1FloorCoverage,
  V1Flows,
  V1MempoolSummary,
  V1Monthly,
  V1MonthPoint,
  V1PoolBalance,
  V1ReorgEvent,
  V1ReorgSummary,
  V1Share,
  V1Supply,
  V1TransactionPrivacy,
  V1Transfer,
  V1Unknowns,
  V1CirculatingSupply,
  V1Halving,
  V1SubsidyBreakdown,
  V1SubsidyStream,
  V1TransactionListItem,
  V1Block,
  V1TransactionDetail,
  V1TxSide,
  V1RichListEntry,
  V1RichListDistribution,
  V1Amount,
  V1BlockCount,
  V1MinerRow,
  V1MiningPool,
  V1MiningPoolAddress,
  V1MiningPoolBlock,
  V1MiningPools,
  V1MiningPoolSeries,
  V1PoolMajority,
  V1MiningPoolSummary,
  V1MiningSeriesCell,
  V1MiningSeriesGroup,
  V1MiningWindow,
  V1MiningWindowKey,
  V1Nsm,
  V1NsmDay,
  V1ValueUsd,
} from "./dto";
import type { RpcBlockSubsidy, RpcSubsidyStream } from "../node-rpc";
import { zec } from "./format";

/**
 * Domain → wire: the one place the two vocabularies meet, built on the domain's derived
 * functions (`txKind`, `netShieldedZat`, `poolMigration`…) so /v1 states exactly the facts the
 * site states, in shapes the site is free to abandon. Pure functions throughout.
 */

const now = () => Math.floor(Date.now() / 1000);

export function share(numerator: number, denominator: number): V1Share | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return null;
  }
  return { pct: Number(((numerator / denominator) * 100).toFixed(2)), numerator, denominator };
}

/** Attach `unknowns` only when it says something — an empty object is noise. */
function withUnknowns<T extends object>(resource: T, unknowns: V1Unknowns): T {
  return Object.keys(unknowns).length === 0 ? resource : { ...resource, unknowns };
}

// ------------------------------------------------------------------------------ supply

export function toSupply(
  breakdown: SupplyBreakdown,
  allSixReported: boolean,
  network: UpgradeNetwork,
): V1Supply {
  const shielded = shieldedZat(breakdown);
  const unspendable = unspendablePools(network, breakdown.height);
  const pools: V1PoolBalance[] = breakdown.pools.map((p) => {
    const isShielded = p.pool !== "transparent" && p.pool !== "lockbox";
    return {
      pool: p.pool,
      balanceZat: p.balanceZat,
      shielded: isShielded,
      spendable: !unspendable.includes(p.pool),
      shareOfShielded: isShielded ? share(p.balanceZat, shielded) : null,
    };
  });
  return {
    heightReadAt: breakdown.height,
    maxSupplyZat: MAX_SUPPLY_ZAT,
    minedZat: minedZat(breakdown),
    unminedZat: unminedZat(breakdown),
    nsmZat: breakdown.nsmZat,
    shieldedZat: shielded,
    shieldedZatExcludes: ["lockbox"],
    pools,
    partitionComplete: allSixReported,
    asOf: now(),
  };
}

// ------------------------------------------------------------- blocks and transactions

export function toBlock(b: BlockSummary, fees: "stated" | "omitted"): V1Block {
  const unknowns: V1Unknowns = {};
  let totalFeeZat = b.totalFeeZat;
  if (fees === "omitted") {
    // A list page served from the node never resolves inputs, so a fee there would be a per-row
    // node walk. Stated as `omitted` (the detail endpoint has it). A page served from the index
    // states it, read off the block row.
    totalFeeZat = null;
    unknowns.totalFeeZat = "omitted";
  } else if (totalFeeZat === null) {
    unknowns.totalFeeZat = "indeterminate";
  }
  // Every block parsed from the node carries its per-pool counts; one that did not came from
  // somewhere that never counted them, which is our gap, not the chain's.
  if (!b.composition.byPool) unknowns["contents.pools"] = "unmeasured";
  /*
   * The reward, on both views: read off the coinbase the block already carries, so no input
   * resolution is needed.
   *
   * A shielded coinbase (ZIP 213) pays a pool, so the amount is encrypted and both figures are
   * null with reason `shielded`, never `unmeasured` (which would blame our index for Zcash working
   * as intended). Anything else that leaves the reward unreadable is `indeterminate`.
   */
  const minerReward = minerRewardZat(b);
  if (b.blockRewardZat === null) {
    unknowns.blockRewardZat = b.miner.kind === "shielded" ? "shielded" : "indeterminate";
  }
  if (minerReward === null) {
    unknowns.minerRewardZat = b.miner.kind === "shielded" ? "shielded" : "indeterminate";
  }
  return withUnknowns(
    {
      height: b.height,
      hash: b.hash,
      prevHash: b.prevHash,
      timestamp: b.timestamp,
      sizeBytes: b.sizeBytes,
      txCount: b.txCount,
      difficulty: b.difficulty,
      minerKind: b.miner.kind,
      minerAddress: b.miner.kind === "transparent" ? b.miner.address : null,
      coinbaseTag: b.coinbaseTag ?? null,
      contents: {
        transparent: b.composition.transparentTxs,
        mixed: b.composition.mixedTxs,
        shielded: b.composition.shieldedTxs,
        pools: b.composition.byPool
          ? {
              ironwood: b.composition.byPool.ironwood,
              orchard: b.composition.byPool.orchard,
              sapling: b.composition.byPool.sapling,
              sprout: b.composition.byPool.sprout,
            }
          : null,
      },
      totalFeeZat,
      blockRewardZat: b.blockRewardZat,
      minerRewardZat: minerReward,
      fundingStreams: b.fundingStreams.map(toV1Side),
    },
    unknowns,
  );
}

/** "" is the wire's own no-address marker; the public layer states it as null. */
const toV1Side = (s: { address: string; valueZat: number }): V1TxSide => ({
  address: s.address === "" ? null : s.address,
  valueZat: s.valueZat,
});

/**
 * How many transparent entries one response carries per side. The widest mainnet transaction
 * has 13,538 inputs (~900 KB serialised), too much for a keyless endpoint without a cap.
 *
 * The true count is always emitted, `truncated` names exactly what was withheld, and
 * `?inputsFrom=` returns the rest, so nothing is unreachable or mistakable for complete.
 */
export const MAX_TX_SIDE_ENTRIES = 1_000;

export function toTransactionDetail(
  tx: Transaction,
  includeRaw: boolean,
  window: { inputsFrom?: number; outputsFrom?: number } = {},
  crossings: { total: number; transfers: CrossChainTransfer[] } | null = null,
): V1TransactionDetail {
  const unknowns: V1Unknowns = {};
  if (crossings === null) unknowns.crosschain = "unmeasured";
  if (tx.feeZat === null) unknowns.feeZat = tx.isCoinbase ? "nonexistent" : "indeterminate";
  const inputsFrom = Math.max(0, window.inputsFrom ?? 0);
  const outputsFrom = Math.max(0, window.outputsFrom ?? 0);
  const inputs = tx.transparentInputs.slice(inputsFrom, inputsFrom + MAX_TX_SIDE_ENTRIES);
  const outputs = tx.transparentOutputs.slice(outputsFrom, outputsFrom + MAX_TX_SIDE_ENTRIES);
  const truncated: NonNullable<V1TransactionDetail["truncated"]> = {};
  if (inputsFrom + inputs.length < tx.transparentInputs.length) {
    truncated.transparentInputs = {
      returned: inputs.length,
      total: tx.transparentInputs.length,
      resumeWith: `inputsFrom=${inputsFrom + inputs.length}`,
    };
  }
  if (outputsFrom + outputs.length < tx.transparentOutputs.length) {
    truncated.transparentOutputs = {
      returned: outputs.length,
      total: tx.transparentOutputs.length,
      resumeWith: `outputsFrom=${outputsFrom + outputs.length}`,
    };
  }
  const detail: V1TransactionDetail = withUnknowns(
    {
      txid: tx.txid,
      blockHeight: tx.blockHeight,
      blockHash: tx.blockHash,
      timestamp: tx.timestamp,
      sizeBytes: tx.sizeBytes,
      version: tx.version,
      lockTime: tx.lockTime,
      expiryHeight: tx.expiryHeight,
      kind: txKind(tx),
      direction: txDirection(tx),
      pools: txPools(tx),
      feeZat: tx.feeZat,
      transparentInputs: inputs.map(toV1Side),
      transparentOutputs: outputs.map(toV1Side),
      // Never capped, never omitted: the count is the fact, the array is a window onto it.
      transparentInputCount: tx.transparentInputs.length,
      transparentOutputCount: tx.transparentOutputs.length,
      bundles: {
        sprout: tx.sprout,
        sapling: tx.sapling,
        orchard: tx.orchard,
        ironwood: tx.ironwood,
      },
      summary: txActionText(tx),
      crosschain:
        crossings === null
          ? null
          : { total: crossings.total, transfers: crossings.transfers.map(toTransfer) },
      asOf: Math.floor(Date.now() / 1000),
    },
    unknowns,
  );
  if (Object.keys(truncated).length > 0) detail.truncated = truncated;
  if (includeRaw && tx.rawHex !== null) detail.rawHex = tx.rawHex;
  return detail;
}

export function toTransactionListItem(tx: Transaction): V1TransactionListItem {
  const unknowns: V1Unknowns = {};
  if (tx.feeZat === null) unknowns.feeZat = tx.isCoinbase ? "nonexistent" : "indeterminate";
  return withUnknowns(
    {
      txid: tx.txid,
      // The index serves confirmed rows only, so height and hash are always present here;
      // the fallbacks satisfy the type without ever firing.
      blockHeight: tx.blockHeight ?? 0,
      blockHash: tx.blockHash ?? "",
      timestamp: tx.timestamp,
      sizeBytes: tx.sizeBytes,
      kind: txKind(tx),
      direction: txDirection(tx),
      pools: txPools(tx),
      feeZat: tx.feeZat,
    },
    unknowns,
  );
}

export function toTransactionPrivacy(tx: Transaction): V1TransactionPrivacy {
  const unknowns: V1Unknowns = {};

  const reports = reportsValueBalance(tx);
  const net = reports ? netShieldedZat(tx) : null;
  /*
   * `unmeasured` for Sprout, not `shielded`. `shielded` means encrypted on-chain, knowable by
   * nobody. Sprout's public values are published per JoinSplit (`vpub_old`/`vpub_new`), but
   * `SproutBundle` carries a JoinSplit count and no value, so the figure never reaches this
   * mapper: it is our gap, not Zcash's design, and labelling it `shielded` would overstate what
   * the protocol conceals.
   *
   * `nonexistent` on the other branch: no shielded pool on the transaction means there is no net
   * shielded flow to know.
   *
   * Fixing it means carrying the balance on `SproutBundle`, which makes `reportsValueBalance` true
   * for Sprout and changes every consumer of `netShieldedZat`.
   */
  if (!reports) unknowns["netShieldedZat"] = tx.sprout ? "unmeasured" : "nonexistent";

  const publicValue = publicValueZat(tx);
  if (publicValue === null) unknowns["publicValueZat"] = "shielded";

  const migration = poolMigration(tx);

  return withUnknowns(
    {
      txid: tx.txid,
      blockHeight: tx.blockHeight,
      kind: txKind(tx),
      direction: txDirection(tx),
      pools: txPools(tx),
      netShieldedZat: net,
      netShieldedBasis:
        "sapling + orchard + ironwood value balances; sprout publishes no per-bundle balance",
      publicValueZat: publicValue,
      migration,
      bundles: {
        sprout: tx.sprout,
        sapling: tx.sapling,
        orchard: tx.orchard,
        ironwood: tx.ironwood,
      },
      // The chain's silences as data: a consumer's tests can assert this API never claims who
      // paid whom.
      notKnowable: ["sender", "recipient", "payment-vs-change-split", "shielded-amounts"],
      asOf: now(),
    },
    unknowns,
  );
}

// --------------------------------------------------------------------------- cross-chain

/**
 * The floor every cross-chain response states. `of: "totals"` adds what a total leaves out and a
 * list does not: a pending or refunded transfer moved no ZEC across (`countsTowardTotals`), while
 * a list shows it with its status.
 */
export function toFloorCoverage(
  venues: (VenueHealth & { enabled: boolean })[],
  firstAt: number | null,
  lastAt: number | null,
  of: "transfers" | "totals",
): V1FloorCoverage {
  return {
    basis: "floor",
    scope: "public-swap-protocols",
    // Stated in the payload: no public per-transfer API for custodial routes, and aggregators
    // settle on these same venues — counting them would double-count.
    excludes: [
      "custodial-routes",
      "aggregators",
      ...(of === "totals" ? ["pending-or-refunded-transfers"] : []),
    ],
    venues: venues.map((v) => ({ protocol: v.protocol, enabled: v.enabled, live: v.live })),
    firstAt,
    lastAt,
  };
}

export function toTransfer(t: CrossChainTransfer): V1Transfer {
  const unknowns: V1Unknowns = {};
  const tickerKnown = assetTickerIsKnown(t.counterpartAsset);
  if (!tickerKnown) unknowns["legs.counterpart.asset"] = "unmeasured";
  if (t.counterpartAmount === null) unknowns["legs.counterpart.amount"] = "unmeasured";
  if (t.usdValueAtSwap === null) unknowns["legs.zcash.usdAtSwap"] = "unmeasured";
  if (t.counterpartUsdAtSwap === null) unknowns["legs.counterpart.usdAtSwap"] = "unmeasured";
  if (t.venueDepositAddress === null) unknowns["venueRecordKey"] = "nonexistent";

  return withUnknowns(
    {
      id: t.id,
      protocol: t.protocol,
      direction: t.direction,
      status: t.status,
      timestamp: t.timestamp,
      zecAmountZat: t.zecAmountZat,
      legs: {
        zcash: {
          chain: "ZEC",
          asset: "ZEC",
          amount: t.zecAmountZat / 1e8,
          usdAtSwap: t.usdValueAtSwap,
          txHash: t.zcashTxid,
          address: t.zcashAddress,
          addressKind: classifyZcashAddress(t.zcashAddress),
        },
        counterpart: {
          chain: t.counterpartChain,
          // "<CHAIN> asset" is the parser's placeholder, not a ticker; it must not be rendered as
          // one.
          asset: tickerKnown ? t.counterpartAsset : null,
          amount: t.counterpartAmount,
          usdAtSwap: t.counterpartUsdAtSwap,
          txHash: t.counterpartTxHash,
          address: t.counterpartAddress,
        },
      },
      counterpartIsSynthetic: t.counterpartIsSynthetic,
      venueRecordKey: t.venueDepositAddress,
    },
    unknowns,
  );
}

export function toFlows(
  summary: CrossChainFlowSummary,
  venues: (VenueHealth & { enabled: boolean })[],
): V1Flows {
  const side = (direction: "in" | "out") => {
    const flows = summary.flows
      .filter((f) => f.direction === direction)
      .sort((a, b) => b.zecAmountZat - a.zecAmountZat)
      .map((f) => ({
        chain: f.chain,
        transfers: f.transfers,
        zecAmountZat: f.zecAmountZat,
        usdAtSwap: f.usdAtSwap,
        usdCoveredTransfers: f.usdCoveredTransfers,
      }));
    // The side totals are emitted so nothing downstream has to add the rows up — the same
    // reason `/v1` publishes both terms of every percentage.
    const total = (pick: (f: (typeof flows)[number]) => number) =>
      flows.reduce((sum, f) => sum + pick(f), 0);
    return {
      transfers: total((f) => f.transfers),
      zecAmountZat: total((f) => f.zecAmountZat),
      usdAtSwap: total((f) => f.usdAtSwap),
      usdCoveredTransfers: total((f) => f.usdCoveredTransfers),
      flows,
    };
  };
  const empty = summary.flows.length === 0;
  return {
    coverage: toFloorCoverage(
      venues,
      empty ? null : summary.firstAt,
      empty ? null : summary.lastAt,
      "totals",
    ),
    in: side("in"),
    out: side("out"),
    asOf: now(),
  };
}

export type V1DestinationsApplied = V1Destinations["applied"];

/** Buckets by landing family, largest ZEC first, with each one's shielded-capable flag. */
function destinationBuckets(rows: readonly AddressKindBucket[]): V1DestinationBucket[] {
  const byKind = new Map<string, AddressKindBucket>();
  for (const r of rows) {
    const key = r.kind ?? "none";
    const b = byKind.get(key) ?? { kind: r.kind, transfers: 0, zecAmountZat: 0 };
    b.transfers += r.transfers;
    b.zecAmountZat += r.zecAmountZat;
    byKind.set(key, b);
  }
  return [...byKind.values()]
    .sort((a, b) => b.zecAmountZat - a.zecAmountZat || b.transfers - a.transfers)
    .map((b) => ({
      addressKind: b.kind,
      // A capability claim, not a privacy claim: unified is shielded-CAPABLE, and which
      // receiver was used is not public. null kind → null, not false.
      shieldedCapable: isShieldedCapableKind(b.kind),
      transfers: b.transfers,
      zecAmountZat: b.zecAmountZat,
    }));
}

/** Of the classified transfers, the share on a shielded-capable address; null over none. */
function capableShare(buckets: readonly V1DestinationBucket[]): V1Share | null {
  const classified = buckets.filter((b) => b.shieldedCapable !== null);
  const capable = classified.filter((b) => b.shieldedCapable === true);
  return share(
    capable.reduce((sum, b) => sum + b.transfers, 0),
    classified.reduce((sum, b) => sum + b.transfers, 0),
  );
}

/**
 * The null bucket's reason: `unmeasured` rather than `indeterminate`, because the venue
 * published no Zcash-side address at all, so there is nothing to reason from. The head poller
 * re-upserts rows, so a venue that starts publishing addresses does reclassify them.
 */
function markUnpublished(buckets: readonly V1DestinationBucket[], path: string, u: V1Unknowns) {
  buckets.forEach((b, i) => {
    if (b.addressKind !== null) return;
    u[`${path}[${i}].addressKind`] = "unmeasured";
    u[`${path}[${i}].shieldedCapable`] = "unmeasured";
  });
}

/**
 * `/v1/crosschain/destinations` from the per-(chain, direction, family) rows of one window, already
 * narrowed to the direction and chain asked. The totals and every chain's row come from the same
 * rows, so they cannot disagree.
 */
export function toDestinations(
  applied: V1DestinationsApplied,
  rows: readonly CrossChainEdgeRow[],
  venues: (VenueHealth & { enabled: boolean })[],
): V1Destinations {
  const asBucket = (r: CrossChainEdgeRow): AddressKindBucket => ({
    kind: r.addressKind,
    transfers: r.transfers,
    zecAmountZat: r.zecAmountZat,
  });
  const buckets = destinationBuckets(rows.map(asBucket));
  const unknowns: V1Unknowns = {};
  markUnpublished(buckets, "buckets", unknowns);

  let chains: V1ChainDestinations[] | undefined;
  if (applied.groupBy === "chain") {
    const byChain = new Map<string, AddressKindBucket[]>();
    for (const r of rows) byChain.set(r.chain, [...(byChain.get(r.chain) ?? []), asBucket(r)]);
    chains = [...byChain]
      .map(([chain, chainRows]) => {
        const chainBuckets = destinationBuckets(chainRows);
        return {
          chain,
          transfers: chainBuckets.reduce((sum, b) => sum + b.transfers, 0),
          buckets: chainBuckets,
          shieldedCapableShare: capableShare(chainBuckets),
        };
      })
      .sort((a, b) => b.transfers - a.transfers || (a.chain < b.chain ? -1 : 1));
    chains.forEach((c, i) => {
      markUnpublished(c.buckets, `chains[${i}].buckets`, unknowns);
      if (c.shieldedCapableShare === null)
        unknowns[`chains[${i}].shieldedCapableShare`] = "unmeasured";
    });
  }

  return withUnknowns(
    {
      direction: applied.direction,
      applied,
      coverage: toFloorCoverage(venues, null, null, "totals"),
      buckets,
      shieldedCapableShare: capableShare(buckets),
      ...(chains === undefined ? {} : { chains }),
      shareDenominator: "transfers whose venue published a classifiable Zcash-side address",
      receiverUsedIsNotPublic: true as const,
      asOf: now(),
    },
    unknowns,
  );
}

// -------------------------------------------------------------------------------- reorgs

export function toReorgEvent(event: ReorgEvent): V1ReorgEvent {
  return {
    detectedAt: event.detectedAt,
    height: event.height,
    depth: event.depth,
    orphanedHash: event.orphanedHash,
    replacedBy: event.replacedBy,
  };
}

export function toReorgSummary(summary: ReorgSummary, pollIntervalSeconds: number): V1ReorgSummary {
  const unknowns: V1Unknowns = summary.deepestDepth === null ? { deepestDepth: "nonexistent" } : {};
  return withUnknowns(
    {
      scope: {
        basis: "observed" as const,
        observer: "single-node" as const,
        networkCensus: false as const,
        observingSince: summary.observingSince,
        pollIntervalSeconds,
        detectionLimit:
          "a block orphaned and replaced between two polls is never observed; depth-1 reorgs are routine on proof of work",
      },
      observedCount: summary.observedCount,
      deepestDepth: summary.deepestDepth,
      asOf: now(),
    },
    unknowns,
  );
}

// ------------------------------------------------------------------------------- mempool

export function toMempoolSummary(stats: MempoolStats): V1MempoolSummary {
  const unknowns: V1Unknowns = {};
  if (stats.medianFeeZat === null) unknowns["medianFeeZat"] = "unmeasured";
  if (stats.medianFeeRateZatPerByte === null) {
    unknowns["medianFeeRateZatPerByte"] = "unmeasured";
  }
  if (stats.composition === null) unknowns["composition"] = "unmeasured";

  return withUnknowns(
    {
      pendingCount: stats.pendingCount,
      totalSizeBytes: stats.totalSizeBytes,
      medianFeeZat: stats.medianFeeZat,
      medianFeeRateZatPerByte: stats.medianFeeRateZatPerByte,
      composition:
        stats.composition === null
          ? null
          : {
              coverage: {
                basis: "sample" as const,
                sampled: stats.composition.sampled,
                population: stats.pendingCount,
                extrapolated: false as const,
              },
              transparent: stats.composition.transparent,
              mixed: stats.composition.mixed,
              shielded: stats.composition.shielded,
            },
      asOf: now(),
    },
    unknowns,
  );
}

// ------------------------------------------------------------------------------ analytics

export function toMonthly(series: ChainMonthPoint[], from?: number, to?: number): V1Monthly {
  const bounded = series.filter(
    (p) => (from === undefined || p.timestamp >= from) && (to === undefined || p.timestamp <= to),
  );
  const points: V1MonthPoint[] = bounded.map((p) => {
    const total = monthTotalTxs(p);
    return {
      periodStart: p.timestamp,
      topHeight: p.topHeight,
      txs: { transparent: p.transparentTxs, mixed: p.mixedTxs, shielded: p.shieldedTxs },
      balances: {
        sprout: p.sproutZat,
        sapling: p.saplingZat,
        orchard: p.orchardZat,
        ironwood: p.ironwoodZat,
      },
      // Differenced against the PREVIOUS point in the bounded slice's parent series —
      // index into `series`, not `bounded`, or the first month of every range would
      // report its whole balance as that month's inflow.
      netFlowZat: monthNetFlowZat(series, series.indexOf(p)),
      fullyShieldedShare: {
        pct: Number(fullyShieldedPct(p).toFixed(2)),
        numerator: p.shieldedTxs,
        denominator: total,
      },
      poolTouchingShare: {
        pct: total === 0 ? 0 : Number((((p.shieldedTxs + p.mixedTxs) / total) * 100).toFixed(2)),
        numerator: p.shieldedTxs + p.mixedTxs,
        denominator: total,
      },
    };
  });
  const first = bounded[0]?.timestamp ?? 0;
  const last = bounded[bounded.length - 1]?.timestamp ?? 0;
  return {
    interval: "month",
    balanceBasis: "period-closing-at-top-height",
    coinbase: "excluded",
    range: { from: first, to: last },
    points,
    asOf: now(),
  };
}

// ------------------------------------------------------------------ supply and halving

export function toCirculating(
  breakdown: SupplyBreakdown,
  network: UpgradeNetwork,
): V1CirculatingSupply {
  const circulating = circulatingZat(breakdown, network);
  return {
    circulatingZat: circulating,
    circulatingZec: zec(circulating),
    heightReadAt: breakdown.height,
    // The unspendable pools, and the NSM balance, which is in no pool and so never in the sum.
    excludes: [...unspendablePools(network, breakdown.height), "nsm"],
    asOf: now(),
  };
}

/** The node's `getblocksubsidy` reply, less the pre-Canopy founders' reward nothing here reads. */
type NodeSubsidy = Omit<RpcBlockSubsidy, "founders">;

/** The node reports ZEC floats; the wire speaks zatoshis. Round per field — the node's own
 *  figures are exact multiples of 1e-8, so rounding only undoes float representation. */
export function toSubsidyBreakdown(s: NodeSubsidy): V1SubsidyBreakdown {
  const zat = (zec: number) => Math.round(zec * 100_000_000);
  const totalZat = zat(s.totalblocksubsidy);
  // `valueZat` is the node's own integer and is trusted as-is; `value` is the float beside it
  // and is only a fallback for a node that omits the integer, which this one does not.
  const stream = (n: RpcSubsidyStream): V1SubsidyStream => {
    const valueZat = Number.isFinite(n.valueZat) ? n.valueZat : zat(n.value);
    return {
      recipient: n.recipient,
      specification: n.specification ?? "",
      valueZat,
      address: n.address ?? null,
      share: share(valueZat, totalZat),
    };
  };
  return {
    totalZat,
    minerZat: zat(s.miner),
    fundingStreamsZat: zat(s.fundingstreamstotal),
    lockboxZat: zat(s.lockboxtotal),
    minerShare: share(zat(s.miner), totalZat),
    fundingStreamsShare: share(zat(s.fundingstreamstotal), totalZat),
    lockboxShare: share(zat(s.lockboxtotal), totalZat),
    // Absent arrays are an absence of streams at this height, not an unknown: the node omits
    // them precisely when none is active. `[]` is the measurement, so no `unknowns` entry.
    fundingStreams: (s.fundingstreams ?? []).map(stream),
    lockboxStreams: (s.lockboxstreams ?? []).map(stream),
  };
}

/**
 * `intervalSeconds` is the observed mean block interval within the tip's era, 0 when it could not
 * be measured.
 *
 * Blocks before NU7 run at that observed pace and blocks after it at the 25-second target. The
 * arithmetic lives once, in `estimateSecondsBetween`, which the site's `/halving` page also calls,
 * so the two cannot publish different dates.
 */
export function toHalving(
  height: number,
  halvingHeight: number,
  current: NodeSubsidy,
  next: NodeSubsidy,
  intervalSeconds = 0,
  events: readonly HalvingEvent[] = [],
): V1Halving {
  const blocksRemaining = Math.max(0, halvingHeight - height);
  const seconds = estimateSecondsBetween(height, halvingHeight, intervalSeconds);
  return {
    height,
    halvingHeight,
    blocksRemaining,
    estimatedSecondsRemaining: seconds,
    estimatedAt: new Date((now() + seconds) * 1000).toISOString(),
    currentSubsidy: toSubsidyBreakdown(current),
    nextSubsidy: toSubsidyBreakdown(next),
    events: events.map((e) => ({
      kind: e.kind,
      height: e.height,
      at: e.at,
      atUtc: e.at === null ? null : new Date(e.at * 1000).toISOString(),
      before: { ...e.before },
      after: { ...e.after },
    })),
    asOf: now(),
  };
}

// --------------------------------------------------------------------------- rich list

/**
 * What a label is and is not. Carried on every `/v1/labels` response, so the names never travel
 * without it: a name is someone's claim about a real company or person, not a chain fact.
 */
export const LABELS_NOTICE =
  "An `entity` name is a third-party attribution, repeated as its source states it and not verified by this explorer; `source` says whose claim it is. A `mining-pool` name marks a pool's payout address, reviewed by this explorer against the pool's own data or its own coinbase marker (`basis`); it names the pool, never the miners it pays. A label covers exactly its address: never extend it to addresses that transact with it. Balances are transparent only, and one address can hold many people's coins, so a balance is a wallet's total, not one holder's. Anything held in shielded addresses cannot be enumerated by anyone.";

/** What a pool label's `source` says: who reviewed it, never the evidence itself. */
const POOL_LABEL_SOURCE = "reviewed by this explorer";

/**
 * The labelled addresses, domain → wire, in the label table's order.
 *
 * A null rank says why. With no balance the address is on no rich list (`nonexistent`, a
 * measurement); a balance without a rank would be our gap (`unmeasured`), which counting at read
 * time no longer produces.
 */
export function toLabels(
  balances: LabelledBalances,
  labels: Readonly<Record<string, AddressLabel>>,
  asOf: number,
  poolLabels: Readonly<Record<string, MiningPoolLabel>> = {},
): V1Labels {
  const items: V1Label[] = balances.items.flatMap((item): V1Label[] => {
    const label = labels[item.address];
    const poolLabel = poolLabels[item.address];
    const unknowns: V1Unknowns =
      item.rank === null ? { rank: item.balanceZat === 0 ? "nonexistent" : "unmeasured" } : {};
    const held = { balanceZat: item.balanceZat, rank: item.rank };
    if (label) {
      return [
        withUnknowns(
          {
            address: item.address,
            name: label.name,
            basis: label.basis,
            category: "entity",
            miningPool: null,
            source: label.source,
            flag: label.flag ? { by: label.flag.by, url: label.flag.href } : null,
            ...held,
          } satisfies V1Label,
          unknowns,
        ),
      ];
    }
    if (!poolLabel) return [];
    const pool = MINING_POOLS[poolLabel.miningPool];
    return [
      withUnknowns(
        {
          address: item.address,
          name: pool.name,
          basis: poolLabel.basis,
          category: "mining-pool",
          miningPool: { id: pool.id, name: pool.name },
          source: POOL_LABEL_SOURCE,
          flag: null,
          ...held,
        } satisfies V1Label,
        unknowns,
      ),
    ];
  });
  return {
    notice: LABELS_NOTICE,
    count: items.length,
    labels: items,
    rankHeight: balances.rankAsOfHeight,
    asOf,
  };
}

/**
 * One holder, domain → wire.
 *
 * No name on this row: names travel only through `/v1/labels`, where each carries its source and
 * the notice that qualifies it. A bare name on a balance row would read as a chain fact.
 *
 * `txCount` keeps its null and states why. `Number(null)` is 0, and a fabricated 0 passes every
 * downstream `typeof x === "number"` check exactly as a measurement does.
 */
export function toRichListEntry(entry: RichListEntry): V1RichListEntry {
  return withUnknowns(
    {
      rank: entry.rank,
      address: entry.address,
      balanceZat: entry.balanceZat,
      receivedZat: entry.receivedZat,
      firstHeight: entry.firstHeight,
      lastHeight: entry.lastHeight,
      txCount: entry.txCount,
    },
    entry.txCount === null ? { txCount: "unmeasured" } : {},
  );
}

/**
 * The distribution, domain → wire.
 *
 * Every share is computed against `totalZat` (transparent value) and carries that denominator,
 * since a reader assumes circulating supply, which is about a third larger. `unattributedZat`
 * is the gap between this total and the node's transparent value pool.
 */
export function toRichListDistribution(summary: RichListSummary): V1RichListDistribution {
  return {
    height: summary.height,
    addressCount: summary.addressCount,
    totalZat: summary.totalZat,
    unattributedZat: summary.unattributedZat,
    bands: summary.bands.map((band) => ({
      fromZat: band.fromZat,
      addresses: band.addresses,
      totalZat: band.totalZat,
      share: share(band.totalZat, summary.totalZat),
    })),
    topHolders: summary.topShares.map((top) => ({
      count: top.count,
      totalZat: top.totalZat,
      share: share(top.totalZat, summary.totalZat),
    })),
    asOf: summary.asOf,
  };
}

// ---------------------------------------------------------------- mining pools and the NSM

/** The first day any `/miners` figure may include, as the page holds it. */
const MINING_HISTORY_FROM = MINERS_HISTORY_FROM_DAY ?? "2016-10-28";

const amountOrNull = (zat: number | null): V1Amount | null =>
  zat === null ? null : { zat, zec: zec(zat) };

/**
 * A reward's dollars as `/miners` states them: closed days at their own close, today at the live
 * price. Null, with its reason, when the reward is unknown or today has one and no price is live.
 */
function valueUsd(
  rewardZat: number | null,
  parts: MinerUsdParts,
  livePriceUsd: number | null,
  path: string,
  unknowns: V1Unknowns,
): V1ValueUsd | null {
  const v = minerValueUsd(rewardZat, parts, livePriceUsd);
  if (v === null) {
    unknowns[path] = "unmeasured";
    return null;
  }
  return { usd: Math.round(v.usd * 100) / 100, floor: v.floor };
}

function minerRow(r: MinerAddressRow, of: number, path: string, unknowns: V1Unknowns): V1MinerRow {
  const s = share(r.blocks, of);
  if (s === null) unknowns[`${path}.share`] = "nonexistent";
  if (r.rewardZat === null) unknowns[`${path}.reward`] = "unmeasured";
  if (r.feeZat === null) unknowns[`${path}.fees`] = "unmeasured";
  return {
    address: r.address,
    blocks: r.blocks,
    share: s,
    reward: amountOrNull(r.rewardZat),
    fees: amountOrNull(r.feeZat),
    firstHeight: r.firstHeight,
    lastHeight: r.lastHeight,
  };
}

function miningWindow(o: MinersOverview): V1MiningWindow {
  return {
    key: o.window as V1MiningWindowKey,
    fromDay: o.fromDay,
    toDay: o.toDay,
    fromHeight: o.fromHeight,
    toHeight: o.toHeight,
    daysComputed: o.daysComputed,
    daysExpected: o.daysExpected,
  };
}

/** What a window does not cover yet, in words; `partial` when there is anything to say. */
function miningCoverage(o: MinersOverview): V1MiningPools["coverage"] {
  const notes: string[] = [];
  if (o.daysComputed < o.daysExpected) {
    notes.push(
      `${o.daysExpected - o.daysComputed} of the window's ${o.daysExpected} days are not computed yet; their blocks are not counted.`,
    );
  }
  if (o.unrecordedBlocks > 0) {
    notes.push(
      `${o.unrecordedBlocks.toLocaleString("en-US")} block(s) have no recorded miner yet; they count in every share's denominator, so every share is a lower bound until they are filled.`,
    );
  }
  return { status: notes.length === 0 ? "complete" : "partial", notes };
}

/** Said on every mining-pool answer: what a pool is here, and what the figures are. */
export const MINING_POOLS_BASIS =
  "A mining pool here is this explorer's reviewed label on specific payout addresses (each address carries its `basis`); a pool's figures add up those addresses and nothing else. Addresses no label names stay in `unattributed`, each its own row and never merged; some of their blocks may be a pool's, so a pool's share is a lower bound. Every share is of every block in the window, unattributed, shielded-coinbase and unrecorded ones included. `reward` is what the coinbase paid the address, its subsidy share plus its fee share, so it already contains `fees`: never add the two. From NU7 a miner keeps 40% of a block's fees and 60% goes to the NSM (/v1/analytics/nsm). A shielded coinbase (ZIP 213) is counted and never valued: its amount is encrypted. `valueUsd` values each closed UTC day at that day's stored close and today at the live price; `floor` marks a closed day with no stored close, left out rather than priced at 0. Windows are the last 7, 30, 90 or 365 UTC days, today unfinished, or all of history from `historyFrom`; blocks that paid a bare public key have no address and are counted apart.";

/**
 * How a pool's payout address was reviewed. Every address grouped into a pool has a label, so a
 * missing one is a programming error: it throws rather than claim the strongest evidence.
 */
function reviewedBasis(address: string): V1MiningPoolAddress["basis"] {
  const label = MINING_POOL_LABELS[address];
  if (label === undefined) throw new Error(`no reviewed label for pool address ${address}`);
  return label.basis;
}

/** One pool's figures over the window, from the overview's labelled rows. */
function poolSummary(
  g: MiningPoolGroup,
  o: MinersOverview,
  livePriceUsd: number | null,
  path: string,
  unknowns: V1Unknowns,
): V1MiningPoolSummary {
  const s = share(g.blocks, o.blocks);
  if (s === null) unknowns[`${path}.share`] = "nonexistent";
  if (g.rewardZat === null) unknowns[`${path}.reward`] = "unmeasured";
  if (g.feeZat === null) unknowns[`${path}.fees`] = "unmeasured";
  return {
    id: g.pool.id,
    name: g.pool.name,
    blocks: g.blocks,
    share: s,
    reward: amountOrNull(g.rewardZat),
    fees: amountOrNull(g.feeZat),
    valueUsd: valueUsd(g.rewardZat, g.usd, livePriceUsd, `${path}.valueUsd`, unknowns),
    addresses: g.addresses.map((r, i) => ({
      ...minerRow(r, o.blocks, `${path}.addresses.${i}`, unknowns),
      basis: reviewedBasis(r.address),
    })),
  };
}

/** `/v1/analytics/mining-pools`: every reviewed pool over the window, beside what no label names. */
export function toMiningPools(
  o: MinersOverview,
  livePriceUsd: number | null,
  siteUrl: string,
  asOf: number,
): V1MiningPools {
  const unknowns: V1Unknowns = {};
  const count = (blocks: number, path: string): V1BlockCount => {
    const s = share(blocks, o.blocks);
    if (s === null) unknowns[`${path}.share`] = "nonexistent";
    return { blocks, share: s };
  };
  const { pools } = groupMinersByPool(o.labelled);
  const u = o.unattributed;
  if (u.rewardZat === null) unknowns["data.unattributed.reward"] = "unmeasured";
  if (u.feeZat === null) unknowns["data.unattributed.fees"] = "unmeasured";
  const unattributedShare = share(u.blocks, o.blocks);
  if (unattributedShare === null) unknowns["data.unattributed.share"] = "nonexistent";
  return {
    query: { window: o.window as V1MiningWindowKey },
    coverage: miningCoverage(o),
    source: { name: "ShieldedScan", url: `${siteUrl}/miners` },
    basis: MINING_POOLS_BASIS,
    data: {
      window: miningWindow(o),
      historyFrom: MINING_HISTORY_FROM,
      blocks: o.blocks,
      byKind: {
        transparent: {
          ...count(o.transparent.blocks, "data.byKind.transparent"),
          addresses: o.transparent.addresses,
        },
        shieldedCoinbase: count(o.shieldedBlocks, "data.byKind.shieldedCoinbase"),
        noAddress: count(o.noAddressBlocks, "data.byKind.noAddress"),
        unrecorded: count(o.unrecordedBlocks, "data.byKind.unrecorded"),
      },
      pools: pools.map((g, i) => poolSummary(g, o, livePriceUsd, `data.pools.${i}`, unknowns)),
      unattributed: {
        blocks: u.blocks,
        addresses: u.addresses,
        share: unattributedShare,
        reward: amountOrNull(u.rewardZat),
        fees: amountOrNull(u.feeZat),
        valueUsd: valueUsd(
          u.rewardZat,
          u.usd,
          livePriceUsd,
          "data.unattributed.valueUsd",
          unknowns,
        ),
        largest: u.largest.map((r, i) =>
          minerRow(r, o.blocks, `data.unattributed.largest.${i}`, unknowns),
        ),
      },
    },
    unknowns,
    asOf,
  };
}

/** `/v1/analytics/mining-pools/{id}`: one pool's reviewed addresses, window and newest blocks. */
export function toMiningPool(
  pool: MiningPool,
  o: MinersOverview,
  blocks: readonly MiningPoolBlock[],
  page: { limit: number; cursor: string | null; nextCursor: string | null },
  livePriceUsd: number | null,
  siteUrl: string,
  asOf: number,
): V1MiningPool {
  const unknowns: V1Unknowns = {};
  const group = groupMinersByPool(o.labelled).pools.find((g) => g.pool.id === pool.id);
  const empty: MiningPoolGroup = {
    pool,
    blocks: 0,
    rewardZat: 0,
    feeZat: 0,
    usd: { closedUsd: 0, unpricedZat: 0, todayZat: 0 },
    addresses: [],
  };
  const {
    id: _id,
    name: _name,
    ...totals
  } = poolSummary(group ?? empty, o, livePriceUsd, "data.totals", unknowns);
  const items = blocks.map((b, i): V1MiningPoolBlock => {
    if (b.rewardZat === null) unknowns[`data.blocks.items.${i}.reward`] = "unmeasured";
    return {
      height: b.height,
      timestamp: b.timestamp,
      time: new Date(b.timestamp * 1000).toISOString(),
      address: b.address,
      reward: amountOrNull(b.rewardZat),
    };
  });
  return {
    query: { window: o.window as V1MiningWindowKey, limit: page.limit, cursor: page.cursor },
    coverage: miningCoverage(o),
    source: { name: "ShieldedScan", url: `${siteUrl}/miners/${pool.id}` },
    basis: MINING_POOLS_BASIS,
    data: {
      pool: { id: pool.id, name: pool.name },
      reviewedAddresses: Object.entries(MINING_POOL_LABELS)
        .filter(([, l]) => l.miningPool === pool.id)
        .map(([address, l]) => ({ address, basis: l.basis })),
      window: miningWindow(o),
      historyFrom: MINING_HISTORY_FROM,
      totals,
      blocks: { items, nextCursor: page.nextCursor },
    },
    unknowns,
    asOf,
  };
}

const SERIES_GROUP_KIND: Record<string, V1MiningSeriesGroup["kind"]> = {
  [UNATTRIBUTED_GROUP]: "unattributed",
  [SHIELDED_GROUP]: "shielded-coinbase",
  [NO_ADDRESS_GROUP]: "no-address",
};
const SERIES_GROUP_NAME: Record<string, string> = {
  [UNATTRIBUTED_GROUP]: "Unattributed",
  [SHIELDED_GROUP]: "Shielded coinbase",
  [NO_ADDRESS_GROUP]: "No address",
};

/** The groups a series may name: every reviewed pool, then the three that are not pools. */
export const MINING_SERIES_GROUP_IDS: readonly string[] = [
  ...Object.keys(MINING_POOLS),
  UNATTRIBUTED_GROUP,
  SHIELDED_GROUP,
  NO_ADDRESS_GROUP,
];

/** A period's majority figure; a null count carries its reason, the blocks it fell short with. */
function majorityOf(m: PoolMajority, path: string, unknowns: V1Unknowns): V1PoolMajority {
  if (m.pools === null) unknowns[`${path}.pools`] = "indeterminate";
  return {
    pools: m.pools,
    blocks: m.poolsBlocks,
    top1Blocks: m.top1Blocks,
    top3Blocks: m.top3Blocks,
    reviewedBlocks: m.reviewedBlocks,
  };
}

/** `/v1/analytics/mining-pools/series`: each group's blocks and share per day or month. */
export function toMiningPoolSeries(
  s: MinerSeries,
  group: string | null,
  siteUrl: string,
  asOf: number,
): V1MiningPoolSeries {
  const unknowns: V1Unknowns = {};
  const wanted = (g: string) => group === null || g === group;
  const present = [...new Set(s.points.map((p) => p.group))].filter(wanted);
  const ids = MINING_SERIES_GROUP_IDS.filter((g) => present.includes(g) || g === group);
  const groups = ids.map((id): V1MiningSeriesGroup =>
    Object.hasOwn(MINING_POOLS, id)
      ? { id, name: MINING_POOLS[id as MiningPoolId].name, kind: "mining-pool" }
      : { id, name: SERIES_GROUP_NAME[id]!, kind: SERIES_GROUP_KIND[id]! },
  );
  const byCell = new Map(s.points.map((x) => [`${x.period}|${x.group}`, x]));
  // From every group whatever `group` narrows to: the majority is a fact about the whole period.
  const majorities = poolsToMajority(s);
  const periods = s.periods.map((p, i) => ({
    period: p.period,
    partial: p.partial,
    blocks: p.blocks,
    firstHeight: p.firstHeight,
    lastHeight: p.lastHeight,
    // Only the groups that mined in the period: a group absent from it mined no block there. Listing
    // every group in every month of all history put the series past what an MCP answer may carry.
    groups: ids
      .filter((id) => (byCell.get(`${p.period}|${id}`)?.blocks ?? 0) > 0)
      .map((id, j): V1MiningSeriesCell => {
        const point = byCell.get(`${p.period}|${id}`);
        const blocks = point?.blocks ?? 0;
        const path = `data.periods.${i}.groups.${j}`;
        const sh = share(blocks, p.blocks);
        if (sh === null) unknowns[`${path}.share`] = "nonexistent";
        // A shielded coinbase pays into an encrypted note: its amounts are never numbers here.
        if (id === SHIELDED_GROUP) {
          unknowns[`${path}.reward`] = "shielded";
          unknowns[`${path}.fees`] = "shielded";
          return { group: id, blocks, share: sh, reward: null, fees: null };
        }
        const reward = point === undefined ? 0 : point.rewardZat;
        const fees = point === undefined ? 0 : point.feeZat;
        if (reward === null) unknowns[`${path}.reward`] = "unmeasured";
        if (fees === null) unknowns[`${path}.fees`] = "unmeasured";
        return {
          group: id,
          blocks,
          share: sh,
          reward: amountOrNull(reward),
          fees: amountOrNull(fees),
        };
      }),
    majority: majorityOf(majorities[i]!, `data.periods.${i}.majority`, unknowns),
  }));
  const running = s.periods.find((p) => p.partial);
  return {
    query: { interval: s.interval, pool: group },
    coverage: {
      status: "complete",
      notes: running
        ? [`The period starting ${running.period} holds today and is still running.`]
        : [],
    },
    source: { name: "ShieldedScan", url: `${siteUrl}/miners` },
    basis: `${MINING_POOLS_BASIS} Each period's share is of every block in that period, and a period lists only the groups that mined in it. \`majority.pools\` is how many reviewed pools, largest first, mined 51% of the period's blocks; attributing more blocks could only lower it, and it is null when every reviewed pool together mined less. Months run from ${MINING_HISTORY_FROM}; days cover the trailing year.`,
    data: { interval: s.interval, fromDay: s.fromDay, toDay: s.toDay, groups, periods },
    unknowns,
    asOf,
  };
}

/** `/v1/analytics/nsm`: what ZIP 235 moved into the NSM over the window, and the balance now. */
export function toNsm(
  o: NsmOverview,
  window: MinersWindowKey,
  days: { fromDay: string; toDay: string },
  livePriceUsd: number | null,
  siteUrl: string,
  asOf: number,
): V1Nsm {
  const unknowns: V1Unknowns = {};
  const notes: string[] = [];
  let partial = false;
  const w = nsmWindow(o, days.fromDay, days.toDay);
  if (o.activationDay === null) {
    partial = true;
    notes.push("The index does not hold NU7's activation block yet.");
  } else if (w?.sinceActivation) {
    notes.push(`The window opens before NU7; it is summed from ${o.activationDay}.`);
  }
  if (w !== null && (w.feeZat === null || w.nsmZat === null)) {
    partial = true;
    notes.push(
      "A block's fees in the window are not known yet, so the window's sums are withheld.",
    );
  }
  const b = o.balance;
  if (b === null) {
    partial = true;
    unknowns["data.balance"] = "unmeasured";
    notes.push("The node could not be read just now, so the balance is withheld.");
  } else {
    if (b.zat === null) unknowns["data.balance.amount"] = "unmeasured";
    if (b.carriedInZat === null) unknowns["data.balance.carriedIn"] = "unmeasured";
    if (b.zat === null || b.carriedInZat === null) unknowns["data.balance.fromFees"] = "unmeasured";
  }
  if (w === null) unknowns["data.window"] = "nonexistent";
  else {
    for (const k of ["fees", "toNsm", "toMiners"] as const) {
      const zat = k === "fees" ? w.feeZat : k === "toNsm" ? w.nsmZat : w.minerZat;
      if (zat === null) unknowns[`data.window.${k}`] = "unmeasured";
    }
  }
  const start = w?.fromDay ?? days.fromDay;
  const inWindow = o.days.filter((d) => d.day >= start && d.day <= days.toDay);
  return {
    query: { window: window as V1MiningWindowKey },
    coverage: { status: partial ? "partial" : "complete", notes },
    source: { name: "ShieldedScan", url: `${siteUrl}/miners` },
    basis:
      "From NU7 (ZIP 235) each block moves floor(6 × fees / 10) of its fees into the NSM (Network Sustainability Mechanism) and leaves the rest to the miner, summed per UTC day over every block whatever its coinbase: a block's fee total is public. The balance is the node's own figure at `balance.height`. It is larger than the fees because the node opened the NSM at NU7 with the miner subsidy never claimed since genesis (`carriedIn`); `fromFees` is the rest, every block's fee share from NU7 to that height. No reissuance has left the balance yet. `toNsmValueUsd` and `toMinersValueUsd` value each closed UTC day at that day's stored close and today at the live price. Windows are the last 7, 30, 90 or 365 UTC days, today unfinished, or all of history.",
    data: {
      activationHeight: o.activationHeight,
      activationDay: o.activationDay,
      feeSplitPct: { nsm: NSM_FEE_SHARE_PCT, miners: 100 - NSM_FEE_SHARE_PCT },
      balance:
        b === null
          ? null
          : {
              height: b.height,
              amount: amountOrNull(b.zat),
              carriedIn: amountOrNull(b.carriedInZat),
              fromFees:
                b.zat === null || b.carriedInZat === null
                  ? null
                  : amountOrNull(b.zat - b.carriedInZat),
            },
      window:
        w === null
          ? null
          : {
              key: window as V1MiningWindowKey,
              fromDay: w.fromDay,
              toDay: days.toDay,
              sinceActivation: w.sinceActivation,
              blocks: w.blocks,
              fees: amountOrNull(w.feeZat),
              toNsm: amountOrNull(w.nsmZat),
              toMiners: amountOrNull(w.minerZat),
              toNsmValueUsd: valueUsd(
                w.nsmZat,
                w.nsmUsd,
                livePriceUsd,
                "data.window.toNsmValueUsd",
                unknowns,
              ),
              toMinersValueUsd: valueUsd(
                w.minerZat,
                w.minerUsd,
                livePriceUsd,
                "data.window.toMinersValueUsd",
                unknowns,
              ),
            },
      days: inWindow.map((d, i): V1NsmDay => {
        if (d.feeZat === null) unknowns[`data.days.${i}.fees`] = "unmeasured";
        if (d.nsmZat === null) unknowns[`data.days.${i}.toNsm`] = "unmeasured";
        if (d.feeZat === null || d.nsmZat === null) {
          unknowns[`data.days.${i}.toMiners`] = "unmeasured";
        }
        if (d.closeUsd === null) {
          unknowns[`data.days.${i}.usdClose`] = d.partial ? "nonexistent" : "unmeasured";
        }
        return {
          day: d.day,
          partial: d.partial,
          blocks: d.blocks,
          fees: amountOrNull(d.feeZat),
          toNsm: amountOrNull(d.nsmZat),
          toMiners:
            d.feeZat === null || d.nsmZat === null ? null : amountOrNull(d.feeZat - d.nsmZat),
          usdClose: d.closeUsd,
        };
      }),
    },
    unknowns,
    asOf,
  };
}
