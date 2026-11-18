import { hyperliquid } from "./chains";

/**
 * Where ZEC trades: DEX pools holding a listed ZEC token, Hyperliquid's spot books, and each
 * exchange's own published spot volume. Every figure is what the venue reports; exchange volume in
 * particular cannot be checked against any chain, so it is kept as reported, never as measured.
 */

const UA = { accept: "application/json", "user-agent": "shieldedscan-status/1" };

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`http ${res.status}`);
  }
  return res.json();
}

type Row = Record<string, unknown>;
const obj = (b: unknown, what: string): Row => {
  if (b === null || typeof b !== "object" || Array.isArray(b))
    throw new Error(`unexpected shape: ${what} is not an object`);
  return b as Row;
};
const arr = (b: unknown, what: string): Row[] => {
  if (!Array.isArray(b)) throw new Error(`unexpected shape: ${what} is not a list`);
  return b.filter((x): x is Row => x !== null && typeof x === "object");
};

/**
 * Listed ZEC tokens whose pools GeckoTerminal indexes: [token id, GeckoTerminal network, address].
 * Aptos's Omni ZEC is not indexed there (404), so it is not asked.
 */
export const DEX_TOKENS: readonly [string, string, string][] = [
  ["solana-omni", "solana", "A7bdiYdS5GjqGFtxf17ppRHtDKPkkRqbKtR27dxvQXaS"],
  ["solana-zenzec", "solana", "JDt9rRGaieF6aN1cJkXFeUmsy7ZE4yY3CZb8tVMXVroS"],
  ["solana-universal", "solana", "HouLAv3gAthwjweq5eCWS8SkxpvXukaqtr47635F86Yq"],
  ["bsc-binance-peg", "bsc", "0x1ba42e5193dfa8b03d15dd1b86a3113bbbef8eeb"],
  ["base-cbzec", "base", "0xB2000000000000000000008501b13360000cb2EC"],
  ["base-universal", "base", "0x83f31af747189c2fa9e5deb253200c505eff6ed2"],
  ["near-omni", "near", "zec.omft.near"],
  [
    "starknet-omni",
    "starknet-alpha",
    "0x05ce53b9b68fb8e9ecab9283a96d97948914733fd6ed8d9a53a276a419497841",
  ],
  ["ethereum-renzec", "eth", "0x1c5db575e2ff833e46a2e9864c22f4b22e0b37c2"],
];

/** GET once, and once more after a 429, waiting what the venue asks (at most 60 s). */
async function getJsonPolite(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20_000) });
  if (res.status === 429) {
    await res.body?.cancel();
    const wait = Math.min(60, Number(res.headers.get("retry-after")) || 30);
    await new Promise((r) => setTimeout(r, wait * 1000));
    return getJson(url);
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`http ${res.status}`);
  }
  return res.json();
}

/** The top pools holding one token, as GeckoTerminal reports them (USD, venue-computed). */
export async function geckoPools(network: string, address: string): Promise<Row[]> {
  const body = obj(
    await getJsonPolite(
      `https://api.geckoterminal.com/api/v2/networks/${network}/tokens/${address}/pools?page=1`,
    ),
    "body",
  );
  return arr(body.data, "data").map((p) => {
    const a = obj(p.attributes, "attributes");
    const r = obj(p.relationships ?? {}, "relationships");
    const id = (k: string) => (obj(r[k] ?? {}, k).data as Row | undefined)?.id ?? null;
    return {
      pool: a.address,
      name: a.name,
      dex: id("dex"),
      base: id("base_token"),
      quote: id("quote_token"),
      liquidityUsd: a.reserve_in_usd,
      volumeUsd24h: (a.volume_usd as Row | undefined)?.h24 ?? null,
      baseUsd: a.base_token_price_usd,
      quoteUsd: a.quote_token_price_usd,
      txs24h: (a.transactions as Row | undefined)?.h24 ?? null,
    };
  });
}

