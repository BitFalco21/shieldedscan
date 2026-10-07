import { describe, expect, it } from "vitest";
import type { CrossChainTransfer } from "@/domain";
import { CrossChainStore } from "../store";

function transfer(overrides: Partial<CrossChainTransfer> & { id: string }): CrossChainTransfer {
  return {
    direction: "in",
    protocol: "maya",
    counterpartChain: "BTC",
    counterpartAsset: "BTC",
    counterpartAmount: 0.01,
    counterpartTxHash: null,
    counterpartIsSynthetic: false,
    counterpartAddress: null,
    zcashTxid: null,
    zcashAddress: "t1Mv595nLBUxJxKAfAZAG9RjhibExEErmMf",
    zecAmountZat: 100_000_000,
    usdValueAtSwap: 497.74,
    counterpartUsdAtSwap: null,
    venueDepositAddress: null,
    status: "completed",
    timestamp: 1785084660,
    ...overrides,
  };
}

/** Ten transfers, newest first at index 0. */
function seeded(count = 10, store = new CrossChainStore()) {
  store.upsert(
    Array.from({ length: count }, (_, i) =>
      transfer({ id: `maya-${String(i).padStart(3, "0")}`, timestamp: 1785084660 - i * 60 }),
    ),
  );
  return store;
}

