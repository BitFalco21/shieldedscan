/**
 * ZEC on other chains: every wrapped or bridged ZEC token this explorer tracks, with what backs it.
 *
 * A token is ZEC here only if it is on this list. Names prove nothing: impostor tokens calling
 * themselves ZEC exist on most chains (one on Base claims a supply of 1,000,000,000), so nothing is
 * ever matched by symbol. Each entry was checked by hand against its issuer's own contracts or
 * registry on the day in `verifiedOn`.
 *
 * Wrapped ZEC is not ZEC on Zcash. Its supply is never added to Zcash's supply or to any shielded
 * figure.
 *
 * Bridges stack. Solana's Omni ZEC is NEAR's `zec.omft.near` locked in `omni.bridge.near`, and
 * that is itself ZEC held on Zcash. So a token says what backs it, and a total counts ZEC once,
 * under the token at the bottom of its stack.
 */

/** How a token's supply relates to ZEC on Zcash. */
export type WrappedStatus =
  /** Backed by ZEC we can find on Zcash, directly or through a token below it. */
  | "checked"
  /** A bridge that publishes nothing we can check its reserve against. */
  | "unchecked"
  /** Held by a company; the backing is its own claim. */
  | "custodial"
  /** Its issuer is gone, so it can no longer be redeemed. */
  | "orphaned"
  /** Carries a ZEC name but is not a claim on ZEC, or would count the same ZEC twice. */
  | "excluded";

export type WrappedChain =
  | "near"
  | "solana"
  | "starknet"
  | "ethereum"
  | "arbitrum"
  | "base"
  | "bsc"
  | "aptos"
  | "aleo"
  | "hyperliquid"
  | "thorchain"
  | "maya"
  | "unichain"
  | "worldchain"
  | "polygon"
  | "katana"
  | "robinhood"
  | "hyperevm";

export type WrappedBacking =
  /** ZEC held at Zcash addresses, read from the issuer (`source`) and checked in our index. */
  | { kind: "zcash"; source: string }
  /** Another listed token, locked at an account on that token's chain. */
  | { kind: "locked"; tokenId: string; account: string }
  /** A company's custody. */
  | { kind: "custody"; custodian: string }
  /** Nothing we can read. */
  | { kind: "unknown" };

export interface WrappedToken {
  /** Stable id, used in URLs and stored observations. Never reuse one. */
  id: string;
  name: string;
  symbol: string;
  issuer: string;
  chain: WrappedChain;
  /** The contract, mint, account or asset name on its chain, as the chain writes it. */
  contract: string;
  decimals: number;
  status: WrappedStatus;
  backing: WrappedBacking;
  /** Where the contract and backing were confirmed. */
  evidence: string;
  /** UTC day the entry was checked. */
  verifiedOn: string;
  note?: string;
}

const OMNI = "https://docs.near.org/chain-abstraction/omnibridge/overview";
const OMNI_LOCK = { kind: "locked", tokenId: "near-omni", account: "omni.bridge.near" } as const;
const UNIVERSAL = "https://docs.universal.xyz/docs/developers/contract-addresses";
const UZEC_EVM = "0x83f31af747189c2fa9e5deb253200c505eff6ed2";

/** `get_token_address` on `omni.bridge.near` returns each of these for `zec.omft.near`. */
const omni = (chain: WrappedChain, contract: string, decimals = 8): WrappedToken => ({
  id: `${chain}-omni`,
  name: "Omni ZEC",
  symbol: "ZEC",
  issuer: "NEAR Omni Bridge",
  chain,
  contract,
  decimals,
  status: "checked",
  backing: OMNI_LOCK,
  evidence: "omni.bridge.near get_token_address(zec.omft.near)",
  verifiedOn: "2026-11-15",
});

const universal = (chain: WrappedChain, contract = UZEC_EVM, decimals = 18): WrappedToken => ({
  id: `${chain}-universal`,
  name: "uZEC",
  symbol: "uZEC",
  issuer: "Universal",
  chain,
  contract,
  decimals,
  status: "unchecked",
  backing: { kind: "unknown" },
  evidence: UNIVERSAL,
  verifiedOn: "2026-11-15",
});

