import { ZATS_PER_ZEC, type CrossChainStatus, type CrossChainTransfer } from "@/domain";
import { parseFiniteOrNull } from "@/lib/finite";
import { memoDestination, memoTargetAsset } from "./memo";
import { type MidgardProtocol, ZEC_ASSET, describeMidgardAsset, isSettlementAsset } from "./venues";

/** Midgard states every asset's amount in units of 1e-8, whatever that asset's own decimals. */
const MIDGARD_BASE_UNITS = 1e8;

/**
 * Midgard action → `CrossChainTransfer`. Pure: no fetch, no clock, no config.
 *
 * MAYAChain and THORChain run the same Midgard API, so one parser serves both; only the
 * base URL and explorer prefix differ.
 */

interface MidgardCoin {
  amount?: string;
  asset?: string;
}

interface MidgardLeg {
  address?: string;
  coins?: MidgardCoin[];
  txID?: string;
  /** Set on the venue's affiliate-fee payout, which is not part of the user's swap. */
  affiliate?: boolean;
}

interface MidgardAction {
  date?: string;
  status?: string;
  type?: string;
  in?: MidgardLeg[];
  out?: MidgardLeg[];
  metadata?: { swap?: { inPriceUSD?: string; outPriceUSD?: string; memo?: string } };
}

interface CounterLeg {
  leg: MidgardLeg;
  coin: MidgardCoin;
  asset: string;
}

function zecCoin(leg: MidgardLeg): MidgardCoin | undefined {
  return leg.coins?.find((c) => c.asset === ZEC_ASSET);
}

function nonZecLegs(legs: MidgardLeg[] | undefined): CounterLeg[] {
  const found: CounterLeg[] = [];
  for (const leg of legs ?? []) {
    for (const coin of leg.coins ?? []) {
      if (typeof coin.asset === "string" && coin.asset !== ZEC_ASSET) {
        found.push({ leg, coin, asset: coin.asset });
      }
    }
  }
  return found;
}

/**
 * Picks the leg that represents the user's actual counterparty.
 *
 * Order matters. Maya lists an affiliate `MAYA.CACAO` payout in `out[]`, often before the
 * real destination leg, so taking the first non-ZEC leg would attribute most outbound swaps
 * to "MAYA". Both tests are needed: some affiliate payouts carry the flag, others are only
 * identifiable by paying the venue's own settlement asset.
 *
 * A genuine ZEC↔CACAO or ZEC↔RUNE swap has no other leg, so the settlement asset is
 * accepted at step 2 rather than discarded; the serve layer decides what to do with it.
 *
 * Step 0 outranks both: the leg paying the address the memo names is the user's payout. The
 * affiliate flag is not always set on every affiliate leg, and when every leg pays the
 * settlement asset the memo is the only reliable signal. Addresses are compared
 * case-insensitively (`0x5f9Ee…` vs `0x5f9ee…`).
 */
function pickCounterLeg(
  legs: MidgardLeg[] | undefined,
  protocol: MidgardProtocol,
  destination: string | null = null,
): CounterLeg | undefined {
  const candidates = nonZecLegs(legs);
  const settlement = (c: CounterLeg) => {
    const { chain, symbol } = describeMidgardAsset(c.asset, protocol);
    return isSettlementAsset(chain, symbol);
  };
  const paysDestination = (c: CounterLeg) =>
    destination !== null && c.leg.address?.toLowerCase() === destination.toLowerCase();
  return (
    candidates.find((c) => !c.leg.affiliate && paysDestination(c)) ??
    candidates.find((c) => !c.leg.affiliate && !settlement(c)) ??
    candidates.find((c) => !c.leg.affiliate) ??
    candidates[0]
  );
}

function mapStatus(action: MidgardAction): CrossChainStatus | null {
  if (action.type === "refund") return "refunded";
  if (action.type !== "swap") return null;
  if (action.status === "success") return "completed";
  if (action.status === "pending") return "pending";
  return null;
}

function txid(leg: MidgardLeg | undefined): string | null {
  const id = leg?.txID;
  return typeof id === "string" && id.length > 0 ? id.toLowerCase() : null;
}

export function parseMidgardActions(
  root: unknown,
  protocol: MidgardProtocol,
): CrossChainTransfer[] {
  const actions = (root as { actions?: unknown } | null)?.actions;
  if (!Array.isArray(actions)) return [];

  const transfers: CrossChainTransfer[] = [];
  for (const action of actions as MidgardAction[]) {
    const transfer = parseAction(action, protocol);
    if (transfer !== null) transfers.push(transfer);
  }
  return transfers;
}

