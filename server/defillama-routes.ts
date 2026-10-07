import { Hono } from "hono";
import {
  defillamaYieldsBase,
  selectWrappedZecPools,
  type WrappedZecPoolSnapshot,
} from "@/data/defillama/zec-pools";
import { Cached } from "./cached";
import { readJsonCapped } from "./body-limit";

/**
 * The one route in this service that reads a third party at request time.
 *
 * It serves DeFiLlama's view of the liquidity pools holding wrapped or bridged ZEC on other
 * chains: figures this explorer cannot check against the Zcash node. The frontend never talks to
 * a third-party venue, so the fetch lives on the API host, behind the token, in one long-lived
 * process that respects the upstream's budget.
 *
 * Mounted under the protected `/chain/*` prefix rather than a new one (a new prefix is one more
 * thing to remember to guard), and the path names `defillama`, so provenance is in the endpoint.
 *
 *  - A failed or unparseable read is a 503, never `[]`: an empty array would state that no pool
 *    holds wrapped ZEC.
 *  - Zero matches is also a 503: it is ambiguous between a delisting and a filter that stopped
 *    working, and an ambiguous zero is not publishable.
 *  - Failures are never cached: `Cached` stores only a resolved value.
 */

export const WRAPPED_ZEC_POOLS_PATH = "/chain/defillama/zec-pools";

/**
 * Thirty minutes. TVL and APY move on the order of hours, the response is about 10 MB, and this is
 * someone else's free tier. The `asOf` timestamp travels with the payload, so a reader knows what
 * instant they are looking at.
 */
const POOLS_CACHE_MS = 30 * 60_000;

/** Generous: the index is about 10 MB and this read sits behind a long cache. */
const FETCH_TIMEOUT_MS = 20_000;

export interface WrappedZecPoolsDeps {
  /** Injectable so the tests never reach the network. */
  fetch?: typeof globalThis.fetch;
  /** Configuration, not a constant — see `defillamaYieldsBase`. */
  baseUrl?: string;
  now?: () => number;
}

export function defillamaRoutes(deps: WrappedZecPoolsDeps = {}): Hono {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const baseUrl = deps.baseUrl ?? defillamaYieldsBase();
  const now = deps.now ?? (() => Date.now());
  const snapshot = new Cached<WrappedZecPoolSnapshot>(POOLS_CACHE_MS);
  const app = new Hono();

  app.get(WRAPPED_ZEC_POOLS_PATH, async (c) => {
    try {
      return c.json(await snapshot.get(() => readPools(fetchImpl, baseUrl, now())));
    } catch (error) {
      // 503, not 404: the resource exists and we could not read it. Naming the upstream lets a
      // caller tell a venue outage from a broken filter.
      return c.json(
        {
          error: {
            code: "unavailable",
            message: `DeFiLlama pool index unreadable: ${errorText(error)}`,
          },
          asOf: Math.floor(now() / 1000),
        },
        503,
      );
    }
  });

  return app;
}

/** One read of the upstream index, filtered down to ZEC before anything else sees it. */
async function readPools(
  fetchImpl: typeof globalThis.fetch,
  baseUrl: string,
  nowMs: number,
): Promise<WrappedZecPoolSnapshot> {
  const url = `${baseUrl}/pools`;
  const response = await fetchImpl(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`${url} answered HTTP ${response.status}`);
  // DeFiLlama's full pool list is about 11 MB, so its ceiling is higher than the default.
  const payload: unknown = await readJsonCapped(response, 32 * 1024 * 1024);
  const result = selectWrappedZecPools(payload, {
    asOf: Math.floor(nowMs / 1000),
    sourceApi: hostOf(baseUrl),
  });
  if (result === null) throw new Error(`${url} did not answer with a pool array`);
  if (result.pools.length === 0) {
    throw new Error(
      `no pool symbol carries a ZEC token among the ${result.poolsScanned} pools published — ambiguous between a delisting and a broken filter, so no figure is served`,
    );
  }
  return result;
}

function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

/** An upstream message, never a stack: this string reaches a token-holding caller. */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