export const WRAPPED_ZEC: readonly WrappedToken[] = [
  {
    id: "near-omni",
    name: "NEAR Intents ZEC",
    symbol: "ZEC",
    issuer: "NEAR Omni Bridge",
    chain: "near",
    contract: "zec.omft.near",
    decimals: 8,
    status: "checked",
    backing: { kind: "zcash", source: "zcash-connector.bridge.near get_utxos_paged" },
    evidence: OMNI,
    verifiedOn: "2026-11-15",
    note: "Most of its supply is locked in omni.bridge.near to issue the Omni tokens on other chains.",
  },
  omni("solana", "A7bdiYdS5GjqGFtxf17ppRHtDKPkkRqbKtR27dxvQXaS"),
  omni("starknet", "0x05ce53b9b68fb8e9ecab9283a96d97948914733fd6ed8d9a53a276a419497841"),
  omni("ethereum", "0x8497438932ca90172d962016512022074af97f18"),
  omni("arbitrum", "0x473c1656373b3715805f647911e75aaa49c39813"),
  omni("base", "0x86263f6ba6029b1657c2dbf289bed3be5bfef7ae"),
  omni("bsc", "0x44b1bb720082209bdbbbed58ef2d9988984b0bfc"),
  omni("aptos", "0x261c85bc1bb5acc3ffcf769530c732d4182c3bbd84936d427125fcd4732e9879"),
  {
    id: "aleo-hyperlane",
    name: "Hyperlane ZEC",
    symbol: "ZEC",
    issuer: "Hyperlane",
    chain: "aleo",
    contract: "hyp_warp_token_zec_v2.aleo",
    decimals: 8,
    status: "checked",
    backing: {
      kind: "locked",
      tokenId: "solana-omni",
      account: "2RBzic8nUNJ8KngRRbsCEjkeM9CtpQN2CCqU1cs1n2y5",
    },
    evidence:
      "https://github.com/hyperlane-xyz/hyperlane-registry/tree/main/deployments/warp_routes/ZEC",
    verifiedOn: "2026-11-15",
    note: "A synthetic on Aleo against Solana's Omni ZEC locked by Hyperlane: a third layer.",
  },
  {
    id: "hyperliquid-unit",
    name: "Unit ZEC",
    symbol: "UZEC",
    issuer: "Unit",
    chain: "hyperliquid",
    contract: "0x1c994ad3381d31c86c8c2d74ed89a365",
    decimals: 9,
    status: "checked",
    backing: { kind: "zcash", source: "t1KbKkQ7WisJF52sSepMjYokQJbkJCJ1i3C" },
    evidence: "https://docs.hyperunit.xyz/",
    verifiedOn: "2026-11-15",
    note:
      "Issued 21,000,000; outstanding is that minus Unit's reserve account " +
      "0x54cd89623888e8010fdea1c62e86265a9c6da950. The Zcash address first appears in our index " +
      "on 2026-03-02, the day the reserve account received the supply, and holds within 0.02% of " +
      "the outstanding UZEC.",
  },
  {
    id: "thorchain-secured",
    name: "Secured ZEC",
    symbol: "ZEC-ZEC",
    issuer: "THORChain",
    chain: "thorchain",
    contract: "ZEC-ZEC",
    decimals: 8,
    status: "checked",
    backing: { kind: "zcash", source: "thorchain inbound_addresses (ZEC vault)" },
    evidence: "https://dev.thorchain.org/concepts/secured-assets.html",
    verifiedOn: "2026-11-15",
  },
  {
    id: "thorchain-trade",
    name: "Trade ZEC",
    symbol: "ZEC~ZEC",
    issuer: "THORChain",
    chain: "thorchain",
    contract: "ZEC~ZEC",
    decimals: 8,
    status: "checked",
    backing: { kind: "zcash", source: "thorchain inbound_addresses (ZEC vault)" },
    evidence: "https://dev.thorchain.org/concepts/trade-accounts.html",
    verifiedOn: "2026-11-15",
  },
  {
    id: "maya-trade",
    name: "Trade ZEC",
    symbol: "ZEC~ZEC",
    issuer: "Maya Protocol",
    chain: "maya",
    contract: "ZEC~ZEC",
    decimals: 8,
    status: "checked",
    backing: { kind: "zcash", source: "mayachain inbound_addresses (ZEC vault)" },
    evidence: "https://docs.mayaprotocol.com/",
    verifiedOn: "2026-11-15",
  },
  {
    id: "maya-synth",
    name: "Synthetic ZEC",
    symbol: "ZEC/ZEC",
    issuer: "Maya Protocol",
    chain: "maya",
    contract: "ZEC/ZEC",
    decimals: 8,
    status: "checked",
    backing: { kind: "zcash", source: "mayachain inbound_addresses (ZEC vault)" },
    evidence: "https://docs.mayaprotocol.com/",
    verifiedOn: "2026-11-15",
  },
  {
    id: "hyperliquid-wagyu",
    name: "ZEC1",
    symbol: "ZEC1",
    issuer: "Wagyu",
    chain: "hyperliquid",
    contract: "0xbf88385232dba5bfbbc0b0b587779386",
    decimals: 9,
    status: "unchecked",
    backing: { kind: "unknown" },
    evidence: "https://app.hyperliquid.xyz/",
    verifiedOn: "2026-11-15",
    note: "Issued 21,000,000; outstanding is that minus the deployer 0x207700bd207df757825f9193ef9c648c1c65e06a.",
  },
  {
    id: "solana-zenzec",
    name: "zenZEC",
    symbol: "zenZEC",
    issuer: "Zenrock",
    chain: "solana",
    contract: "JDt9rRGaieF6aN1cJkXFeUmsy7ZE4yY3CZb8tVMXVroS",
    decimals: 8,
    status: "unchecked",
    backing: { kind: "unknown" },
    evidence: "https://www.zenzec.io",
    verifiedOn: "2026-11-15",
  },
  universal("base"),
  universal("unichain"),
  universal("arbitrum"),
  universal("worldchain"),
  universal("polygon"),
  universal("katana"),
  universal("solana", "HouLAv3gAthwjweq5eCWS8SkxpvXukaqtr47635F86Yq", 9),
  {
    id: "ethereum-wzec",
    name: "wZEC",
    symbol: "WZEC",
    issuer: "Wrapped (Tokensoft, Anchorage)",
    chain: "ethereum",
    contract: "0x4a64515e5e1d1073e83f30cb97bed20400b66e10",
    decimals: 18,
    status: "unchecked",
    backing: { kind: "unknown" },
    evidence: "https://www.coindesk.com/wrapped-zcash-ethereum-tokensoft-anchorage",
    verifiedOn: "2026-11-15",
  },
  {
    id: "robinhood-zeal",
    name: "zZEC",
    symbol: "zZEC",
    issuer: "Zeal",
    chain: "robinhood",
    contract: "0x1955d3b7EE8291DFbc8188E73409a42654913A25",
    decimals: 8,
    status: "unchecked",
    backing: { kind: "unknown" },
    evidence: "https://www.zecdock.family/",
    verifiedOn: "2026-11-15",
  },
  {
    id: "bsc-binance-peg",
    name: "Binance-Peg ZEC",
    symbol: "ZEC",
    issuer: "Binance",
    chain: "bsc",
    contract: "0x1ba42e5193dfa8b03d15dd1b86a3113bbbef8eeb",
    decimals: 18,
    status: "custodial",
    backing: { kind: "custody", custodian: "Binance" },
    evidence: "https://www.coingecko.com/en/coins/binance-peg-zcash-token",
    verifiedOn: "2026-11-15",
    note:
      "Issued 220,000; most of it sits in Binance's own BSC wallets, so issued and held outside " +
      "Binance are separate figures.",
  },
  {
    id: "base-cbzec",
    name: "Coinbase Wrapped ZEC",
    symbol: "cbZEC",
    issuer: "Coinbase",
    chain: "base",
    contract: "0xB2000000000000000000008501b13360000cb2EC",
    decimals: 8,
    status: "custodial",
    backing: { kind: "custody", custodian: "Coinbase" },
    evidence: "https://www.coinbase.com/campaigns/wrapped-assets",
    verifiedOn: "2026-11-15",
  },
  {
    id: "ethereum-renzec",
    name: "renZEC",
    symbol: "renZEC",
    issuer: "Ren (closed 2022)",
    chain: "ethereum",
    contract: "0x1c5db575e2ff833e46a2e9864c22f4b22e0b37c2",
    decimals: 8,
    status: "orphaned",
    backing: { kind: "unknown" },
    evidence: "https://medium.com/renprotocol",
    verifiedOn: "2026-11-15",
  },
  {
    id: "solana-renzec",
    name: "renZEC",
    symbol: "renZEC",
    issuer: "Ren (closed 2022)",
    chain: "solana",
    contract: "E99CQ2gFMmbiyK2bwiaFNWUUmwz4r8k2CVEFxwuvQ7ue",
    decimals: 8,
    status: "orphaned",
    backing: { kind: "unknown" },
    evidence:
      "https://medium.com/renprotocol/renvm-integrates-with-solana-for-interoperability-cee10832356a",
    verifiedOn: "2026-11-15",
  },
  // Named ZEC, never counted.
  {
    id: "robinhood-zcash-fund",
    name: "Zcash (fund token)",
    symbol: "ZEC",
    issuer: "unknown",
    chain: "robinhood",
    contract: "0xEc127e99Da1a2eD3d6C0433227154a99B7B29221",
    decimals: 18,
    status: "excluded",
    backing: { kind: "unknown" },
    evidence: "contract reads: a 1x long vault over USDG and a Lighter position",
    verifiedOn: "2026-11-15",
    note: "Tracks a ZEC position with stablecoins; holds no ZEC.",
  },
  {
    id: "base-impostor",
    name: "ZEC (impostor)",
    symbol: "ZEC",
    issuer: "unknown",
    chain: "base",
    contract: "0xC844f1ED61ff576cccb344F2197bdfE9b8431D2C",
    decimals: 18,
    status: "excluded",
    backing: { kind: "unknown" },
    evidence: "totalSupply() = 1,000,000,000",
    verifiedOn: "2026-11-15",
    note: "Calls itself ZEC. Not issued against ZEC.",
  },
  {
    id: "hyperliquid-bitfrost",
    name: "BZEC",
    symbol: "BZEC",
    issuer: "Bitfrost",
    chain: "hyperliquid",
    contract: "0x33b2c5252e8ea8431808129c41668129",
    decimals: 8,
    status: "excluded",
    backing: { kind: "unknown" },
    evidence: "Hyperliquid spot price about $44 on 2026-11-15",
    verifiedOn: "2026-11-15",
    note: "Trades far below ZEC's price: off-peg.",
  },
  {
    id: "hyperliquid-izec",
    name: "IZEC",
    symbol: "IZEC",
    issuer: "unknown",
    chain: "hyperliquid",
    contract: "0x2bfad83b63d172b0b74279bd1f282d20",
    decimals: 8,
    status: "excluded",
    backing: { kind: "unknown" },
    evidence: "Hyperliquid spot price about $0.0027 on 2026-11-15",
    verifiedOn: "2026-11-15",
    note: "Not a claim on ZEC.",
  },
];

/** The listed token for an id, or undefined. */
export function wrappedToken(id: string): WrappedToken | undefined {
  return WRAPPED_ZEC.find((t) => t.id === id);
}

/**
 * Whether a token's supply is counted in a total. A token locked to issue another is counted once,
 * at the bottom: its locked balance is subtracted where the total is computed, never here.
 */
export function countsTowardTotals(t: WrappedToken): boolean {
  return t.status !== "excluded";
}
