import { describe, expect, it } from "vitest";
import type { Transaction } from "@/domain";
import { PULSE_PENDING_DRAW_CAP, PulseMempoolTracker } from "../pulse-mempool";

/**
 * The mempool layer's cost model and its refusals. Cost is per arrival, not per poll: the ids are
 * read every few seconds in one call, and a transaction is fetched exactly once however long it
 * stays. Refetching every entry on every poll would cost hundreds of node calls a minute.
 *
 * A fake node: what is under test is this class's own bookkeeping (what it fetches, caches and
 * drops), and a real node cannot be made to drop a transaction on cue.
 */

const tx = (txid: string): Transaction =>
  ({
    txid,
    blockHeight: null,
    blockHash: null,
    timestamp: 1_783_875_480,
    isCoinbase: false,
    version: 5,
    sizeBytes: 200,
    lockTime: null,
    expiryHeight: null,
    rawHex: null,
    feeZat: 10_000,
    bindingSigValid: true,
    transparentInputs: [{ address: "t1in", valueZat: 600_000_000 }],
    transparentOutputs: [],
    sprout: null,
    sapling: { spends: 0, outputs: 1, valueBalanceZat: 500_000_000 },
    orchard: null,
    ironwood: null,
  }) as unknown as Transaction;

interface Node {
  ids: string[];
  /** Every txid `getrawtransaction` was asked for, in order — the cost being measured. */
  fetched: string[];
  /** Txids the node claims not to have, so a vanished entry can be exercised. */
  missing: Set<string>;
}

function tracker(node: Node, now = () => 1_783_875_500_000): PulseMempoolTracker {
  return new PulseMempoolTracker({
    ids: async () => [...node.ids],
    transaction: async (txid: string) => {
      node.fetched.push(txid);
      return node.missing.has(txid) ? undefined : tx(txid);
    },
    now,
  });
}

const id = (n: number): string => n.toString(16).padStart(64, "0");

