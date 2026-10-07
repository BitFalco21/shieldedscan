import {
  estimateHalvingSeconds,
  MAX_SUPPLY_ZAT,
  minerRewardZat,
  type ChainMonthPoint,
  type CrossChainFlowSummary,
  type CrossChainTransfer,
  type MempoolStats,
  type ReorgEvent,
  type ReorgSummary,
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
  type HalvingEvent,
} from "@/domain";
import type { AddressKindBucket, VenueHealth } from "@/data/crosschain/store";
import type {
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

export function toSupply(breakdown: SupplyBreakdown, allSixReported: boolean): V1Supply {
  const shielded = shieldedZat(breakdown);
  const pools: V1PoolBalance[] = breakdown.pools.map((p) => {
    const isShielded = p.pool !== "transparent" && p.pool !== "lockbox";
    return {
      pool: p.pool,
      balanceZat: p.balanceZat,
      shielded: isShielded,
      spendable: p.pool !== "lockbox",
      shareOfShielded: isShielded ? share(p.balanceZat, shielded) : null,
    };
  });
  return {
    heightReadAt: breakdown.height,
    maxSupplyZat: MAX_SUPPLY_ZAT,
    minedZat: minedZat(breakdown),
    unminedZat: unminedZat(breakdown),
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

export function toFloorCoverage(
  venues: (VenueHealth & { enabled: boolean })[],
  firstAt: number | null,
  lastAt: number | null,
): V1FloorCoverage {
  return {
    basis: "floor",
    scope: "public-swap-protocols",
    // Stated in the payload: no public per-transfer API for custodial routes, and
    // aggregators settle on these same venues — counting them would double-count.
    excludes: ["custodial-routes", "aggregators"],
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
    ),
    in: side("in"),
    out: side("out"),
    asOf: now(),
  };
}

export function toDestinations(
  direction: "in" | "out",
  buckets: AddressKindBucket[],
  venues: (VenueHealth & { enabled: boolean })[],
): V1Destinations {
  const classified = buckets.filter((b) => b.kind !== null);
  const capable = classified.filter((b) => b.kind !== "transparent");
  const classifiedTotal = classified.reduce((sum, b) => sum + b.transfers, 0);
  const capableTotal = capable.reduce((sum, b) => sum + b.transfers, 0);

  /*
   * The null bucket's reason: `unmeasured` rather than `indeterminate`, because the venue
   * published no Zcash-side address at all, so there is nothing to reason from. The head poller
   * re-upserts rows, so a venue that starts publishing addresses does reclassify them.
   */
  const unknowns: V1Unknowns = {};
  buckets.forEach((b, i) => {
    if (b.kind !== null) return;
    unknowns[`buckets[${i}].addressKind`] = "unmeasured";
    unknowns[`buckets[${i}].shieldedCapable`] = "unmeasured";
  });

  return withUnknowns(
    {
      direction,
      coverage: toFloorCoverage(venues, null, null),
      buckets: buckets.map((b) => ({
        addressKind: b.kind,
        // A capability claim, not a privacy claim: unified is shielded-CAPABLE, and which
        // receiver was used is not public. null kind → null, not false.
        shieldedCapable: b.kind === null ? null : b.kind !== "transparent",
        transfers: b.transfers,
        zecAmountZat: b.zecAmountZat,
      })),
      shieldedCapableShare: share(capableTotal, classifiedTotal),
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

export function toCirculating(breakdown: SupplyBreakdown): V1CirculatingSupply {
  const lockbox = breakdown.pools.find((p) => p.pool === "lockbox")?.balanceZat ?? 0;
  const circulating = minedZat(breakdown) - lockbox;
  return {
    circulatingZat: circulating,
    circulatingZec: zec(circulating),
    heightReadAt: breakdown.height,
    excludes: ["lockbox"],
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
 * `intervalSeconds` is the observed mean block interval, 0 when it could not be measured.
 *
 * The chain runs slightly slower than the 75-second target, which over the remaining blocks
 * shifts the date by days. The arithmetic lives once, in `estimateHalvingSeconds`, which the
 * site's `/halving` page also calls, so the two cannot publish different dates.
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
  const seconds = estimateHalvingSeconds(blocksRemaining, intervalSeconds);
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
 * One holder, domain → wire.
 *
 * No name on the wire: a label is an editorial judgement resolved from `ADDRESS_LABELS` at
 * render time, and a name published without the basis that qualifies it would look like a chain
 * fact.
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
