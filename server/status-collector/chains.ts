/**
 * Read-only calls to other chains' public nodes, with no account. Each returns raw integers as
 * strings, so no supply ever passes through a float.
 */

const TIMEOUT_MS = 20_000;

export const RPC = {
  ethereum: "https://ethereum-rpc.publicnode.com",
  base: "https://mainnet.base.org",
  bsc: "https://bsc-dataseed.bnbchain.org",
  arbitrum: "https://arb1.arbitrum.io/rpc",
  unichain: "https://mainnet.unichain.org",
  worldchain: "https://worldchain-mainnet.g.alchemy.com/public",
  polygon: "https://polygon-bor-rpc.publicnode.com",
  katana: "https://rpc.katana.network",
  robinhood: "https://rpc.mainnet.chain.robinhood.com",
  solana: "https://api.mainnet-beta.solana.com",
  near: "https://rpc.mainnet.near.org",
  starknet: "https://starknet-rpc.publicnode.com",
  aptos: "https://fullnode.mainnet.aptoslabs.com/v1",
  hyperliquid: "https://api.hyperliquid.xyz/info",
} as const;

export type EvmChain =
  | "ethereum"
  | "base"
  | "bsc"
  | "arbitrum"
  | "unichain"
  | "worldchain"
  | "polygon"
  | "katana"
  | "robinhood";

async function postJson(url: string, body: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "shieldedscan-status/1" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`http ${res.status}`);
  }
  return res.json();
}

/** A JSON-RPC result, or a thrown error naming the node's own error. */
async function rpc(url: string, method: string, params: unknown): Promise<unknown> {
  const out = (await postJson(url, { jsonrpc: "2.0", id: 1, method, params })) as {
    result?: unknown;
    error?: { message?: string };
  };
  if (out.error) throw new Error(`rpc: ${out.error.message ?? JSON.stringify(out.error)}`);
  if (out.result === undefined || out.result === null) throw new Error("rpc: empty result");
  return out.result;
}

const hexToDec = (hex: unknown): string => {
  if (typeof hex !== "string" || !/^0x[0-9a-f]*$/i.test(hex) || hex === "0x")
    throw new Error(`not a hex integer: ${String(hex).slice(0, 40)}`);
  return BigInt(hex).toString();
};

/** ERC-20 `totalSupply()`. */
export async function evmTotalSupply(chain: EvmChain, token: string): Promise<string> {
  return hexToDec(await rpc(RPC[chain], "eth_call", [{ to: token, data: "0x18160ddd" }, "latest"]));
}

/** ERC-20 `decimals()`. */
export async function evmDecimals(chain: EvmChain, token: string): Promise<number> {
  return Number(
    hexToDec(await rpc(RPC[chain], "eth_call", [{ to: token, data: "0x313ce567" }, "latest"])),
  );
}

/** ERC-20 `balanceOf(holder)`. */
export async function evmBalanceOf(
  chain: EvmChain,
  token: string,
  holder: string,
): Promise<string> {
  const data = `0x70a08231${holder.slice(2).toLowerCase().padStart(64, "0")}`;
  return hexToDec(await rpc(RPC[chain], "eth_call", [{ to: token, data }, "latest"]));
}

/** SPL token supply. */
export async function solanaSupply(mint: string): Promise<string> {
  const r = (await rpc(RPC.solana, "getTokenSupply", [mint])) as { value?: { amount?: string } };
  if (typeof r.value?.amount !== "string") throw new Error("solana: no amount");
  return r.value.amount;
}

/** A NEAR view call, parsed as JSON. */
export async function nearView(account: string, method: string, args: unknown): Promise<unknown> {
  const r = (await rpc(RPC.near, "query", {
    request_type: "call_function",
    finality: "final",
    account_id: account,
    method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
  })) as { result?: number[] };
  if (!Array.isArray(r.result)) throw new Error("near: no result bytes");
  return JSON.parse(Buffer.from(r.result).toString("utf8"));
}

export async function nearFtSupply(token: string): Promise<string> {
  return String(await nearView(token, "ft_total_supply", {}));
}

export async function nearFtBalance(token: string, account: string): Promise<string> {
  return String(await nearView(token, "ft_balance_of", { account_id: account }));
}

/** Cairo `total_supply`, a u256 returned as [low, high]. */
export async function starknetTotalSupply(token: string): Promise<string> {
  const r = await rpc(RPC.starknet, "starknet_call", [
    {
      contract_address: token,
      entry_point_selector: "0x1557182e4359a1f0c6301278e8f5b35a776ab58d39892581e357578fb287836",
      calldata: [],
    },
    "latest",
  ]);
  if (!Array.isArray(r) || r.length < 2) throw new Error("starknet: unexpected result");
  return (BigInt(hexToDec(r[0])) + (BigInt(hexToDec(r[1])) << 128n)).toString();
}

/** An Aptos fungible asset's supply. */
export async function aptosSupply(metadata: string): Promise<string> {
  const r = await postJson(`${RPC.aptos}/view`, {
    function: "0x1::fungible_asset::supply",
    type_arguments: ["0x1::fungible_asset::Metadata"],
    arguments: [metadata],
  });
  const v = (r as { vec?: string[] }[])[0]?.vec?.[0];
  if (typeof v !== "string") throw new Error("aptos: no supply");
  return v;
}

/** A Hyperliquid info query. */
export function hyperliquid(body: unknown): Promise<unknown> {
  return postJson(RPC.hyperliquid, body);
}

/** A Hyperliquid account's spot balance of one token, as a decimal string. */
export async function hyperliquidBalance(user: string, coin: string): Promise<string> {
  const s = (await hyperliquid({ type: "spotClearinghouseState", user })) as {
    balances?: { coin: string; total: string }[];
  };
  if (!Array.isArray(s.balances)) throw new Error("hyperliquid: no balances");
  return s.balances.find((b) => b.coin === coin)?.total ?? "0";
}

/** `units` as an integer string scaled by `decimals`, from a decimal string like "123.45". */
export function decimalToUnits(value: string, decimals: number): string {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!m) throw new Error(`not a decimal: ${value}`);
  const frac = (m[2] ?? "").slice(0, decimals).padEnd(decimals, "0");
  return (BigInt(m[1]!) * 10n ** BigInt(decimals) + BigInt(frac || "0")).toString();
}

/** An integer string of `decimals`-scaled units, written as a decimal. */
export function unitsToDecimal(units: string, decimals: number): string {
  const neg = units.startsWith("-");
  const digits = (neg ? units.slice(1) : units).padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals);
  const frac = decimals ? digits.slice(digits.length - decimals).replace(/0+$/, "") : "";
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}
