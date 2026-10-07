import { createHash } from "node:crypto";
import { type CrossChainTransfer, ZATS_PER_ZEC, classifyZcashAddress } from "@/domain";
import { parseFiniteOrNull } from "@/lib/finite";

/**
 * NEAR Intents transaction → `CrossChainTransfer`. Pure: no fetch, no clock, no config.
 * Verified against a live capture (`__fixtures__/near-intents.json`).
 *
 * Units differ from Midgard in three ways, each producing plausible-but-wrong output if
 * conflated:
 *   - `createdAtTimestamp` is seconds (Midgard's `date` is nanoseconds).
 *   - The ZEC leg's raw `amountIn`/`amountOut` is zatoshis, so it is used directly.
 *   - The counter leg's raw amount is in that asset's native decimals (1e18 for ETH), not
 *     Midgard's universal 1e8 — so the counter side uses `*Formatted`.
 */

interface IntentsTx {
  originAsset?: string;
  destinationAsset?: string;
  depositAddress?: string;
  depositMemo?: string | null;
  status?: string;
  createdAtTimestamp?: number;
  /** Integer minor units. Zatoshis on a ZEC leg; the asset's native decimals otherwise. */
  amountIn?: string;
  amountOut?: string;
  amountInFormatted?: string;
  amountOutFormatted?: string;
  amountInUsd?: string;
  amountOutUsd?: string;
  nearTxHashes?: string[];
  recipient?: string;
  originChainTxHashes?: string[];
  destinationChainTxHashes?: string[];
  /** The venue's own unique id for the intent. Preferred as the row identity. */
  intentHashes?: string;
  /** The end user's address on the origin chain, when the venue publishes it. */
  senders?: string[];
  /** `ORIGIN_CHAIN` when funds were deposited on-chain; `INTENTS` when they were not. */
  depositType?: string;
  /** `DESTINATION_CHAIN` when funds were delivered on-chain; `INTENTS` when they were not. */
  recipientType?: string;
}

/**
 * Did the ZEC leg actually touch the Zcash chain?
 *
 * Intents settles some swaps entirely inside its own ledger: the user already holds
 * `nep141:zec.omft.near` and trades it without any Zcash transaction. Those rows look like
 * cross-chain transfers apart from these two fields, so including them would count ZEC
 * flow that never crossed the boundary and put a NEAR account id in `zcashAddress`.
 *
 * The tx-hash fallback covers the field being renamed or dropped — a real on-chain leg
 * always publishes a hash, an internal one never does — so a schema change degrades to a
 * heuristic instead of silently dropping every row.
 */
function zecLegTouchedZcash(tx: IntentsTx, zecIsOrigin: boolean): boolean {
  const declared = zecIsOrigin ? tx.depositType : tx.recipientType;
  const onChain = zecIsOrigin ? "ORIGIN_CHAIN" : "DESTINATION_CHAIN";
  if (declared === onChain) return true;
  if (typeof declared === "string") return false;
  const hash = zecIsOrigin ? tx.originChainTxHashes?.[0] : tx.destinationChainTxHashes?.[0];
  return Boolean(hash);
}

/**
 * Contract-addressed tokens whose symbol is not recoverable from the asset id alone.
 *
 * A lookup table, not inference: each address is the canonical deployment, corroborated by
 * the venue's own USD figures (each stablecoin divides out to $1.00). Without it these
 * render as "ARB asset" / "BASE asset", hiding that most cross-chain ZEC trades against
 * stablecoins.
 *
 * Add an entry only with the same evidence. An unlisted contract keeps the `<CHAIN> asset`
 * fallback; guessing a ticker from an address is how a page ends up confidently wrong.
 */
const TOKEN_SYMBOLS: Record<string, string> = {
  "arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831": "USDC",
  "arb-0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9": "USDT",
  "base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": "USDC",
  "eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": "USDC",
  "eth-0xdac17f958d2ee523a2206206994597c13d831ec7": "USDT",
  "eth-0x6982508145454ce325ddbe47a25d4ec3d2311933": "PEPE",
  "tron-d28a265909efecdcee7c5028585214ea0b96f015": "USDT",
};