/** Hyperliquid spot pairs whose base is a ZEC-named token, with Hyperliquid's own day figures. */
export async function hyperliquidZecBooks(): Promise<Row[]> {
  const [meta, ctxs] = arr(await hyperliquid({ type: "spotMetaAndAssetCtxs" }), "body") as [
    Row,
    Row,
  ];
  const tokens = arr(meta.tokens, "tokens");
  const universe = arr(meta.universe, "universe");
  const ctxList = arr(ctxs as unknown, "ctxs");
  const name = (i: unknown) => tokens.find((t) => t.index === i)?.name;
  const out: Row[] = [];
  for (const u of universe) {
    const pair = Array.isArray(u.tokens) ? u.tokens : [];
    const base = name(pair[0]);
    if (typeof base !== "string" || !/ZEC/i.test(base)) continue;
    const c = ctxList[Number(u.index)] ?? {};
    out.push({
      pair: `${base}/${name(pair[1]) ?? "?"}`,
      coin: u.name,
      dayNtlVlm: c.dayNtlVlm,
      dayBaseVlm: c.dayBaseVlm,
      markPx: c.markPx,
      midPx: c.midPx,
    });
  }
  return out;
}

/**
 * Each exchange's own 24-hour spot ticker for its ZEC pairs, base volume in ZEC. Established
 * venues only; the long tail is in the CoinGecko tickers snapshot, kept for comparison.
 */
export interface CexVenue {
  id: string;
  ticker: () => Promise<Row[]>;
  /** The last few daily candles, as given: [start (unix s), open, high, low, close, ZEC volume]. */
  candles: () => Promise<Candle[]>;
}

export type Candle = (string | number)[];

/**
 * Only candles whose day has ended. Most venues include today's, still open, among the last few;
 * storing it would record a partial day as a whole one.
 */
export function closedCandles(rows: Candle[], nowSec: number): Candle[] {
  return rows.filter((r) => Number(r[0]) + 86_400 <= nowSec);
}

const n = (v: unknown): string => {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "string" && /^-?\d+(\.\d+)?(e-?\d+)?$/i.test(v)) return v;
  throw new Error(`unexpected shape: not a number (${String(v).slice(0, 20)})`);
};
const tick = (pair: string, volumeZec: unknown, last: unknown): Row => ({
  pair,
  volumeZec: n(volumeZec),
  last: n(last),
});
const s = (ms: number) => Math.floor(ms / 1000);

