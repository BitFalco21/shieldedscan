import { WRAPPED_ZEC, type WrappedToken } from "@/domain/wrapped-zec";

import {
  aptosSupply,
  decimalToUnits,
  evmBalanceOf,
  evmDecimals,
  evmTotalSupply,
  hyperliquidBalance,
  nearFtBalance,
  nearFtSupply,
  nearView,
  solanaSupply,
  starknetTotalSupply,
  unitsToDecimal,
  type EvmChain,
} from "./chains";

/**
 * Supply of every listed ZEC token on other chains, plus the balances that back or hold it.
 * Observations only: totals and the subtraction of locked balances happen when the data is read.
 */

const THOR = "https://gateway.liquify.com/chain/thorchain_api/thorchain";
const MAYA = "https://mayanode.mayachain.info/mayachain";

async function getJson(url: string): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    headers: { accept: "application/json", "user-agent": "shieldedscan-status/1" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`http ${res.status}`);
  }
  const body: unknown = await res.json();
  if (body === null || typeof body !== "object" || Array.isArray(body))
    throw new Error("unexpected shape: not an object");
  return body as Record<string, unknown>;
}

const intField = (o: Record<string, unknown>, key: string): string => {
  const v = o[key];
  if (typeof v !== "string" || !/^\d+$/.test(v)) throw new Error(`unexpected shape: ${key}`);
  return v;
};

/** Hyperliquid tokens are issued whole at genesis; outstanding is the issue minus what the issuer keeps. */
const HL_ISSUED = "21000000";
const HL_RESERVE: Record<string, { account: string; coin: string }> = {
  "hyperliquid-unit": { account: "0x54cd89623888e8010fdea1c62e86265a9c6da950", coin: "UZEC" },
  "hyperliquid-wagyu": { account: "0x207700bd207df757825f9193ef9c648c1c65e06a", coin: "ZEC1" },
};

const EVM: readonly EvmChain[] = [
  "ethereum",
  "base",
  "bsc",
  "arbitrum",
  "unichain",
  "worldchain",
  "polygon",
  "katana",
  "robinhood",
];

/** The token's supply in its own smallest units, or a thrown error. Null: no reader yet. */
export async function readSupplyUnits(t: WrappedToken): Promise<string | null> {
  if ((EVM as readonly string[]).includes(t.chain)) {
    const chain = t.chain as EvmChain;
    // A wrong decimals entry would misstate the supply by orders of magnitude: refuse it.
    const decimals = await evmDecimals(chain, t.contract);
    if (decimals !== t.decimals)
      throw new Error(`decimals: contract says ${decimals}, list says ${t.decimals}`);
    return evmTotalSupply(chain, t.contract);
  }
  switch (t.chain) {
    case "solana":
      return solanaSupply(t.contract);
    case "near":
      return nearFtSupply(t.contract);
    case "starknet":
      return starknetTotalSupply(t.contract);
    case "aptos":
      return aptosSupply(t.contract);
    case "hyperliquid": {
      const reserve = HL_RESERVE[t.id];
      if (!reserve) return null;
      const held = await hyperliquidBalance(reserve.account, reserve.coin);
      return (
        BigInt(decimalToUnits(HL_ISSUED, t.decimals)) - BigInt(decimalToUnits(held, t.decimals))
      ).toString();
    }
    case "thorchain":
      return t.id === "thorchain-secured"
        ? intField(await getJson(`${THOR}/securedasset/ZEC-ZEC`), "supply")
        : intField(await getJson(`${THOR}/trade/unit/ZEC~ZEC`), "units");
    case "maya":
      return t.id === "maya-trade"
        ? intField(await getJson(`${MAYA}/trade/unit/ZEC~ZEC`), "units")
        : intField(await getJson(`${MAYA}/pool/ZEC.ZEC`), "synth_supply");
    default:
      return null;
  }
}

/** Tokens to read: every listed token except those named ZEC that are never counted. */
export const SUPPLY_TOKENS = WRAPPED_ZEC.filter((t) => t.status !== "excluded");

export interface SupplyReading {
  units: string;
  decimals: number;
  supply: string;
}

export async function readSupply(t: WrappedToken): Promise<SupplyReading | null> {
  const units = await readSupplyUnits(t);
  return units === null
    ? null
    : { units, decimals: t.decimals, supply: unitsToDecimal(units, t.decimals) };
}

/** Balances that back a token or are held by its issuer, each read where it lives. */
export interface HoldingTarget {
  id: string;
  read: () => Promise<{ units: string; decimals: number }>;
}

const BINANCE_PEG = "0x1ba42e5193dfa8b03d15dd1b86a3113bbbef8eeb";

export const HOLDINGS: readonly HoldingTarget[] = [
  {
    id: "near-omni@omni.bridge.near",
    read: async () => ({
      units: await nearFtBalance("zec.omft.near", "omni.bridge.near"),
      decimals: 8,
    }),
  },
  {
    id: "near-omni@intents.near",
    read: async () => ({
      units: await nearFtBalance("zec.omft.near", "intents.near"),
      decimals: 8,
    }),
  },
  {
    id: "bsc-binance-peg@0xF977814e90dA44bFA03b6295A0616a897441aceC",
    read: async () => ({
      units: await evmBalanceOf("bsc", BINANCE_PEG, "0xF977814e90dA44bFA03b6295A0616a897441aceC"),
      decimals: 18,
    }),
  },
  {
    id: "bsc-binance-peg@0x5a52E96BAcdaBb82fd05763E25335261B270Efcb",
    read: async () => ({
      units: await evmBalanceOf("bsc", BINANCE_PEG, "0x5a52E96BAcdaBb82fd05763E25335261B270Efcb"),
      decimals: 18,
    }),
  },
];

interface Utxo {
  path?: string;
  vout?: number;
  balance?: string;
}

/**
 * Every Zcash coin the NEAR Omni Bridge says backs `zec.omft.near`, paged from its connector.
 * `full` keeps each coin's outpoint, for checking each one against our own index later.
 */
export async function readOmniReserve(full: boolean): Promise<{
  coins: number;
  zat: string;
  outpoints?: { outpoint: string; zat: string }[];
}> {
  const page = 200;
  let total = 0n;
  const outpoints: { outpoint: string; zat: string }[] = [];
  for (let from = 0; from < 100_000; from += page) {
    const r = (await nearView("zcash-connector.bridge.near", "get_utxos_paged", {
      from_index: from,
      limit: page,
    })) as Record<string, Utxo>;
    if (r === null || typeof r !== "object") throw new Error("unexpected shape: utxos");
    const entries = Object.entries(r);
    for (const [outpoint, u] of entries) {
      if (typeof u.balance !== "string" || !/^\d+$/.test(u.balance))
        throw new Error("unexpected shape: utxo balance");
      total += BigInt(u.balance);
      outpoints.push({ outpoint, zat: u.balance });
    }
    if (entries.length < page) break;
  }
  return {
    coins: outpoints.length,
    zat: total.toString(),
    ...(full ? { outpoints } : {}),
  };
}

/** Unit's Zcash reserve address, read from our own index through the public API, in-network. */
export const UNIT_ZCASH_RESERVE = "t1KbKkQ7WisJF52sSepMjYokQJbkJCJ1i3C";