/**
 * The chain and asset an Intents id refers to, across the three id shapes seen live.
 *
 *   nep141:eth-0xa0b8….omft.near        token on Ethereum
 *   nep141:btc.omft.near                native BTC
 *   1cs_v1:btc:native:coin              also native BTC — a second, unrelated shape
 *   1cs_v1:near:nep141:zec.omft.near    ZEC held on NEAR
 *
 * The `1cs_v1:<chain>:native:coin` form matters: taking the last segment yields "coin",
 * which would mislabel native BTC as a NEAR asset. Anything unrecognised resolves to NEAR,
 * where NEP-141 tokens live.
 */
function resolveAsset(asset: string): { chain: string; symbol: string | null } {
  const parts = asset.split(":");

  if (parts[0] === "1cs_v1" && parts.length >= 3) {
    const chain = (parts[1] ?? "").toUpperCase();
    // `native:coin` means the chain's own coin, so the chain is also the symbol.
    if (parts[2] === "native") return { chain, symbol: chain };
    // Otherwise the tail is an ordinary asset id, wrapped.
    return resolveAsset(parts.slice(2).join(":"));
  }

  const id = parts[parts.length - 1] ?? asset;
  if (!id.endsWith(".omft.near")) {
    // NEP-141 tokens that are not omni-bridged, and anything unrecognised, live on NEAR.
    return { chain: "NEAR", symbol: id === "wrap.near" ? "NEAR" : null };
  }

  const head = id.slice(0, -".omft.near".length);
  const chain = (head.split("-")[0] ?? "").toUpperCase();
  const symbol = head.includes("-") ? (TOKEN_SYMBOLS[head] ?? null) : head.toUpperCase();
  return { chain, symbol };
}

/** `nep141:eth-0xa0b8….omft.near` → `ETH`; `1cs_v1:btc:native:coin` → `BTC`. */
export function chainFromIntentsAsset(asset: string): string {
  return resolveAsset(asset).chain;
}

/**
 * `nep141:btc.omft.near` → `BTC`. A token contract's symbol is not recoverable from its
 * asset id, so it returns null rather than a guess derived from the contract address.
 */
export function symbolFromIntentsAsset(asset: string): string | null {
  return resolveAsset(asset).symbol;
}

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]+$/;

/**
 * `intentHashes` is the venue's own unique id and is base58, so it is URL-safe as-is.
 *
 * The fallback hashes (deposit address, memo, created-at): Intents has no single
 * canonical tx hash — one transfer touches two or three chains — and `depositAddress`
 * alone is reused across deposits, so the triple is what makes it unique. It is hashed
 * only to keep the id short enough to sit in a route path.
 */
function intentsId(tx: IntentsTx): string {
  const hash = tx.intentHashes;
  if (typeof hash === "string" && hash.length > 0 && BASE58.test(hash)) {
    return `near-intents-${hash}`;
  }
  const natural = `${tx.depositAddress ?? ""}|${tx.depositMemo ?? ""}|${tx.createdAtTimestamp ?? 0}`;
  return `near-intents-${createHash("sha256").update(natural).digest("hex").slice(0, 16)}`;
}

/**
 * The ZEC leg in zatoshis.
 *
 * Prefers the raw integer, which is already zatoshis and exact. It is also the settled
 * amount where `*Formatted` is the quote: the two can diverge on payout legs, and
 * `amountOutUsd` divides out to a price consistent with the raw figure. Falls back to the
 * decimal string if the raw field is missing.
 */
function zecLegZat(raw: string | undefined, formatted: string | undefined): number {
  if (typeof raw === "string" && /^\d+$/.test(raw)) return Number(raw);
  const n = Number(formatted);
  return Number.isFinite(n) ? Math.round(n * ZATS_PER_ZEC) : NaN;
}

