import { SETTLEMENT_ASSET_BY_CHAIN } from "@/domain/crosschain";

export type MidgardProtocol = "maya" | "thorchain";

export const ZEC_ASSET = "ZEC.ZEC";

/**
 * A leg that is the venue paying itself, rather than a destination.
 *
 * Judged by the asset, not the chain: wrapped ZEC also lives on MAYA, so excluding the
 * chain would discard every ZEC-to-wrapped-ZEC transfer along with the CACAO legs.
 */
export function isSettlementLeg(t: {
  counterpartChain: string;
  counterpartAsset: string;
}): boolean {
  return isSettlementAsset(t.counterpartChain, t.counterpartAsset);
}

export interface MidgardVenue {
  base: string;
  /** Explorer prefix for a venue tx. Differs per venue — sharing one produces dead links. */
  explorerTx: string;
}

/**
 * Explorer link prefixes. Fixed per venue; only the API base is configurable.
 */
const EXPLORER_TX: Record<MidgardProtocol, string> = {
  maya: "https://www.mayascan.org/tx/",
  thorchain: "https://thorchain.net/tx/",
};

/**
 * Default Midgard bases.
 *
 * THORChain's default is Liquify's gateway, the one public THORChain Midgard found
 * answering anonymous clients; Nine Realms' `midgard.ninerealms.com` no longer resolves.
 * A single provider owned by someone else, so both bases stay overridable
 * (`MIDGARD_THORCHAIN_URL`, and its Maya counterpart) rather than trusted as constants.
 */
const DEFAULT_BASE: Record<MidgardProtocol, string | null> = {
  maya: "https://midgard.mayachain.info",
  thorchain: "https://gateway.liquify.com/chain/thorchain_midgard",
};

/**
 * Accepts a base with or without a trailing `/v2` and with or without a trailing slash,
 * because providers publish both shapes — Liquify's THORChain mirror is
 * `…/chain/thorchain_midgard/v2/`, while Maya's is a bare host. Callers append `/v2/…`,
 * so a base that already ends in `/v2` would otherwise produce `/v2/v2/actions`.
 */
export function normaliseMidgardBase(raw: string): string {
  return raw.trim().replace(/\/+$/, "").replace(/\/v2$/, "");
}

/**
 * Resolves which Midgard venues to poll. A venue with no base is not polled at all —
 * reporting it as "failed" would be a lie about why it has no data.
 */
export function midgardVenuesFromEnv(
  env: Record<string, string | undefined> = process.env,
): Partial<Record<MidgardProtocol, MidgardVenue>> {
  const overrides: Record<MidgardProtocol, string | undefined> = {
    maya: env.MIDGARD_MAYA_URL,
    thorchain: env.MIDGARD_THORCHAIN_URL,
  };

  const venues: Partial<Record<MidgardProtocol, MidgardVenue>> = {};
  for (const protocol of ["maya", "thorchain"] as const) {
    const base = overrides[protocol] ?? DEFAULT_BASE[protocol];
    if (!base) continue;
    venues[protocol] = { base: normaliseMidgardBase(base), explorerTx: EXPLORER_TX[protocol] };
  }
  return venues;
}

/** Where a venue's own synthetic assets live. */
const HOST_CHAIN: Record<MidgardProtocol, string> = { maya: "MAYA", thorchain: "THOR" };

/** The asset a venue settles in natively — not a destination, and not a wrapped asset. */
export function isSettlementAsset(chain: string, symbol: string): boolean {
  const settles: Record<string, string | undefined> = SETTLEMENT_ASSET_BY_CHAIN;
  return settles[chain.toUpperCase()] === symbol.toUpperCase();
}

export interface AssetDescription {
  /** The chain the asset actually sits on. For a wrapped claim, the venue's own chain. */
  chain: string;
  symbol: string;
  /**
   * A wrapped claim rather than the asset itself, held on the venue's chain and
   * redeemable for the real thing. Three spellings, all THORChain's own (`NewAsset` in
   * thornode `common/asset.go`): `ZEC/ZEC` a synth (Maya and THORChain), `BTC~BTC` a
   * trade-account asset and `BTC-BTC` a secured asset (THORChain only).
   */
  synthetic: boolean;
}

/**
 * Splits a Midgard asset id into chain, symbol and whether it is a wrapped claim.
 *
 *   `ETH.USDC-0XA0…`  layer-1 USDC on Ethereum
 *   `BTC.BTC`         layer-1 BTC
 *   `ZEC/ZEC`         SYNTHETIC ZEC, held on the venue's chain — wrapped ZEC
 *   `BTC~BTC`         a THORChain trade-account BTC — a claim, held on THOR
 *   `BTC-BTC`         a THORChain secured BTC — a claim, held on THOR
 *
 * The kind is decided by the first of `~ . / -` in the string, exactly as the venue decides
 * it — which keeps `ETH.USDC-0XA0…` a layer-1 asset despite its dash. Splitting on `.`
 * alone would file every wrapped asset under a chain named after the whole string.
 */
export function describeMidgardAsset(asset: string, protocol: MidgardProtocol): AssetDescription {
  const separator = /[~./-]/.exec(asset)?.[0];
  if (separator !== undefined && separator !== ".") {
    const tail = asset.slice(asset.indexOf(separator) + 1);
    const [symbol = ""] = tail.split("-");
    return { chain: HOST_CHAIN[protocol], symbol: symbol.toUpperCase(), synthetic: true };
  }
  return { chain: chainOfAsset(asset), symbol: symbolOfAsset(asset), synthetic: false };
}

/** `ETH.USDC-0XA0…` → `ETH`; `BTC.BTC` → `BTC`. */
export function chainOfAsset(asset: string): string {
  const [chain = ""] = asset.split(".");
  return chain.toUpperCase();
}

/** `ETH.USDC-0XA0…` → `USDC`; `BTC.BTC` → `BTC`; bare/odd input → the chain. */
export function symbolOfAsset(asset: string): string {
  const tail = asset.split(".")[1];
  if (!tail) return chainOfAsset(asset);
  const [symbol = ""] = tail.split("-");
  return symbol.toUpperCase();
}
