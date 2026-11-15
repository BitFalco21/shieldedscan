/**
 * What the status collector watches. Each entry was checked by hand against the live service on
 * 2026-11-15 (the plan in the ops repo records how). Everything here is a public endpoint read with
 * no account; the collector records raw observations only, and verdicts are derived later.
 *
 * Signals that can be rebuilt from data this explorer already stores (block gaps, a pool's last
 * block, a venue's last completed swap, node counts) are deliberately NOT collected here.
 */

export interface WalletServer {
  host: string;
  port: number;
  operator: string;
}

/** Public light-wallet servers (lightwalletd / Zaino), from wallet defaults and ZecHub's list. */
export const WALLET_SERVERS: readonly WalletServer[] = [
  { host: "zec.rocks", port: 443, operator: "zec.rocks" },
  { host: "na.zec.rocks", port: 443, operator: "zec.rocks" },
  { host: "eu.zec.rocks", port: 443, operator: "zec.rocks" },
  { host: "ap.zec.rocks", port: 443, operator: "zec.rocks" },
  { host: "sa.zec.rocks", port: 443, operator: "zec.rocks" },
  { host: "zaino.unsafe.zec.rocks", port: 443, operator: "zec.rocks" },
  { host: "zec-node.cakewallet.com", port: 443, operator: "Cake Wallet" },
  { host: "lwd.zcashexplorer.app", port: 9067, operator: "community" },
  { host: "zec.0xrpc.io", port: 443, operator: "community" },
  { host: "lwd.z0n.jp", port: 443, operator: "community" },
  { host: "l.ombie.cash", port: 443, operator: "community" },
  { host: "z.ombie.cash", port: 443, operator: "community" },
];

/** DNS seeders in Zebra's defaults (zebra-network/src/config.rs). Asked at their own nameservers. */
export const SEEDERS: readonly { name: string; network: "mainnet" | "testnet" }[] = [
  { name: "dnsseed.z.cash", network: "mainnet" },
  { name: "dnsseed.str4d.xyz", network: "mainnet" },
  { name: "mainnet.seeder.zfnd.org", network: "mainnet" },
  { name: "mainnet.seeder.shieldedinfra.net", network: "mainnet" },
  { name: "seeder.zec.rocks", network: "mainnet" },
  { name: "dnsseed.testnet.z.cash", network: "testnet" },
  { name: "testnet.seeder.zfnd.org", network: "testnet" },
  { name: "seeder.testnet.zec.rocks", network: "testnet" },
];

const THOR = "https://gateway.liquify.com/chain/thorchain_api/thorchain";
const MAYA = "https://mayanode.mayachain.info/mayachain";

/** A JSON endpoint, how often to read it, and what of its answer to keep (never the whole body). */
export interface JsonTarget {
  id: string;
  url: string;
  everyMinutes: number;
  keep: (body: unknown) => unknown;
}

type Row = Record<string, unknown>;

/**
 * The extractors THROW on a shape they do not expect, and the collector records that as a failed
 * read. Returning `[]` instead would be indistinguishable later from "ZEC is not listed".
 */
const arr = (b: unknown, what: string): Row[] => {
  if (!Array.isArray(b)) throw new Error(`unexpected shape: ${what} is not a list`);
  return b.filter((x): x is Row => x !== null && typeof x === "object");
};
const obj = (b: unknown, what: string): Row => {
  if (b === null || typeof b !== "object" || Array.isArray(b))
    throw new Error(`unexpected shape: ${what} is not an object`);
  return b as Row;
};
const pick = (o: Row, keys: readonly string[]) =>
  Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]));
const zecKeys = (o: Row) =>
  Object.fromEntries(Object.entries(o).filter(([k]) => k.includes("ZEC")));
/** A venue that answers HTTP 200 with an error envelope: the envelope is the observation. */
const venueError = (detail: unknown): never => {
  throw new Error(`venue error: ${JSON.stringify(detail).slice(0, 200)}`);
};
const mimir = (b: unknown) => {
  const o = obj(b, "mimir");
  return { ...zecKeys(o), ...pick(o, ["NODEPAUSECHAINGLOBAL"]) };
};
/** A Statuspage `components.json`: the entries naming Zcash, with their status. */
const statuspage = (b: unknown) =>
  arr(obj(b, "body").components, "components")
    .filter((c) => /zcash|\bzec\b/i.test(String(c.name)))
    .map((c) => pick(c, ["name", "status", "updated_at"]));