/** Returns the address only if it is recognisably a Zcash address, else null. */
function zcashAddressOrNull(address: string | undefined): string | null {
  return classifyZcashAddress(address) === null ? null : (address ?? null);
}

export function parseIntentsTransactions(root: unknown): CrossChainTransfer[] {
  if (!Array.isArray(root)) return [];

  const transfers: CrossChainTransfer[] = [];
  for (const tx of root as IntentsTx[]) {
    if (tx?.status !== "SUCCESS" || !tx.originAsset || !tx.destinationAsset) continue;

    const zecIsOrigin = chainFromIntentsAsset(tx.originAsset) === "ZEC";
    const zecIsDest = chainFromIntentsAsset(tx.destinationAsset) === "ZEC";
    // ZEC on neither side, or on both, is not a Zcash boundary crossing.
    if (zecIsOrigin === zecIsDest) continue;
    // Nor is a swap that settled inside Intents without touching Zcash.
    if (!zecLegTouchedZcash(tx, zecIsOrigin)) continue;

    const zecAmountZat = zecIsOrigin
      ? zecLegZat(tx.amountIn, tx.amountInFormatted)
      : zecLegZat(tx.amountOut, tx.amountOutFormatted);
    if (!Number.isFinite(zecAmountZat) || zecAmountZat <= 0) continue;

    const counterAsset = zecIsOrigin ? tx.destinationAsset : tx.originAsset;
    const counterChain = chainFromIntentsAsset(counterAsset);
    const counterAmount = Number(zecIsOrigin ? tx.amountOutFormatted : tx.amountInFormatted);

    transfers.push({
      id: intentsId(tx),
      direction: zecIsOrigin ? "out" : "in",
      protocol: "near-intents",
      counterpartChain: counterChain,
      // Null symbol means a token contract whose ticker is unrecoverable. Naming it after
      // its chain is honest; guessing from the contract address would not be.
      counterpartAsset: symbolFromIntentsAsset(counterAsset) ?? `${counterChain} asset`,
      // Intents has no synth notation; its wrapped ZEC only appears when the Zcash
      // chain did not move, and those rows are rejected above.
      counterpartIsSynthetic: false,
      counterpartAmount: Number.isFinite(counterAmount) ? counterAmount : null,
      counterpartTxHash:
        (zecIsOrigin ? tx.destinationChainTxHashes?.[0] : tx.originChainTxHashes?.[0]) ?? null,
      zcashTxid:
        (zecIsOrigin
          ? tx.originChainTxHashes?.[0]
          : tx.destinationChainTxHashes?.[0]
        )?.toLowerCase() ?? null,
      // Outbound the counterparty is the recipient; inbound it is whoever funded the
      // swap, preferring the real sender over the protocol's deposit address.
      counterpartAddress:
        (zecIsOrigin ? tx.recipient : (tx.senders?.[0] ?? tx.depositAddress)) ?? null,
      // Outbound, prefer the real sender over the protocol's ephemeral deposit address, so the
      // boundary address means the same thing as on Midgard. `senders` is not always a Zcash
      // account, so it is used only when it parses as a Zcash address.
      zcashAddress: zecIsOrigin
        ? (zcashAddressOrNull(tx.senders?.[0]) ?? zcashAddressOrNull(tx.depositAddress))
        : zcashAddressOrNull(tx.recipient),
      zecAmountZat,
      // Kept in both directions: the venue indexes its explorer by this address. Never shown as a
      // boundary address — see the field's docstring.
      venueDepositAddress: tx.depositAddress ?? null,
      usdValueAtSwap: parseFiniteOrNull(zecIsOrigin ? tx.amountInUsd : tx.amountOutUsd),
      // The other leg's published figure — the venue states both sides.
      counterpartUsdAtSwap: parseFiniteOrNull(zecIsOrigin ? tx.amountOutUsd : tx.amountInUsd),
      // Only SUCCESS rows are requested and parsed, so status is always settled.
      status: "completed",
      timestamp: tx.createdAtTimestamp ?? 0,
    });
  }
  return transfers;
}
