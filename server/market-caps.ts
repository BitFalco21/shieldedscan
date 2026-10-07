import type { Pool } from "pg";
import { rollbackQuietly } from "./pg-pool";
import type { MarketAsset, MarketSnapshot } from "@/domain";
import { readJsonCapped } from "./body-limit";

/**
 * Market capitalisations for Zcash and every asset larger than it, for `/compare`.
 *
 * The only data on the site neither read from the Zcash chain nor derived from something we
 * measure, so:
 *
 *  1. The fetch lives on the API service. The site's CSP (`connect-src 'self' <api>`) blocks a
 *     browser from calling the upstream, and serverless renders share no state, so a per-render
 *     fetch would multiply page views into third-party requests. One long-lived poller respects
 *     the rate limit.
 *  2. Reader traffic costs zero upstream calls: one `/coins/markets` request returns every asset
 *     the page can offer.
 *  3. Nothing is recomputed. The upstream's market cap is stored verbatim, never `price * supply`
 *     (the two come from different snapshots and disagree slightly). `domain/market.ts` explains
 *     which one the page anchors on.
 *
 * `PriceTracker` in `chain-stats.ts` polls the same upstream for the live ZEC price and is kept
 * separate, since it feeds the homepage's headline price.
 */

const MARKETS_URL =
  "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1&sparkline=false";

/**
 * The upstream's own stablecoin category, fetched rather than hardcoded so a stablecoin entering
 * the top ranks is excluded with no code change. It does not cover exchange tokens or tokenised
 * funds, which is why `domain/market.ts` keeps a small hand-maintained list beside it.
 */
const STABLECOINS_URL =
  "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&category=stablecoins&per_page=100&page=1&sparkline=false";

/** Market caps move slowly; this is about 13 calls an hour. */
const MARKETS_INTERVAL_MS = 5 * 60_000;
/** Which assets are stablecoins rarely changes. */
const STABLECOINS_INTERVAL_MS = 60 * 60_000;

/**
 * Past this age the snapshot is withheld and the page renders its unavailable state. Longer than
 * `PriceTracker`'s ceiling because a market cap moves more slowly, but still bounded: an old
 * market cap shown as current is a fabricated figure.
 */
const MAX_AGE_MS = 30 * 60_000;

/** Zcash's id upstream. The snapshot is meaningless without it, so its absence means null. */
const ZCASH_ID = "zcash";

interface RawMarketRow {
  id?: unknown;
  symbol?: unknown;
  name?: unknown;
  market_cap?: unknown;
  current_price?: unknown;
  circulating_supply?: unknown;
  market_cap_rank?: unknown;
}

/** A finite number, or null. Rejects `NaN`, which `typeof x === "number"` does not. */
function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * One upstream row mapped to a domain asset, or null when it is unusable. A row missing its market
 * cap, price or supply is dropped rather than zero-filled: a zero market cap would sort to the
 * bottom and render as a real figure.
 */
export function parseMarketRow(
  raw: unknown,
  stablecoinIds: ReadonlySet<string>,
): MarketAsset | null {
  const row = raw as RawMarketRow;
  if (typeof row?.id !== "string" || row.id === "") return null;
  if (typeof row.symbol !== "string" || typeof row.name !== "string") return null;

  const marketCapUsd = finiteOrNull(row.market_cap);
  const priceUsd = finiteOrNull(row.current_price);
  const circulatingSupply = finiteOrNull(row.circulating_supply);
  if (marketCapUsd === null || priceUsd === null || circulatingSupply === null) return null;
  if (marketCapUsd <= 0) return null;

  return {
    id: row.id,
    symbol: row.symbol.toUpperCase(),
    name: row.name,
    marketCapUsd,
    priceUsd,
    circulatingSupply,
    rank: finiteOrNull(row.market_cap_rank),
    isStablecoin: stablecoinIds.has(row.id),
  };
}

/** Every usable row of a `/coins/markets` response. Throws when the body is not that shape. */
export function parseCoinMarkets(body: unknown, stablecoinIds: ReadonlySet<string>): MarketAsset[] {
  if (!Array.isArray(body)) throw new Error("unrecognised markets response shape");
  const assets: MarketAsset[] = [];
  for (const raw of body) {
    const asset = parseMarketRow(raw, stablecoinIds);
    if (asset !== null) assets.push(asset);
  }
  return assets;
}

/** The ids in a category response. An unrecognised body throws; an empty one is legitimate. */
export function parseStablecoinIds(body: unknown): Set<string> {
  if (!Array.isArray(body)) throw new Error("unrecognised stablecoins response shape");
  const ids = new Set<string>();
  for (const raw of body) {
    const id = (raw as RawMarketRow)?.id;
    if (typeof id === "string" && id !== "") ids.add(id);
  }
  return ids;
}

/**
 * Split a flat asset list into the snapshot shape, or null when Zcash is missing. Every figure the
 * page states is a ratio against Zcash, so without it there is nothing to compare.
 */
export function toSnapshot(assets: readonly MarketAsset[], asOf: number): MarketSnapshot | null {
  const zec = assets.find((asset) => asset.id === ZCASH_ID);
  if (zec === undefined) return null;
  return { asOf, zec, assets: assets.filter((asset) => asset.id !== ZCASH_ID) };
}

export class MarketCapTracker {
  #snapshot: MarketSnapshot | null = null;
  #stablecoinIds: ReadonlySet<string> = new Set();
  #timers: NodeJS.Timeout[] = [];