describe("CrossChainStore", () => {
  describe("upsert", () => {
    it("deduplicates by id and keeps the newest copy", () => {
      const store = new CrossChainStore();
      expect(store.upsert([transfer({ id: "maya-a", status: "pending" })])).toBe(1);
      // A venue republishes the same swap as it settles.
      expect(store.upsert([transfer({ id: "maya-a", status: "completed" })])).toBe(0);
      expect(store.size).toBe(1);
      expect(store.get("maya-a")?.status).toBe("completed");
    });

    it("evicts the oldest rows past capacity", () => {
      const store = seeded(10, new CrossChainStore(4));
      expect(store.size).toBe(4);
      const { items } = store.list({ limit: 10 });
      expect(items.map((t) => t.id)).toEqual(["maya-000", "maya-001", "maya-002", "maya-003"]);
    });
  });

  describe("keyset pagination over the composite (timestamp, id) tuple", () => {
    it("walks forward and back without skipping or repeating", () => {
      const store = seeded(10);
      const page1 = store.list({ limit: 4 });
      expect(page1.items.map((t) => t.id)).toEqual([
        "maya-000",
        "maya-001",
        "maya-002",
        "maya-003",
      ]);
      expect(page1.prevCursor).toBeNull();

      const page2 = store.list({ before: page1.nextCursor ?? undefined, limit: 4 });
      expect(page2.items.map((t) => t.id)).toEqual([
        "maya-004",
        "maya-005",
        "maya-006",
        "maya-007",
      ]);

      const back = store.list({ after: page2.prevCursor ?? undefined, limit: 4 });
      expect(back.items.map((t) => t.id)).toEqual(page1.items.map((t) => t.id));
    });

    it("pages correctly when timestamps tie — the case an id-only cursor breaks on", () => {
      // Every row shares one timestamp, so the id tiebreak alone orders them; a single-column
      // seek would return an arbitrary slice. The tiebreak is id descending, matching the
      // row-value comparison `(timestamp, id) < ($ts, $id)` the Postgres adapter uses.
      const store = new CrossChainStore();
      store.upsert(
        ["a", "b", "c", "d", "e"].map((s) => transfer({ id: `maya-${s}`, timestamp: 1785084660 })),
      );
      const page1 = store.list({ limit: 2 });
      const page2 = store.list({ before: page1.nextCursor ?? undefined, limit: 2 });
      const page3 = store.list({ before: page2.nextCursor ?? undefined, limit: 2 });
      expect(page1.items.map((t) => t.id)).toEqual(["maya-e", "maya-d"]);
      expect(page2.items.map((t) => t.id)).toEqual(["maya-c", "maya-b"]);
      expect(page3.items.map((t) => t.id)).toEqual(["maya-a"]);
      expect(page3.nextCursor).toBeNull();
    });

    it("resolves a garbage cursor to the first page rather than throwing or emptying", () => {
      const store = seeded(10);
      const first = store.list({ limit: 3 }).items.map((t) => t.id);
      for (const bad of ["", "!!!!", "x".repeat(2000), "bm90LWEtY3Vyc29y"]) {
        expect(store.list({ before: bad, limit: 3 }).items.map((t) => t.id)).toEqual(first);
      }
    });

    it("reports no next cursor on the last page", () => {
      expect(seeded(3).list({ limit: 10 }).nextCursor).toBeNull();
    });
  });

  describe("protocol settlement legs", () => {
    it("are hidden from lists but still resolvable by id", () => {
      const store = new CrossChainStore();
      store.upsert([
        transfer({ id: "maya-real", counterpartChain: "BTC" }),
        transfer({
          id: "maya-cacao",
          counterpartChain: "MAYA",
          counterpartAsset: "CACAO",
          timestamp: 1785084600,
        }),
        transfer({
          id: "maya-rune",
          counterpartChain: "THOR",
          counterpartAsset: "RUNE",
          timestamp: 1785084500,
        }),
      ]);
      expect(store.list({ limit: 10 }).items.map((t) => t.id)).toEqual(["maya-real"]);
      // A direct link must still resolve — excluding a row from volume figures is not
      // the same as saying it does not exist.
      expect(store.get("maya-cacao")?.counterpartChain).toBe("MAYA");
    });

    it("can be included explicitly", () => {
      const store = new CrossChainStore();
      store.upsert([
        transfer({ id: "maya-cacao", counterpartChain: "MAYA", counterpartAsset: "CACAO" }),
      ]);
      expect(store.list({ limit: 10 }, { includeProtocolLegs: true }).items).toHaveLength(1);
    });
  });

  describe("chain filters", () => {
    /** Six transfers: three inbound from BTC/ETH/BTC, three outbound to SOL/BTC/SOL. */
    function mixed() {
      const store = new CrossChainStore();
      const rows: [string, "in" | "out", string][] = [
        ["a", "in", "BTC"],
        ["b", "in", "ETH"],
        ["c", "in", "BTC"],
        ["d", "out", "SOL"],
        ["e", "out", "BTC"],
        ["f", "out", "SOL"],
      ];
      store.upsert(
        rows.map(([id, direction, chain], i) =>
          transfer({
            id: `maya-${id}`,
            direction,
            counterpartChain: chain,
            counterpartAsset: chain,
            timestamp: 1785084660 - i * 60,
          }),
        ),
      );
      return store;
    }

    const ids = (store: CrossChainStore, options: Parameters<CrossChainStore["list"]>[1]) =>
      store.list({ limit: 10 }, options).items.map((t) => t.id);

    it("matches the chain at the source end, with ZEC standing for every outbound row", () => {
      expect(ids(mixed(), { sourceChains: ["BTC"] })).toEqual(["maya-a", "maya-c"]);
      expect(ids(mixed(), { sourceChains: ["ZEC"] })).toEqual(["maya-d", "maya-e", "maya-f"]);
    });

    it("matches the chain at the destination end", () => {
      expect(ids(mixed(), { destinationChains: ["SOL"] })).toEqual(["maya-d", "maya-f"]);
      expect(ids(mixed(), { destinationChains: ["ZEC"] })).toEqual(["maya-a", "maya-b", "maya-c"]);
    });

    it("ORs within a side and ANDs across sides", () => {
      expect(ids(mixed(), { sourceChains: ["BTC", "ETH"] })).toEqual([
        "maya-a",
        "maya-b",
        "maya-c",
      ]);
      expect(ids(mixed(), { sourceChains: ["BTC"], destinationChains: ["ZEC"] })).toEqual([
        "maya-a",
        "maya-c",
      ]);
      // Zcash is at one end of every transfer, so two foreign chains match nothing.
      expect(ids(mixed(), { sourceChains: ["BTC"], destinationChains: ["SOL"] })).toEqual([]);
    });

    it("filters BEFORE the slice, so a page is full and its cursor skips nothing", () => {
      // Filtering after the cursor slice would return fewer than `limit` rows and a cursor that
      // steps over the ones it removed.
      const store = mixed();
      const first = store.list({ limit: 2 }, { destinationChains: ["ZEC"] });
      expect(first.items.map((t) => t.id)).toEqual(["maya-a", "maya-b"]);
      expect(first.nextCursor).not.toBeNull();

      const second = store.list(
        { limit: 2, before: first.nextCursor ?? undefined },
        { destinationChains: ["ZEC"] },
      );
      expect(second.items.map((t) => t.id)).toEqual(["maya-c"]);
      expect(second.nextCursor).toBeNull();
    });

    it("filters by minimum swap-time value, before the slice", () => {
      const store = new CrossChainStore();
      store.upsert([
        transfer({ id: "maya-big", usdValueAtSwap: 500_000, timestamp: 1785084660 }),
        transfer({ id: "maya-mid", usdValueAtSwap: 100_000, timestamp: 1785084600 }),
        transfer({ id: "maya-small", usdValueAtSwap: 99, timestamp: 1785084540 }),
        transfer({ id: "maya-unknown", usdValueAtSwap: null, timestamp: 1785084480 }),
      ]);
      expect(ids(store, { minUsdAtSwap: 100_000 })).toEqual(["maya-big", "maya-mid"]);
      // A row of unknown value must not appear in a list claiming everything exceeds a number —
      // and must be untouched when no threshold is asked for.
      expect(ids(store, {})).toHaveLength(4);
      expect(ids(store, { minUsdAtSwap: 1 })).not.toContain("maya-unknown");

      const page = store.list({ limit: 1 }, { minUsdAtSwap: 100_000 });
      expect(page.items.map((t) => t.id)).toEqual(["maya-big"]);
      expect(
        store
          .list({ limit: 1, before: page.nextCursor ?? undefined }, { minUsdAtSwap: 100_000 })
          .items.map((t) => t.id),
      ).toEqual(["maya-mid"]);
    });

    it("still hides settlement legs", () => {
      // A chain filter must narrow what the list already shows, never widen it back to rows
      // the list excludes — the venue paying itself in CACAO is not ZEC crossing a boundary.
      const store = mixed();
      store.upsert([
        transfer({
          id: "maya-cacao",
          direction: "in",
          counterpartChain: "MAYA",
          counterpartAsset: "CACAO",
          timestamp: 1785084661,
        }),
      ]);
      expect(ids(store, { sourceChains: ["MAYA"] })).toEqual([]);
      expect(ids(store, { sourceChains: ["BTC"] })).toEqual(["maya-a", "maya-c"]);
    });
  });

  describe("the flows time window", () => {
    const day = 86_400;
    /** Three crossings at 1, 40 and 200 days old, against the wall clock the store reads. */
    function aged() {
      const now = Math.floor(Date.now() / 1000);
      const store = new CrossChainStore();
      store.upsert([
        transfer({ id: "recent", counterpartChain: "BTC", timestamp: now - 1 * day }),
        transfer({ id: "mid", counterpartChain: "ETH", timestamp: now - 40 * day }),
        transfer({ id: "old", counterpartChain: "SOL", timestamp: now - 200 * day }),
      ]);
      return store;
    }

    it("counts everything when no window is given", () => {
      expect(
        aged()
          .flows()
          .flows.map((f) => f.chain)
          .sort(),
      ).toEqual(["BTC", "ETH", "SOL"]);
    });

    it("drops what falls outside the trailing window", () => {
      expect(
        aged()
          .flows(30)
          .flows.map((f) => f.chain),
      ).toEqual(["BTC"]);
      expect(
        aged()
          .flows(90)
          .flows.map((f) => f.chain)
          .sort(),
      ).toEqual(["BTC", "ETH"]);
    });

    /*
     * The echo the adapter checks: without it, an API too old to know the parameter is
     * indistinguishable from one that applied it.
     */
    it("echoes the window it applied, null included", () => {
      expect(aged().flows().windowDays).toBeNull();
      expect(aged().flows(30).windowDays).toBe(30);
    });

    it("reports firstAt/lastAt over what was counted, not over the whole table", () => {
      const windowed = aged().flows(30);
      expect(windowed.firstAt).toBe(windowed.lastAt);
    });
  });

  describe("venue health", () => {
    const VENUES = ["maya", "thorchain", "near-intents"] as const;

    it("reports a venue that has never polled as not live, without inventing a timestamp", () => {
      const store = new CrossChainStore();
      const health = store.health(VENUES, 1785084660);
      expect(health.map((v) => v.live)).toEqual([false, false, false]);
      expect(health[0]?.lastSuccessAt).toBeNull();
    });

    it("derives liveness from the last success, so a restart cannot fake health", () => {
      const store = new CrossChainStore();
      store.markSuccess("maya", 1785084660);
      const health = store.health(VENUES, 1785084660 + 60);
      expect(health.find((v) => v.protocol === "maya")?.live).toBe(true);

      const later = store.health(VENUES, 1785084660 + 11 * 60);
      expect(later.find((v) => v.protocol === "maya")?.live).toBe(false);
    });

    it("keeps the last success when a later poll fails, and clears the error on recovery", () => {
      const store = new CrossChainStore();
      store.markSuccess("thorchain", 1785084660);
      store.markFailure("thorchain", "getaddrinfo ENOTFOUND midgard.ninerealms.com");
      const failing = store.health(VENUES, 1785084660 + 60).find((v) => v.protocol === "thorchain");
      expect(failing?.lastError).toMatch(/ENOTFOUND/);
      expect(failing?.lastSuccessAt).toBe(1785084660);
      expect(failing?.live).toBe(true); // still inside the window

      store.markSuccess("thorchain", 1785084660 + 120);
      expect(
        store.health(VENUES, 1785084660 + 130).find((v) => v.protocol === "thorchain")?.lastError,
      ).toBeNull();
    });
  });
});
