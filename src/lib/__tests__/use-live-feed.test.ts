import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { blockSummaryOf } from "@/domain";
import { blocks as fixtureBlocks } from "@/fixtures/blocks";
import { crossChainTransfers } from "@/fixtures/crosschain";
import { useLiveFeed } from "../use-live-feed";

/**
 * The polling hook.
 *
 * The merge rules are pinned in `live-feed.test.ts` and the wire guard in
 * `live-payload.test.ts`; this covers the runtime plumbing and two honesty-critical
 * behaviours:
 *
 *  - it must never look live while frozen: a page that stopped receiving updates must not
 *    keep showing a "live" indicator;
 *  - it must discard its rows on a reorg, because the rows above a reorged tip can include
 *    the orphaned block itself.
 */

const TIP = { height: 100, hash: "aaa", lastBlockTimestamp: 1_700_000_000 };
/** List rows, the shape `/api/live` sends. */
const blocks = fixtureBlocks.map(blockSummaryOf);

function payload(over: Record<string, unknown> = {}) {
  return {
    kind: "all",
    direction: "all",
    tip: TIP,
    blocks: [],
    transactions: [],
    transfers: [],
    ...over,
  };
}

function respondWith(...bodies: unknown[]) {
  const fetchMock = vi.fn();
  for (const body of bodies) {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => body } as Response);
  }
  // Keep answering with the last body rather than running out mid-test.
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => bodies[bodies.length - 1],
  } as Response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const options = { kind: "all" as const, mode: "grow" as const, cap: 50, server: {} };

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => payload() }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useLiveFeed", () => {
  it("merges rows from the first poll", async () => {
    respondWith(payload({ blocks: [blocks[0]] }));

    const { result } = renderHook(() => useLiveFeed(options));

    await waitFor(() => expect(result.current.blocks.rows).toHaveLength(1));
  });

  it("does not re-add a row the server pass already rendered", async () => {
    respondWith(payload({ blocks: [blocks[0]] }));

    const { result } = renderHook(() =>
      useLiveFeed({ ...options, server: { blocks: [blocks[0]!] } }),
    );

    await waitFor(() => expect(result.current.status).toBe("live"));
    expect(result.current.blocks.rows).toHaveLength(0);
  });

  it("reports itself unavailable after repeated failures instead of looking live", async () => {
    const failing = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", failing);

    const { result } = renderHook(() => useLiveFeed({ ...options, intervalMs: 5 }));

    await waitFor(() => expect(result.current.status).toBe("unavailable"), { timeout: 2000 });
  });

  it("does not go unavailable on a single blip", async () => {
    // One failed poll on a 15-second cadence is not worth telling a reader about; the site's
    // own adapter already retries a stalled upstream three times for the same reason.
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("blip"))
      .mockResolvedValue({ ok: true, json: async () => payload() } as Response);
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useLiveFeed({ ...options, intervalMs: 5 }));

    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(2));
    expect(result.current.status).not.toBe("unavailable");
  });

  it("discards accumulated rows when a seen height reports a different hash", async () => {
    respondWith(
      payload({ blocks: [blocks[0]] }),
      // Same height, different hash: the chain replaced what we were showing.
      payload({ tip: { ...TIP, hash: "zzz" }, blocks: [blocks[1]] }),
    );

    const { result } = renderHook(() => useLiveFeed({ ...options, intervalMs: 5 }));

    await waitFor(() => expect(result.current.status).toBe("reorganised"), { timeout: 2000 });
    expect(result.current.blocks.rows).toHaveLength(0);
  });

  it("asks the endpoint for the DIRECTION it was given", async () => {
    // Direction is applied upstream, so it must reach the query string; the client re-checks it
    // through the same predicate but must not be the only thing narrowing.
    const fetchMock = respondWith(payload({ direction: "out" }));

    renderHook(() => useLiveFeed({ ...options, transferFilters: { direction: "out" } }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(String(fetchMock.mock.calls[0]![0])).toContain("direction=out");
  });

  it("asks for the kind it was given", async () => {
    const fetchMock = respondWith(payload({ kind: "shielded" }));

    renderHook(() => useLiveFeed({ ...options, kind: "shielded" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(String(fetchMock.mock.calls[0]![0])).toContain("kind=shielded");
  });

  it("ignores a payload that answers a different kind", async () => {
    // The echo refusal, end to end: the parser returns null and the hook must treat that as
    // "nothing arrived", never as rows.
    respondWith(payload({ kind: "all", blocks: [blocks[0]] }));

    const { result } = renderHook(() => useLiveFeed({ ...options, kind: "shielded" }));

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(result.current.blocks.rows).toHaveLength(0);
  });

  it("marks nothing on the FIRST poll, which is only a baseline", async () => {
    // The page it reconciles against is prerendered and CDN-cached, so "differs from the
    // cached HTML" is not the same as "arrived while you were watching". Every row flagged
    // new on load is the mark meaning nothing.
    respondWith(payload({ blocks: [blocks[0]] }));

    const { result } = renderHook(() => useLiveFeed({ ...options, intervalMs: 5 }));

    await waitFor(() => expect(result.current.blocks.rows).toHaveLength(1));
    expect(result.current.blocks.freshIds).toEqual([]);
  });

  it("marks rows that arrive on a LATER poll", async () => {
    // `blocks` is built from ascending heights, so blocks[1] is the newer one and must arrive
    // second, otherwise the recency floor correctly refuses it.
    respondWith(payload({ blocks: [blocks[0]] }), payload({ blocks: [blocks[1], blocks[0]] }));

    // Every render is recorded rather than one sampled: `freshIds` is cleared by the next poll
    // by design, so reading `result.current` would race the interval.
    const observed: string[][] = [];
    renderHook(() => {
      const feed = useLiveFeed({ ...options, intervalMs: 5 });
      observed.push(feed.blocks.freshIds);
      return feed;
    });

    await waitFor(() => expect(observed.some((f) => f.includes(blocks[1]!.hash))).toBe(true), {
      timeout: 2000,
    });
    // ...and the first poll's rows never appeared in any of them.
    expect(observed.every((f) => !f.includes(blocks[0]!.hash))).toBe(true);
  });

  it("narrows arriving transfers to the cross-chain filter in force", async () => {
    // A filter narrows the live feed rather than switching it off. Open-ended filters are not
    // part of the endpoint's cache key (that would lose its flat cost), so the narrowing is
    // applied here, through the same predicate the store and the fixtures use.
    const inbound = crossChainTransfers.find((t) => t.direction === "in")!;
    const outbound = crossChainTransfers.find((t) => t.direction === "out")!;
    respondWith(payload({ direction: "in", transfers: [outbound, inbound] }));

    const { result } = renderHook(() =>
      useLiveFeed({ ...options, transferFilters: { direction: "in" } }),
    );

    await waitFor(() => expect(result.current.transfers.rows).toHaveLength(1));
    expect(result.current.transfers.rows[0]!.id).toBe(inbound.id);
  });

  it("keeps every transfer when no narrowing is given", async () => {
    const inbound = crossChainTransfers.find((t) => t.direction === "in")!;
    const outbound = crossChainTransfers.find((t) => t.direction === "out")!;
    respondWith(payload({ transfers: [outbound, inbound] }));

    const { result } = renderHook(() => useLiveFeed(options));

    await waitFor(() => expect(result.current.transfers.rows).toHaveLength(2));
  });

  it("polls again QUICKLY while the payload's tip is ahead of its blocks list", async () => {
    // The tip is read fresh while the blocks list is coalesced upstream, so tip.height above
    // the newest block row means the row exists and has not shipped yet. The hook re-polls
    // quickly instead of waiting the full interval.
    const stale = payload({
      tip: {
        height: blocks[5]!.height + 1,
        hash: "ahead",
        lastBlockTimestamp: TIP.lastBlockTimestamp,
      },
      blocks: [blocks[5]],
    });
    const fetchMock = respondWith(stale);

    renderHook(() => useLiveFeed({ ...options, intervalMs: 60_000, chaseMs: 5 }));

    // The regular interval is a minute; more than two fetches inside 200ms proves the chase.
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(2), {
      timeout: 2000,
    });
  });

  it("does not chase when the payload is internally consistent", async () => {
    const consistent = payload({
      tip: {
        height: blocks[5]!.height,
        hash: blocks[5]!.hash,
        lastBlockTimestamp: TIP.lastBlockTimestamp,
      },
      blocks: [blocks[5]],
    });
    const fetchMock = respondWith(consistent);

    renderHook(() => useLiveFeed({ ...options, intervalMs: 60_000, chaseMs: 5 }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(fetchMock.mock.calls.length).toBe(1);
  });

  it("gives up chasing after a bounded number of attempts", async () => {
    // If the API is wedged stale, chasing forever would turn every open tab into a fast
    // poller. The chase covers the upstream coalescing window, then yields to the normal
    // cadence.
    const stale = payload({
      tip: {
        height: blocks[5]!.height + 1,
        hash: "ahead",
        lastBlockTimestamp: TIP.lastBlockTimestamp,
      },
      blocks: [blocks[5]],
    });
    const fetchMock = respondWith(stale);

    renderHook(() => useLiveFeed({ ...options, intervalMs: 60_000, chaseMs: 5 }));

    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(2), { timeout: 2000 });
    await new Promise((resolve) => setTimeout(resolve, 300));
    // 1 regular + at most MAX_CHASES fast follow-ups, then quiet until the minute interval.
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(9);
  });

  it("does not poll at all when disabled", async () => {
    // A cursored page that is NOT at the tip must not accumulate "new" rows: they do not
    // belong on page 7, and prepending them would claim they do.
    const fetchMock = respondWith(payload());

    renderHook(() => useLiveFeed({ ...options, enabled: false, intervalMs: 5 }));

    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stops polling once unmounted", async () => {
    const fetchMock = respondWith(payload());

    const { unmount } = renderHook(() => useLiveFeed({ ...options, intervalMs: 5 }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    unmount();
    const callsAtUnmount = fetchMock.mock.calls.length;

    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(fetchMock.mock.calls.length).toBe(callsAtUnmount);
  });
});

describe("useLiveFeed — an unavailable feed backs off", () => {
  it("polls at the SLOW cadence once unavailable, so a dead API is not hammered by every tab", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503 } as Response);
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() =>
      useLiveFeed({ ...options, intervalMs: 5, unavailableIntervalMs: 60_000 }),
    );
    await waitFor(() => expect(result.current.status).toBe("unavailable"), { timeout: 2000 });
    const atUnavailable = fetchMock.mock.calls.length;
    await new Promise((r) => setTimeout(r, 120));
    // At the 5 ms cadence this window would have added ~20 polls; at 60 s it adds none.
    expect(fetchMock.mock.calls.length).toBe(atUnavailable);
  });

  it("returns to the normal cadence once the API answers again", async () => {
    let alive = false;
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        alive
          ? Promise.resolve({ ok: true, json: async () => payload() } as Response)
          : Promise.resolve({ ok: false, status: 503 } as Response),
      );
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() =>
      useLiveFeed({ ...options, intervalMs: 5, unavailableIntervalMs: 40 }),
    );
    await waitFor(() => expect(result.current.status).toBe("unavailable"), { timeout: 2000 });
    alive = true;
    await waitFor(() => expect(result.current.status).toBe("live"), { timeout: 2000 });
    const atLive = fetchMock.mock.calls.length;
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(atLive + 3), {
      timeout: 2000,
    });
  });
});
