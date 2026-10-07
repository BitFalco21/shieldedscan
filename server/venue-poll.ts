import type { CrossChainProtocol } from "@/domain";
import type { MidgardProtocol, MidgardVenue } from "@/data/crosschain/venues";
import type { RateLimiter } from "./rate-limit";
import type { CrossChainStorePort } from "./crosschain-store";
import { fetchIntentsPage, fetchMidgardPage } from "./venues";

/**
 * The ingest loop. Two properties matter:
 *
 *  - No venue can take down another. Every cycle runs under `Promise.allSettled`; an empty or
 *    unreachable venue is reported, never fatal.
 *  - Only one Intents request is in flight at a time, across the poller and the backfill,
 *    because the rate limit is per JWT. Both go through `intentsLimiter`.
 */

export const ALL_PROTOCOLS: readonly CrossChainProtocol[] = ["maya", "thorchain", "near-intents"];

export const POLL_INTERVAL_MS = 60_000;

export interface IngestDeps {
  store: CrossChainStorePort;
  /**
   * Only the venues that have a base URL. A venue absent from this map is not polled and not
   * reported as failing: "not configured" is different from "down".
   */
  midgardVenues: Partial<Record<MidgardProtocol, MidgardVenue>>;
  /** An absent JWT leaves Intents dormant rather than failing; a missing key is not an outage. */
  intentsJwt?: string | undefined;
  /** Shared with the backfill; the Intents budget is per key, not per caller. */
  intentsLimiter: RateLimiter;
  now: () => number;
  log: (message: string) => void;
}

function nowSeconds(deps: IngestDeps): number {
  return Math.floor(deps.now() / 1000);
}

async function pollMidgard(
  deps: IngestDeps,
  protocol: MidgardProtocol,
  venue: MidgardVenue,
): Promise<void> {
  try {
    const { transfers, rawCount } = await fetchMidgardPage(venue, protocol);
    const added = await deps.store.upsert(transfers);
    await deps.store.markSuccess(protocol, nowSeconds(deps));
    deps.log(`[${protocol}] ok raw=${rawCount} parsed=${transfers.length} new=${added}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await deps.store.markFailure(protocol, message);
    deps.log(`[${protocol}] FAILED ${message}`);
  }
}

async function pollIntents(deps: IngestDeps, direction: "in" | "out"): Promise<void> {
  const jwt = deps.intentsJwt;
  if (!jwt) return;
  try {
    const { transfers, rawCount } = await deps.intentsLimiter.run(() =>
      fetchIntentsPage(jwt, direction),
    );
    const added = await deps.store.upsert(transfers);
    await deps.store.markSuccess("near-intents", nowSeconds(deps));
    deps.log(
      `[near-intents:${direction}] ok raw=${rawCount} parsed=${transfers.length} new=${added}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await deps.store.markFailure("near-intents", message);
    deps.log(`[near-intents:${direction}] FAILED ${message}`);
  }
}

/** One cycle. `tick` decides which Intents direction gets this cycle's request. */
export async function pollOnce(deps: IngestDeps, tick: number): Promise<void> {
  const midgard = Object.entries(deps.midgardVenues).map(([protocol, venue]) =>
    pollMidgard(deps, protocol as MidgardProtocol, venue),
  );
  await Promise.allSettled([...midgard, pollIntents(deps, tick % 2 === 0 ? "in" : "out")]);
}

/** Runs `pollOnce` forever. Returns a stop handle for tests and graceful shutdown. */
export function startPolling(deps: IngestDeps): () => void {
  let tick = 0;
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;

  const loop = async (): Promise<void> => {
    while (!stopped) {
      await pollOnce(deps, tick);
      tick += 1;
      if (stopped) break;
      await new Promise<void>((resolve) => {
        timer = setTimeout(resolve, POLL_INTERVAL_MS);
      });
    }
  };
  void loop();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
