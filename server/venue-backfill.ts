import type { MidgardProtocol, MidgardVenue } from "@/data/crosschain/venues";
import type { IngestDeps } from "./venue-poll";
import {
  INTENTS_BACKFILL_PAGE,
  type IntentsCursor,
  fetchIntentsPage,
  fetchMidgardPage,
  sleep,
} from "./venues";

/**
 * Walks each venue's full history into storage, once.
 *
 * Runs inside the poller process, sharing its Intents rate limiter (see `rate-limit.ts`).
 * Resumable: progress is checkpointed to `ingest_state` after every page, so a restart continues
 * rather than starting over and a completed backfill is skipped. Everything upserts on id, so
 * re-running is a no-op.
 *
 * The work is network-bound JSON parsing. The Intents walk is slow in wall-clock terms only
 * because of its one-request-per-five-seconds budget.
 */

const MIDGARD_PAGE = 50;
const PAGE_ATTEMPTS = 4;

/**
 * Retries a single page before giving up on the whole walk. A backfill is thousands of requests,
 * so transient timeouts are expected; without retries the walk would only advance as far as its
 * unluckiest page. Backoff is generous because the failures worth retrying are slow servers.
 */
async function withRetry<T>(deps: IngestDeps, label: string, task: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= PAGE_ATTEMPTS; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (attempt === PAGE_ATTEMPTS) break;
      const backoff = 3_000 * attempt;
      deps.log(`${label} attempt ${attempt} failed (${message}); retrying in ${backoff}ms`);
      await sleep(backoff);
    }
  }
  throw lastError;
}

interface MidgardBackfillState {
  offset: number;
  done: boolean;
  upserted: number;
}

interface IntentsBackfillState {
  cursor: IntentsCursor | null;
  done: boolean;
  pages: number;
  upserted: number;
}

async function backfillMidgard(
  deps: IngestDeps,
  protocol: MidgardProtocol,
  venue: MidgardVenue,
): Promise<void> {
  const key = `backfill:${protocol}`;
  const saved = await deps.store.readIngestState<MidgardBackfillState>(key);
  if (saved?.done) return;

  let { offset = 0, upserted = 0 } = saved ?? {};
  deps.log(`[${protocol}] backfill resuming at offset ${offset}`);

  for (;;) {
    const { transfers, rawCount } = await withRetry(deps, `[${protocol}] offset ${offset}`, () =>
      fetchMidgardPage(venue, protocol, offset),
    );
    upserted += await deps.store.upsert(transfers);
    offset += rawCount;
    const done = rawCount < MIDGARD_PAGE;
    await deps.store.writeIngestState(key, { offset, done, upserted });

    if (done) {
      deps.log(`[${protocol}] backfill COMPLETE — walked ${offset} actions, stored ${upserted}`);
      return;
    }
    if (offset % 1000 === 0) deps.log(`[${protocol}] backfill at offset ${offset}`);
    // Courtesy spacing; Midgard publishes no documented limit but is someone else's box.
    await sleep(350);
  }
}

async function backfillIntents(deps: IngestDeps, direction: "in" | "out"): Promise<void> {
  if (!deps.intentsJwt) return;
  const jwt = deps.intentsJwt;
  const key = `backfill:near-intents:${direction}`;
  const saved = await deps.store.readIngestState<IntentsBackfillState>(key);
  if (saved?.done) return;

  let cursor = saved?.cursor ?? null;
  let pages = saved?.pages ?? 0;
  let upserted = saved?.upserted ?? 0;
  deps.log(`[near-intents:${direction}] backfill resuming after ${pages} pages`);

  for (;;) {
    const page = await withRetry(deps, `[near-intents:${direction}] page ${pages + 1}`, () =>
      // Through the shared limiter: the live poller spends the same per-key budget.
      deps.intentsLimiter.run(() =>
        fetchIntentsPage(jwt, direction, cursor, INTENTS_BACKFILL_PAGE),
      ),
    );
    upserted += await deps.store.upsert(page.transfers);
    pages += 1;

    // An empty page means the beginning of ZEC history on this venue.
    const done = page.rawCount === 0 || page.next === null;
    cursor = page.next;
    await deps.store.writeIngestState(key, { cursor, done, pages, upserted });

    if (done) {
      deps.log(
        `[near-intents:${direction}] backfill COMPLETE — ${pages} pages, stored ${upserted}`,
      );
      return;
    }
    deps.log(`[near-intents:${direction}] backfill page ${pages} raw=${page.rawCount}`);
  }
}

/**
 * Runs every venue's backfill to completion, then returns.
 *
 * Failures are logged and retried on the next process start rather than aborting the
 * others: a venue being unreachable must not strand the ones that are fine, and the
 * checkpoint means a retry resumes where it stopped.
 */
export async function runBackfill(deps: IngestDeps): Promise<boolean> {
  deps.log("backfill: starting");
  // Only configured venues: a venue without a base URL is skipped rather than reported as failing.
  const jobs: Array<Promise<void>> = Object.entries(deps.midgardVenues).map(([protocol, venue]) =>
    backfillMidgard(deps, protocol as MidgardProtocol, venue),
  );
  // Both Intents directions share one key's budget, so they run in sequence behind the
  // limiter rather than racing each other for slots.
  jobs.push(
    (async () => {
      await backfillIntents(deps, "out");
      await backfillIntents(deps, "in");
    })(),
  );

  let allSucceeded = true;
  for (const result of await Promise.allSettled(jobs)) {
    if (result.status === "rejected") {
      allSucceeded = false;
      const message =
        result.reason instanceof Error ? result.reason.message : String(result.reason);
      deps.log(`backfill: a venue failed this pass, will resume: ${message}`);
    }
  }
  deps.log(`backfill: pass finished — ${await deps.store.count()} transfers stored`);
  return allSucceeded;
}

/**
 * Keeps retrying passes until every venue reports complete.
 *
 * Runs alongside the poller rather than before it: they share the Intents limiter, so
 * they cannot collide, and the head stays fresh while history fills in behind. Waiting
 * for a multi-hour walk before serving anything would be the worse trade.
 */
export async function backfillUntilComplete(deps: IngestDeps): Promise<void> {
  for (let pass = 1; pass <= 20; pass += 1) {
    if (await runBackfill(deps)) {
      deps.log("backfill: all venues complete");
      return;
    }
    deps.log(`backfill: pass ${pass} incomplete, retrying in 60s`);
    await sleep(60_000);
  }
  deps.log("backfill: giving up for this process; it resumes from its checkpoint on restart");
}