function parseAction(action: MidgardAction, protocol: MidgardProtocol): CrossChainTransfer | null {
  const status = mapStatus(action);
  if (status === null) return null;

  const zecInLeg = action.in?.find((l) => zecCoin(l));
  const zecOutLeg = action.out?.find((l) => zecCoin(l));
  const swap = action.metadata?.swap;

  // Direction is relative to Zcash and inverted from Midgard's field names: ZEC arriving
  // at the venue (in[]) means it left Zcash.
  let direction: CrossChainTransfer["direction"];
  let zecLeg: MidgardLeg;
  let counter: CounterLeg | undefined;
  let priceUsd: number | null;
  let counterPriceUsd: number | null;
  let zcashTxid: string | null;
  let counterpartTxHash: string | null;

  // ZEC on the in side decides the direction, whether or not ZEC also appears on the out
  // side. A streaming swap returns the portion it could not fill in the deposited asset, so
  // an ordinary ZEC→BTC swap can have ZEC in both arrays; treating those as inbound would
  // record BTC "arriving" on Zcash, valued at Bitcoin's unit price.
  if (zecInLeg) {
    direction = "out";
    zecLeg = zecInLeg;
    counter = pickCounterLeg(action.out, protocol, memoDestination(swap?.memo));
    priceUsd = parseFiniteOrNull(swap?.inPriceUSD);
    counterPriceUsd = parseFiniteOrNull(swap?.outPriceUSD);
    zcashTxid = txid(zecInLeg);
    counterpartTxHash = txid(counter?.leg);
  } else if (zecOutLeg) {
    direction = "in";
    zecLeg = zecOutLeg;
    counter = pickCounterLeg(action.in, protocol);
    priceUsd = parseFiniteOrNull(swap?.outPriceUSD);
    counterPriceUsd = parseFiniteOrNull(swap?.inPriceUSD);
    zcashTxid = txid(zecOutLeg);
    counterpartTxHash = txid(counter?.leg) ?? txid(action.in?.[0]);
  } else {
    return null;
  }

  const depositedZat = Number(zecCoin(zecLeg)?.amount);
  if (!Number.isFinite(depositedZat) || depositedZat <= 0) return null;

  /**
   * What actually crossed the boundary: the deposit, less any ZEC handed straight back.
   * Outbound only — an inbound swap's ZEC out-leg is the arrival, not a refund.
   *
   * And only when the refund is smaller than the deposit. Midgard merges the out legs of
   * related actions sharing a txid, so a streaming swap can report more ZEC out than went in.
   * That cannot be a refund of this deposit, so the deposit stands — the conservative reading,
   * never recording a crossing larger than what was sent. Subtracting unconditionally would
   * drive the amount negative and drop the row as "nothing crossed".
   */
  const returnedZat =
    direction === "out" && zecOutLeg !== undefined ? Number(zecCoin(zecOutLeg)?.amount) : NaN;
  const refundedZat = Number.isFinite(returnedZat) && returnedZat < depositedZat ? returnedZat : 0;
  const zecAmountZat = depositedZat - refundedZat;
  if (!Number.isFinite(zecAmountZat) || zecAmountZat <= 0) return null;

  // Identity is the in-side txID: the user's originating deposit, which Midgard guarantees
  // and which never changes as the swap settles. The Zcash-side txid is not stable: for an
  // inbound swap it is `""` until the payout lands, which would ingest one swap under two
  // keys.
  const identity = txid(action.in?.[0]) ?? zcashTxid ?? counterpartTxHash;
  if (identity === null) return null;

  // Counter asset falls back to the memo target only when no leg exists at all — a
  // failed or partially-settled swap. Unresolvable stays UNKNOWN rather than guessed.
  const counterAsset = counter?.asset ?? memoTargetAsset(swap?.memo, protocol);
  const counterAmountRaw = counter ? Number(counter.coin.amount) : NaN;

  const described =
    counterAsset === null
      ? { chain: "UNKNOWN", symbol: "UNKNOWN", synthetic: false }
      : describeMidgardAsset(counterAsset, protocol);

  return {
    id: `${protocol}-${identity}`,
    direction,
    protocol,
    counterpartChain: described.chain,
    counterpartAsset: described.symbol,
    counterpartIsSynthetic: described.synthetic,
    counterpartAmount: Number.isFinite(counterAmountRaw)
      ? counterAmountRaw / MIDGARD_BASE_UNITS
      : null,
    counterpartTxHash,
    counterpartAddress: counter?.leg.address ?? null,
    // Midgard publishes no per-swap deposit address — THORChain and Maya deposit into a shared
    // vault. Null rather than the vault address, which would identify the vault, not this
    // transfer.
    venueDepositAddress: null,
    zcashTxid,
    zcashAddress: zecLeg.address ?? null,
    // Midgard scales every asset to 8dp, which for ZEC is exactly zatoshis — no conversion.
    zecAmountZat,
    usdValueAtSwap: priceUsd === null ? null : (zecAmountZat / ZATS_PER_ZEC) * priceUsd,
    // Published unit price × published amount, both for the same leg — the identical
    // arithmetic the ZEC side uses, never the ZEC figure re-attributed to the other side.
    counterpartUsdAtSwap:
      counterPriceUsd === null || !Number.isFinite(counterAmountRaw)
        ? null
        : (counterAmountRaw / MIDGARD_BASE_UNITS) * counterPriceUsd,
    status,
    // `date` is nanoseconds as a string; the domain uses unix seconds throughout.
    timestamp: Math.floor(Number(action.date ?? 0) / 1e9),
  };
}