export const CEX: readonly CexVenue[] = [
  {
    id: "binance",
    ticker: async () =>
      arr(
        await getJson(
          'https://api.binance.com/api/v3/ticker/24hr?symbols=["ZECUSDT","ZECUSDC","ZECBTC"]',
        ),
        "body",
      ).map((t) => tick(String(t.symbol), t.volume, t.lastPrice)),
    candles: async () =>
      arr(
        (await getJson(
          "https://api.binance.com/api/v3/klines?symbol=ZECUSDT&interval=1d&limit=4",
        )) as unknown,
        "body",
      ).map((k) => {
        const r = k as unknown as unknown[];
        return [s(Number(r[0])), n(r[1]), n(r[2]), n(r[3]), n(r[4]), n(r[5])];
      }),
  },
  {
    id: "coinbase",
    ticker: async () => {
      const o = obj(
        await getJson("https://api.exchange.coinbase.com/products/ZEC-USD/stats"),
        "body",
      );
      return [tick("ZEC-USD", o.volume, o.last)];
    },
    candles: async () =>
      (
        (await getJson(
          "https://api.exchange.coinbase.com/products/ZEC-USD/candles?granularity=86400",
        )) as unknown[][]
      )
        .slice(0, 4)
        .map((r) => [Number(r[0]), n(r[3]), n(r[2]), n(r[1]), n(r[4]), n(r[5])]),
  },
  {
    id: "okx",
    ticker: async () => {
      const o = obj(
        await getJson("https://www.okx.com/api/v5/market/tickers?instType=SPOT"),
        "body",
      );
      if (o.code !== "0") throw new Error(`venue error: ${String(o.msg)}`);
      return arr(o.data, "data")
        .filter((t) => String(t.instId).startsWith("ZEC-"))
        .map((t) => tick(String(t.instId), t.vol24h, t.last));
    },
    candles: async () => {
      const o = obj(
        await getJson(
          "https://www.okx.com/api/v5/market/history-candles?instId=ZEC-USDT&bar=1Dutc&limit=4",
        ),
        "body",
      );
      return (o.data as unknown[][]).map((r) => [
        s(Number(r[0])),
        n(r[1]),
        n(r[2]),
        n(r[3]),
        n(r[4]),
        n(r[5]),
      ]);
    },
  },
  {
    id: "kraken",
    ticker: async () => {
      const o = obj(
        await getJson("https://api.kraken.com/0/public/Ticker?pair=ZECUSD,ZECEUR"),
        "body",
      );
      if (Array.isArray(o.error) && o.error.length)
        throw new Error(`venue error: ${o.error.join(",")}`);
      return Object.entries(obj(o.result, "result")).map(([k, v]) => {
        const t = obj(v, k);
        return tick(k, (t.v as unknown[])[1], (t.c as unknown[])[0]);
      });
    },
    candles: async () => {
      const o = obj(
        await getJson("https://api.kraken.com/0/public/OHLC?pair=ZECUSD&interval=1440"),
        "body",
      );
      const res = obj(o.result, "result");
      const key = Object.keys(res).find((k) => k !== "last");
      return (res[key ?? ""] as unknown[][])
        .slice(-4)
        .map((r) => [Number(r[0]), n(r[1]), n(r[2]), n(r[3]), n(r[4]), n(r[6])]);
    },
  },
  {
    id: "kucoin",
    ticker: async () => {
      const out: Row[] = [];
      for (const p of ["ZEC-USDT", "ZEC-BTC"]) {
        const o = obj(
          await getJson(`https://api.kucoin.com/api/v1/market/stats?symbol=${p}`),
          "body",
        );
        if (o.code !== "200000") throw new Error(`venue error: ${String(o.msg)}`);
        const d = obj(o.data, "data");
        out.push(tick(p, d.vol, d.last));
      }
      return out;
    },
    candles: async () => {
      const o = obj(
        await getJson("https://api.kucoin.com/api/v1/market/candles?type=1day&symbol=ZEC-USDT"),
        "body",
      );
      return (o.data as unknown[][])
        .slice(0, 4)
        .map((r) => [Number(r[0]), n(r[1]), n(r[3]), n(r[4]), n(r[2]), n(r[5])]);
    },
  },
  {
    id: "gate",
    ticker: async () =>
      arr(
        await getJson("https://api.gateio.ws/api/v4/spot/tickers?currency_pair=ZEC_USDT"),
        "body",
      ).map((t) => tick(String(t.currency_pair), t.base_volume, t.last)),
    candles: async () =>
      (
        (await getJson(
          "https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=ZEC_USDT&interval=1d&limit=4",
        )) as unknown[][]
      ).map((r) => [Number(r[0]), n(r[5]), n(r[3]), n(r[4]), n(r[2]), n(r[6])]),
  },
  {
    id: "htx",
    ticker: async () => {
      const o = obj(
        await getJson("https://api.huobi.pro/market/detail/merged?symbol=zecusdt"),
        "body",
      );
      if (o.status !== "ok") throw new Error(`venue error: ${String(o["err-msg"])}`);
      const t = obj(o.tick, "tick");
      return [tick("zecusdt", t.amount, t.close)];
    },
    // HTX's daily candle starts at 16:00 UTC (midnight in Singapore); the start time is kept as given.
    candles: async () => {
      const o = obj(
        await getJson(
          "https://api.huobi.pro/market/history/kline?symbol=zecusdt&period=1day&size=4",
        ),
        "body",
      );
      return arr(o.data, "data").map((r) => [
        Number(r.id),
        n(r.open),
        n(r.high),
        n(r.low),
        n(r.close),
        n(r.amount),
      ]);
    },
  },
  {
    id: "gemini",
    ticker: async () => {
      const o = obj(await getJson("https://api.gemini.com/v1/pubticker/zecusd"), "body");
      return [tick("zecusd", obj(o.volume, "volume").ZEC, o.last)];
    },
    candles: async () =>
      ((await getJson("https://api.gemini.com/v2/candles/zecusd/1day")) as unknown[][])
        .slice(0, 4)
        .map((r) => [s(Number(r[0])), n(r[1]), n(r[2]), n(r[3]), n(r[4]), n(r[5])]),
  },
  {
    id: "bitget",
    ticker: async () => {
      const o = obj(
        await getJson("https://api.bitget.com/api/v2/spot/market/tickers?symbol=ZECUSDT"),
        "body",
      );
      if (o.code !== "00000") throw new Error(`venue error: ${String(o.msg)}`);
      return arr(o.data, "data").map((t) => tick(String(t.symbol), t.baseVolume, t.lastPr));
    },
    candles: async () => {
      const o = obj(
        await getJson(
          "https://api.bitget.com/api/v2/spot/market/candles?symbol=ZECUSDT&granularity=1Dutc&limit=4",
        ),
        "body",
      );
      return (o.data as unknown[][]).map((r) => [
        s(Number(r[0])),
        n(r[1]),
        n(r[2]),
        n(r[3]),
        n(r[4]),
        n(r[5]),
      ]);
    },
  },
  {
    id: "poloniex",
    ticker: async () => {
      const o = obj(await getJson("https://api.poloniex.com/markets/ZEC_USDT/ticker24h"), "body");
      return [tick("ZEC_USDT", o.quantity, o.close)];
    },
    candles: async () =>
      (
        (await getJson(
          "https://api.poloniex.com/markets/ZEC_USDT/candles?interval=DAY_1&limit=4",
        )) as unknown[][]
      ).map((r) => [s(Number(r[12])), n(r[2]), n(r[1]), n(r[0]), n(r[3]), n(r[5])]),
  },
  {
    id: "whitebit",
    ticker: async () => {
      const o = obj(await getJson("https://whitebit.com/api/v4/public/ticker"), "body");
      return (
        Object.entries(o)
          // Spot pairs only: the same list carries WhiteBIT's ZEC perpetual.
          .filter(([k]) => k.startsWith("ZEC_") && !k.endsWith("_PERP"))
          .map(([k, v]) => {
            const t = obj(v, k);
            return tick(k, t.base_volume, t.last_price);
          })
      );
    },
    candles: async () => {
      const o = obj(
        await getJson(
          "https://whitebit.com/api/v1/public/kline?market=ZEC_USDT&interval=1d&limit=4",
        ),
        "body",
      );
      return (o.result as unknown[][]).map((r) => [
        Number(r[0]),
        n(r[1]),
        n(r[3]),
        n(r[4]),
        n(r[2]),
        n(r[5]),
      ]);
    },
  },
];

/** CoinGecko's own list of every venue trading ZEC: the long tail, kept to compare, never summed in. */
export async function coingeckoTickers(): Promise<Row[]> {
  const o = obj(
    await getJson("https://api.coingecko.com/api/v3/coins/zcash/tickers?order=volume_desc"),
    "body",
  );
  return arr(o.tickers, "tickers").map((t) => ({
    market: obj(t.market, "market").identifier,
    base: t.base,
    target: t.target,
    volumeZec: t.volume,
    volumeUsd: obj(t.converted_volume ?? {}, "converted_volume").usd ?? null,
    anomaly: t.is_anomaly,
    stale: t.is_stale,
    lastTradedAt: t.last_traded_at,
  }));
}