export const JSON_TARGETS: readonly JsonTarget[] = [
  // Our own tip, read in-network, so a wallet server's height is compared at the same moment.
  {
    id: "ours.status",
    url: "http://explorer-api-public:8080/v1/status",
    everyMinutes: 1,
    keep: (b) => pick(obj(b, "body"), ["height", "bestBlockHash", "lastBlockTimestamp"]),
  },
  // THORChain: the computed flags are the verdict; mimir values are heights (explanation only).
  {
    id: "thorchain.inbound",
    url: `${THOR}/inbound_addresses`,
    everyMinutes: 5,
    keep: (b) =>
      arr(b, "body")
        .filter((a) => a.chain === "ZEC")
        .map((a) =>
          pick(a, [
            "halted",
            "chain_trading_paused",
            "global_trading_paused",
            "chain_lp_actions_paused",
          ]),
        ),
  },
  {
    id: "thorchain.pool",
    url: `${THOR}/pool/ZEC.ZEC`,
    everyMinutes: 5,
    keep: (b) => pick(obj(b, "body"), ["status", "trading_halted"]),
  },
  {
    id: "thorchain.lastblock",
    url: `${THOR}/lastblock/ZEC`,
    everyMinutes: 5,
    keep: (b) =>
      arr(b, "body").map((a) => pick(a, ["last_observed_in", "last_signed_out", "thorchain"])),
  },
  { id: "thorchain.mimir", url: `${THOR}/mimir`, everyMinutes: 10, keep: mimir },
  {
    id: "maya.inbound",
    url: `${MAYA}/inbound_addresses`,
    everyMinutes: 5,
    keep: (b) =>
      arr(b, "body")
        .filter((a) => a.chain === "ZEC")
        .map((a) => pick(a, ["halted"])),
  },
  {
    id: "maya.pool",
    url: `${MAYA}/pool/ZEC.ZEC`,
    everyMinutes: 5,
    keep: (b) => pick(obj(b, "body"), ["status"]),
  },
  {
    id: "maya.lastblock",
    url: `${MAYA}/lastblock/ZEC`,
    everyMinutes: 5,
    keep: (b) =>
      arr(b, "body").map((a) => pick(a, ["last_observed_in", "last_signed_out", "mayachain"])),
  },
  { id: "maya.mimir", url: `${MAYA}/mimir`, everyMinutes: 10, keep: mimir },
  // NEAR Intents publishes no halt flag: only whether ZEC is listed.
  {
    id: "near.tokens",
    url: "https://1click.chaindefuser.com/v0/tokens",
    everyMinutes: 10,
    keep: (b) => ({
      zecListed: arr(b, "body")
        .filter((t) => t.blockchain === "zec" && t.symbol === "ZEC")
        .map((t) => t.assetId),
    }),
  },
  // Exchanges, each through its own published status, no account.
  {
    id: "kraken.asset",
    url: "https://api.kraken.com/0/public/Assets?asset=ZEC",
    everyMinutes: 5,
    keep: (b) => {
      const o = obj(b, "body");
      if (Array.isArray(o.error) && o.error.length > 0) venueError(o.error);
      return Object.values(obj(o.result, "result")).map((a) => pick(obj(a, "asset"), ["status"]));
    },
  },
  {
    id: "coinbase.currency",
    url: "https://api.exchange.coinbase.com/currencies/ZEC",
    everyMinutes: 5,
    keep: (b) => {
      const o = obj(b, "body");
      return {
        ...pick(o, ["status", "message"]),
        networks: arr(o.supported_networks, "supported_networks").map((n) =>
          pick(n, ["id", "status"]),
        ),
      };
    },
  },
  {
    id: "kucoin.currency",
    url: "https://api.kucoin.com/api/v3/currencies/ZEC",
    everyMinutes: 5,
    keep: (b) => {
      const o = obj(b, "body");
      if (o.code !== "200000") venueError(pick(o, ["code", "msg"]));
      return arr(obj(o.data, "data").chains, "chains").map((c) =>
        pick(c, ["chainId", "isDepositEnabled", "isWithdrawEnabled"]),
      );
    },
  },
  {
    id: "gate.currency",
    url: "https://api.gateio.ws/api/v4/spot/currencies/ZEC",
    everyMinutes: 5,
    keep: (b) => {
      const o = obj(b, "body");
      if ("label" in o) venueError(pick(o, ["label", "message"]));
      return pick(o, [
        "delisted",
        "deposit_disabled",
        "withdraw_disabled",
        "withdraw_delayed",
        "trade_disabled",
      ]);
    },
  },
  {
    id: "htx.currency",
    url: "https://api.huobi.pro/v2/reference/currencies?currency=zec",
    everyMinutes: 5,
    keep: (b) => {
      const o = obj(b, "body");
      if (o.code !== 200) venueError(pick(o, ["code", "message"]));
      return arr(o.data, "data").flatMap((c) =>
        arr(c.chains, "chains").map((ch) => pick(ch, ["chain", "depositStatus", "withdrawStatus"])),
      );
    },
  },
  {
    id: "binance.web",
    url: "https://www.binance.com/bapi/capital/v1/public/capital/getNetworkCoinAll",
    everyMinutes: 10,
    keep: (b) => {
      const o = obj(b, "body");
      if (o.success !== true) venueError(pick(o, ["code", "message", "success"]));
      return arr(o.data, "data")
        .filter((c) => c.coin === "ZEC")
        .map((c) => ({
          ...pick(c, ["depositAllEnable", "withdrawAllEnable"]),
          networks: arr(c.networkList, "networkList").map((n) =>
            pick(n, ["network", "depositEnable", "withdrawEnable", "busy"]),
          ),
        }));
    },
  },
  {
    id: "okx.system",
    url: "https://www.okx.com/api/v5/system/status",
    everyMinutes: 10,
    keep: (b) => {
      const o = obj(b, "body");
      if (o.code !== "0") venueError(pick(o, ["code", "msg"]));
      return arr(o.data, "data").map((d) =>
        pick(d, ["title", "state", "begin", "end", "serviceType"]),
      );
    },
  },
  {
    id: "gemini.symbol",
    url: "https://api.gemini.com/v1/symbols/details/zecusd",
    everyMinutes: 10,
    keep: (b) => {
      const o = obj(b, "body");
      if (o.result === "error") venueError(pick(o, ["reason", "message"]));
      return pick(o, ["status"]);
    },
  },
  {
    id: "kraken.statuspage",
    url: "https://status.kraken.com/api/v2/components.json",
    everyMinutes: 10,
    keep: statuspage,
  },
  {
    id: "coinbase.statuspage",
    url: "https://status.coinbase.com/api/v2/components.json",
    everyMinutes: 10,
    keep: statuspage,
  },
  {
    id: "gemini.statuspage",
    url: "https://status.gemini.com/api/v2/components.json",
    everyMinutes: 10,
    keep: statuspage,
  },
];