describe("PulseMempoolTracker", () => {
  it("says nothing at all before its first poll, rather than an empty mempool", () => {
    // A cold tracker contributes null. `{count: 0}` would be a measurement — that our node's
    // mempool held nothing — and we have not asked it yet.
    expect(tracker({ ids: [], fetched: [], missing: new Set() }).snapshot()).toBeNull();
  });

  it("fetches each transaction ONCE however many polls it survives", async () => {
    const node: Node = { ids: [id(1), id(2)], fetched: [], missing: new Set() };
    const t = tracker(node);
    await t.poll();
    await t.poll();
    node.ids = [id(1), id(2), id(3)];
    await t.poll();
    expect(node.fetched).toEqual([id(1), id(2), id(3)]);
    expect(t.snapshot()?.count).toBe(3);
  });

  it("drops an id the mempool no longer holds", async () => {
    const node: Node = { ids: [id(1), id(2)], fetched: [], missing: new Set() };
    const t = tracker(node);
    await t.poll();
    node.ids = [id(2)];
    await t.poll();
    const snapshot = t.snapshot()!;
    expect(snapshot.count).toBe(1);
    expect(snapshot.events.map((e) => e.id)).toEqual([id(2)]);
  });

  it("re-draws an id that comes back without re-fetching it", async () => {
    // It is the same transaction: a reorg or a re-broadcast does not change what it does.
    const node: Node = { ids: [id(1)], fetched: [], missing: new Set() };
    const t = tracker(node);
    await t.poll();
    node.ids = [];
    await t.poll();
    node.ids = [id(1)];
    await t.poll();
    expect(node.fetched).toEqual([id(1)]);
    expect(t.snapshot()?.events).toHaveLength(1);
  });

  it("asks the node once for an entry it will not answer for, then stops asking", async () => {
    // Mined or evicted between the two calls. Retrying it every five seconds for as long as
    // the id lingers is the per-poll cost this design exists to avoid.
    const node: Node = { ids: [id(9)], fetched: [], missing: new Set([id(9)]) };
    const t = tracker(node);
    await t.poll();
    await t.poll();
    expect(node.fetched).toEqual([id(9)]);
    const snapshot = t.snapshot()!;
    // Counted, because our node says it is there — and not drawn, because we have no movement
    // to draw. That gap is exactly what `count` beside `events.length` is for.
    expect(snapshot.count).toBe(1);
    expect(snapshot.events).toEqual([]);
    expect(snapshot.truncated).toBe(true);
  });

  it("marks every drawn movement pending, and never gives it a height", async () => {
    const node: Node = { ids: [id(1)], fetched: [], missing: new Set() };
    const t = tracker(node);
    await t.poll();
    const event = t.snapshot()!.events[0]!;
    expect(event.pending).toBe(true);
    expect(event.height).toBeNull();
    expect(event.blockHash).toBeNull();
  });

  it("draws a capped slice and says so, never a silent one", async () => {
    const many = Array.from({ length: PULSE_PENDING_DRAW_CAP + 5 }, (_, i) => id(i + 1));
    const node: Node = { ids: many, fetched: [], missing: new Set() };
    const t = tracker(node);
    // Twice, because the two bounds are different quantities and both are real: the per-pass
    // FETCH budget is what one pass may ask the node for, and the DRAW cap is what a snapshot
    // may mark. A burst larger than the budget fills over successive passes.
    await t.poll();
    await t.poll();
    const snapshot = t.snapshot()!;
    expect(snapshot.count).toBe(many.length);
    expect(snapshot.events).toHaveLength(PULSE_PENDING_DRAW_CAP);
    expect(snapshot.truncated).toBe(true);
  });

  it("is not marked truncated when every entry is drawn", async () => {
    const node: Node = { ids: [id(1), id(2)], fetched: [], missing: new Set() };
    const t = tracker(node);
    await t.poll();
    expect(t.snapshot()!.truncated).toBeUndefined();
  });

  it("stamps the snapshot with when the MEMPOOL was read, not when it was asked for", async () => {
    let clock = 1_000_000_000_000;
    const node: Node = { ids: [id(1)], fetched: [], missing: new Set() };
    const t = tracker(node, () => clock);
    await t.poll();
    clock += 60_000;
    // Stamping "now" on a minute-old read is how a stale figure passes for live.
    expect(t.snapshot()!.asOf).toBe(1_000_000_000);
  });

  it("forgets the oldest entries past its cache bound, and refetches one that returns", async () => {
    const t = new PulseMempoolTracker(
      {
        ids: async () => [...node.ids],
        transaction: async (txid) => {
          node.fetched.push(txid);
          return tx(txid);
        },
        now: () => 0,
      },
      { cacheSize: 3 },
    );
    const node: Node = { ids: [id(1), id(2), id(3)], fetched: [], missing: new Set() };
    await t.poll();
    node.ids = [id(4), id(5), id(6)];
    await t.poll();
    // 1 was evicted to make room; the bound must be a real bound, or a busy mempool is an
    // unbounded map of transactions nobody is drawing any more.
    node.ids = [id(1)];
    await t.poll();
    expect(node.fetched.filter((f) => f === id(1))).toHaveLength(2);
  });

  it("fetches at most a budget per pass, and picks the rest up on the next one", async () => {
    // The fetches are sequential, so an unbounded pass over a mempool that has just filled runs
    // for minutes and outlives its own interval. The remainder is counted and not drawn.
    const many = Array.from({ length: 7 }, (_, i) => id(i + 1));
    const node: Node = { ids: many, fetched: [], missing: new Set() };
    const t = new PulseMempoolTracker(
      {
        ids: async () => [...node.ids],
        transaction: async (txid) => {
          node.fetched.push(txid);
          return tx(txid);
        },
        now: () => 1_783_875_500_000,
      },
      { fetchBudget: 3 },
    );

    await t.poll();
    expect(node.fetched).toHaveLength(3);
    let snapshot = t.snapshot()!;
    expect(snapshot.count).toBe(7);
    expect(snapshot.events).toHaveLength(3);
    expect(snapshot.truncated).toBe(true);

    await t.poll();
    await t.poll();
    expect(node.fetched).toHaveLength(7);
    snapshot = t.snapshot()!;
    expect(snapshot.events).toHaveLength(7);
    expect(snapshot.truncated).toBeUndefined();
  });

  it("runs one pass at a time, so a slow pass cannot overwrite a fresher snapshot", async () => {
    // The timer fires on a fixed interval and a pass can outlive it. Two overlapping passes
    // finish in an order nobody controls, and the loser writes a staler `asOf` last.
    const node: Node = { ids: [id(1)], fetched: [], missing: new Set() };
    let release: (() => void) | null = null;
    const t = new PulseMempoolTracker({
      ids: async () => {
        if (release === null) await new Promise<void>((resolve) => (release = resolve));
        return [...node.ids];
      },
      transaction: async (txid) => {
        node.fetched.push(txid);
        return tx(txid);
      },
      now: () => 1_783_875_500_000,
    });

    const first = t.poll();
    // The second tick arrives while the first pass is still waiting on the node.
    await t.poll();
    expect(node.fetched).toEqual([]); // it did not start a second read
    (release as unknown as () => void)();
    await first;
    expect(node.fetched).toEqual([id(1)]);
  });

  it("survives a failed poll without losing what it already knows", async () => {
    const node: Node = { ids: [id(1)], fetched: [], missing: new Set() };
    let fail = false;
    const t = new PulseMempoolTracker({
      ids: async () => {
        if (fail) throw new Error("node unreachable");
        return [...node.ids];
      },
      transaction: async (txid) => tx(txid),
      now: () => 1_783_875_500_000,
    });
    await t.poll();
    fail = true;
    await t.poll();
    // The last good snapshot stands, and it says when it was taken — the page decides what to
    // do with an age, where a thrown poll here would take the whole endpoint down.
    expect(t.snapshot()?.count).toBe(1);
  });
});