  constructor(
    private readonly log: (m: string) => void,
    private readonly pool?: Pool,
    private readonly apiKey?: string,
  ) {}

  /** The latest snapshot, or null when none is recent enough to be honest. */
  current(now = Date.now()): MarketSnapshot | null {
    if (this.#snapshot === null) return null;
    return now - this.#snapshot.asOf * 1000 > MAX_AGE_MS ? null : this.#snapshot;
  }

  async #fetchJson(url: string): Promise<unknown> {
    const res = await fetch(url, {
      headers: {
        accept: "application/json",
        ...(this.apiKey ? { "x-cg-demo-api-key": this.apiKey } : {}),
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return readJsonCapped(res);
  }

  /**
   * Replace the stored snapshot wholesale. Rows absent from the latest poll are deleted: an asset
   * that dropped out of the top 250 would otherwise remain at its last market cap, still selectable
   * and rendering as current.
   */
  async #persist(assets: readonly MarketAsset[], asOf: number): Promise<void> {
    if (this.pool === undefined) return;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const a of assets) {
        await client.query(
          `INSERT INTO coin_market
             (id, symbol, name, market_cap_usd, price_usd, circulating_supply,
              market_cap_rank, is_stablecoin, fetched_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (id) DO UPDATE SET
             symbol = EXCLUDED.symbol,
             name = EXCLUDED.name,
             market_cap_usd = EXCLUDED.market_cap_usd,
             price_usd = EXCLUDED.price_usd,
             circulating_supply = EXCLUDED.circulating_supply,
             market_cap_rank = EXCLUDED.market_cap_rank,
             is_stablecoin = EXCLUDED.is_stablecoin,
             fetched_at = EXCLUDED.fetched_at`,
          [
            a.id,
            a.symbol,
            a.name,
            a.marketCapUsd,
            a.priceUsd,
            a.circulatingSupply,
            a.rank,
            a.isStablecoin,
            asOf,
          ],
        );
      }
      await client.query("DELETE FROM coin_market WHERE fetched_at < $1", [asOf]);
      await client.query("COMMIT");
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Rehydrate from Postgres at boot, so a restart does not leave `/compare` unavailable until the
   * first poll. The age check in `current()` still applies.
   */
  async #load(): Promise<void> {
    if (this.pool === undefined) return;
    const { rows } = await this.pool.query<{
      id: string;
      symbol: string;
      name: string;
      market_cap_usd: string | number;
      price_usd: string | number;
      circulating_supply: string | number;
      market_cap_rank: number | null;
      is_stablecoin: boolean;
      fetched_at: string | number;
    }>("SELECT * FROM coin_market");
    if (rows.length === 0) return;

    const assets: MarketAsset[] = rows.map((row) => ({
      id: row.id,
      symbol: row.symbol,
      name: row.name,
      marketCapUsd: Number(row.market_cap_usd),
      priceUsd: Number(row.price_usd),
      circulatingSupply: Number(row.circulating_supply),
      rank: row.market_cap_rank,
      isStablecoin: row.is_stablecoin,
    }));
    const asOf = Math.max(...rows.map((row) => Number(row.fetched_at)));
    this.#snapshot = toSnapshot(assets, asOf);
    if (this.#snapshot !== null) {
      this.#stablecoinIds = new Set(assets.filter((a) => a.isStablecoin).map((a) => a.id));
      this.log(`[market] restored ${assets.length} assets from postgres, asOf ${asOf}`);
    }
  }

  async #pollStablecoins(): Promise<void> {
    try {
      this.#stablecoinIds = parseStablecoinIds(await this.#fetchJson(STABLECOINS_URL));
    } catch (error) {
      // Keep the existing list: an empty one would admit stablecoins to the picker, so a failure
      // must never be treated as "no stablecoins exist".
      this.log(`[market] stablecoin category fetch failed: ${String(error)}`);
    }
  }

  async #pollMarkets(): Promise<void> {
    try {
      const assets = parseCoinMarkets(await this.#fetchJson(MARKETS_URL), this.#stablecoinIds);
      const asOf = Math.floor(Date.now() / 1000);
      const snapshot = toSnapshot(assets, asOf);
      if (snapshot === null) throw new Error("response carried no zcash row");
      this.#snapshot = snapshot;
      await this.#persist(assets, asOf);
    } catch (error) {
      // Keep the previous snapshot; current() ages it out if the outage persists.
      this.log(`[market] markets fetch failed: ${String(error)}`);
    }
  }

  start(): () => void {
    void (async () => {
      if (this.pool !== undefined) {
        // The table lives in `schema.sql`, applied by the store's migration at boot, so the schema
        // has one home.
        try {
          await this.#load();
        } catch (error) {
          this.log(`[market] postgres unavailable, serving from memory only: ${String(error)}`);
        }
      }
      // Stablecoins first: the flag is written onto every asset row, so polling markets before the
      // category is known would persist every stablecoin marked false until the next poll.
      await this.#pollStablecoins();
      await this.#pollMarkets();
    })();

    const timers = [
      setInterval(() => void this.#pollMarkets(), MARKETS_INTERVAL_MS),
      setInterval(() => void this.#pollStablecoins(), STABLECOINS_INTERVAL_MS),
    ];
    // Never let a market timer keep the process alive after shutdown.
    for (const timer of timers) timer.unref();
    this.#timers = timers;
    return () => {
      for (const timer of this.#timers) clearInterval(timer);
    };
  }
}
