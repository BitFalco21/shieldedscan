// server/__tests__/zns.test.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseZnsEvents,
  parseZnsRegistrations,
  parseZnsStatus,
  ZNS_MAINNET_VIEWING_KEY,
  ZnsTracker,
} from "../zns";
import { znsRoutes } from "../zns-routes";

/** Real captures of the mainnet resolver (81 names, every one a claim). */
const capture = (name: string): unknown =>
  JSON.parse(readFileSync(join(__dirname, "..", "__fixtures__", "zns", name), "utf8"));
type Row = Record<string, unknown>;
const STATUS = capture("mainnet-status.json") as { result: Row };
const REGISTRY = capture("mainnet-registry.json") as { result: { items: Row[]; total: number } };
const EVENTS = capture("mainnet-events.json") as { result: { events: Row[]; total: number } };
const SYNCED = STATUS.result.synced_height as number;
const NOW_MS = 1_790_000_000_000;

const item = (name: string): Row => REGISTRY.result.items.find((r) => r.name === name)!;
const registryOf = (items: Row[]) => ({ result: { items, total: items.length } });
const eventLogOf = (events: Row[]) => ({ result: { events, total: events.length } });

describe("parsing the live shapes", () => {
  it("reads the status the resolver sends, and its viewing key is the pin", () => {
    const s = parseZnsStatus(STATUS)!;
    expect(s.viewingKey).toBe(ZNS_MAINNET_VIEWING_KEY);
    expect(s.syncedHeight).toBe(SYNCED);
  });

  it("refuses a status without a viewing key (the beta shape) rather than guessing", () => {
    expect(parseZnsStatus({ result: { synced_height: 1, uivk: "x", admin_pubkey: "y" } })).toBe(
      null,
    );
    expect(parseZnsStatus({ error: { code: -32601 } })).toBeNull();
  });

  it("parses every row, with its action and expiry", () => {
    const parsed = parseZnsRegistrations(REGISTRY)!;
    expect(parsed.served).toBe(81);
    expect(parsed.total).toBe(81);
    expect(parsed.rows).toHaveLength(81);
    expect(parsed.rows.find((r) => r.name === "0xsahand")).toMatchObject({
      lastAction: "CLAIM",
      expiresAt: null,
    });
    expect(parsed.rows.find((r) => r.name === "adrian")!.expiresAt).toBe(1_823_651_421);
  });

  it("drops a malformed row and still reports what was served, so it is counted", () => {
    const items = REGISTRY.result.items;
    const odd = [
      { name: 7 },
      { ...items[0], expires_at: "soon" },
      // A registration resting on a release is not one in force.
      { ...items[1], last_action: "release" },
    ];
    const parsed = parseZnsRegistrations(registryOf([...items, ...odd]))!;
    expect(parsed.served).toBe(84);
    expect(parsed.rows).toHaveLength(81);
  });

  it("reads the event log, including an implicit release's negative id", () => {
    const release = { ...EVENTS.result.events[0], id: -1, action: "release" };
    const parsed = parseZnsEvents(eventLogOf([release, ...EVENTS.result.events]))!;
    expect(parsed.events).toHaveLength(82);
    expect(parsed.events[0]!.action).toBe("RELEASE");
    expect(parsed.events[1]!.action).toBe("CLAIM");
  });
});

interface StubOptions {
  /** synced_height per status call, in order; the last repeats. */
  heights?: number[];
  viewingKey?: string;
  /** Registry bodies per list_names call, in order; the last repeats. */
  registries?: unknown[];
  /** Event-log bodies per events call, in order; the last repeats. */
  eventLogs?: unknown[];
}

const nth = <T>(list: T[], i: number): T => list[Math.min(i, list.length - 1)]!;

function stubFetch(opts: StubOptions = {}): { fetch: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const counts = { status: 0, list_names: 0, events: 0 };
  const fetchStub = (async (_url: string, init?: RequestInit) => {
    const { method } = JSON.parse(String(init?.body)) as { method: keyof typeof counts };
    calls.push(method);
    const i = counts[method]++;
    if (method === "status") {
      return Response.json({
        result: {
          ...STATUS.result,
          synced_height: nth(opts.heights ?? [SYNCED], i),
          viewing_key: opts.viewingKey ?? ZNS_MAINNET_VIEWING_KEY,
        },
      });
    }
    if (method === "events") return Response.json(nth(opts.eventLogs ?? [EVENTS], i));
    return Response.json(nth(opts.registries ?? [REGISTRY], i));
  }) as typeof fetch;
  return { fetch: fetchStub, calls };
}

function tracker(
  opts: StubOptions & {
    now?: () => number;
    missing?: string[];
    tip?: number;
    /** Extra txids on our chain, beyond those the captures cite. */
    onChain?: Row[];
    /** While this returns true, every request fails as a network error. */
    down?: () => boolean;
  } = {},
): { t: ZnsTracker; calls: string[]; log: string[] } {
  const { fetch: stub, calls } = stubFetch(opts);
  const f = ((url: string, init?: RequestInit) =>
    opts.down?.()
      ? Promise.reject(new TypeError("fetch failed"))
      : stub(url, init)) as typeof fetch;
  // Our chain's view of every txid the registry cites: its height and a timestamp.
  const heights = new Map(
    [...REGISTRY.result.items, ...EVENTS.result.events, ...(opts.onChain ?? [])].map((r) => [
      r.txid as string,
      { height: r.height as number, timestamp: 1_700_000_000 + (r.height as number) },
    ]),
  );
  for (const txid of opts.missing ?? []) heights.delete(txid);
  const log: string[] = [];
  const t = new ZnsTracker({
    url: "https://zns.test",
    pinnedViewingKey: ZNS_MAINNET_VIEWING_KEY,
    txBlocks: async () => heights,
    tipHeight: async () => opts.tip ?? SYNCED + 3,
    fetch: f,
    now: opts.now ?? (() => NOW_MS),
    log: (m) => log.push(m),
    sleep: async () => {},
  });
  return { t, calls, log };
}

const ONE_ATTEMPT = [
  ...Array(4).fill("status"),
  ...Array(4).fill("list_names"),
  ...Array(4).fill("events"),
];

describe("ZnsTracker", () => {
  it("publishes all 81 live names, and resolves any case or the .zcash form", async () => {
    const { t, calls } = tracker();
    await t.refresh();
    expect(t.current()!.byName.size).toBe(81);
    expect(t.current()!.excludedCount).toBe(0);
    // Each kind of read four times IN A ROW, so each spans the backend pool.
    expect(calls).toEqual(ONE_ATTEMPT);
    const hit = t.lookupName("  Adrian.ZCASH ")!;
    expect(hit.query).toBe("adrian");
    expect(hit.withheld).toBe(false);
    expect(hit.registrations).toEqual([
      {
        name: "adrian",
        address: item("adrian").address,
        txid: item("adrian").txid,
        height: item("adrian").height,
        // The date comes from OUR index's block, never from the registry.
        timestamp: 1_700_000_000 + (item("adrian").height as number),
        lastAction: "CLAIM",
      },
    ]);
    expect(hit.history.map((e) => e.action)).toEqual(["CLAIM"]);
    expect(t.lookupName("nobody")!.registrations).toEqual([]);
  });

  it("answers a name past its expiry as unregistered, keeping its history", async () => {
    const expiry = Number(item("adrian").expires_at) * 1000;
    let now = expiry - 60_000;
    const { t } = tracker({ now: () => now });
    await t.refresh();
    now = expiry;
    const lapsed = t.lookupName("adrian")!;
    expect(lapsed.withheld).toBe(false);
    expect(lapsed.registrations).toEqual([]);
    expect(lapsed.history).toHaveLength(1);
    // A name that never expires is unaffected.
    expect(t.lookupName("0xsahand")!.registrations).toHaveLength(1);
  });

  it("carries an update's verb, and a released name's history with no registration", async () => {
    const claim = EVENTS.result.events.find((e) => e.name === "adrian")!;
    const other = item("0xsahand").address;
    const update = {
      ...claim,
      id: 900,
      action: "update",
      txid: "e".repeat(64),
      height: SYNCED,
      address: other,
    };
    const updated = REGISTRY.result.items.map((r) =>
      r.name === "adrian"
        ? { ...r, address: other, txid: update.txid, height: SYNCED, last_action: "update" }
        : r,
    );
    const shmoko = EVENTS.result.events.find((e) => e.name === "shmoko")!;
    const release = { ...shmoko, id: -1, action: "release", txid: "f".repeat(64), height: SYNCED };
    const { t } = tracker({
      registries: [registryOf(updated.filter((r) => r.name !== "shmoko"))],
      eventLogs: [eventLogOf([update, release, ...EVENTS.result.events])],
      onChain: [update, release],
    });
    await t.refresh();
    const adrian = t.lookupName("adrian")!;
    expect(adrian.registrations[0]).toMatchObject({ lastAction: "UPDATE", address: other });
    expect(adrian.history.map((e) => [e.action, e.address])).toEqual([
      ["UPDATE", other],
      ["CLAIM", claim.address],
    ]);
    const released = t.lookupName("shmoko")!;
    expect(released.registrations).toEqual([]);
    // The release ended a binding; the history says it points nowhere.
    expect(released.history.map((e) => [e.action, e.address])).toEqual([
      ["RELEASE", null],
      ["CLAIM", shmoko.address],
    ]);
  });

  it("leaves out a history entry whose transaction is not on our chain", async () => {
    const claim = EVENTS.result.events.find((e) => e.name === "adrian")!;
    const { t } = tracker({ missing: [claim.txid as string] });
    await t.refresh();
    expect(t.lookupName("adrian")!.history).toEqual([]);
  });

  it("is cold (null) before its first good snapshot, which the route turns into a 503", () => {
    const { t } = tracker();
    expect(t.lookupName("adrian")).toBeNull();
  });

  it("refuses a resolver whose viewing key is not the pin, without retrying", async () => {
    const { t, calls } = tracker({ viewingKey: "uview1somethingelse" });
    await t.refresh();
    expect(t.current()).toBeNull();
    expect(calls).toEqual(["status"]);
  });

  it("accepts the live pool: one fresh backend among stale ones serving identical data", async () => {
    // A pool rotating current, stale, stale, current. Contents agree, so this is the fresh
    // backend's data, which a bracketed height check would refuse every time.
    const { t, calls } = tracker({ heights: [SYNCED, SYNCED - 9_900, SYNCED - 9_900, SYNCED] });
    await t.refresh();
    expect(t.current()!.indexerHeight).toBe(SYNCED);
    expect(calls).toEqual(ONE_ATTEMPT);
  });

  it("does not accept a pool with NO backend near our tip", async () => {
    const { t, calls } = tracker({ tip: SYNCED + 9_900 });
    await t.refresh();
    expect(t.current()).toBeNull();
    expect(calls).toHaveLength(ONE_ATTEMPT.length * 4); // four attempts
  });

  it("refuses a read where one backend serves a different registry — the outdated-address case", async () => {
    const moved = registryOf(
      REGISTRY.result.items.map((r) =>
        r.name === "adrian" ? { ...r, address: item("0xsahand").address } : r,
      ),
    );
    const { t, log } = tracker({ registries: [REGISTRY, moved, REGISTRY, REGISTRY] });
    await t.refresh();
    // Refused on attempt one; the stub then serves agreeing copies, so attempt two is accepted.
    expect(log[0]).toMatch(/disagree/);
    expect(t.lookupName("adrian")!.registrations[0]!.address).toBe(item("adrian").address);
  });

  it("refuses a read where one backend's event log is behind", async () => {
    const behind = eventLogOf(EVENTS.result.events.slice(1));
    const { t, log } = tracker({
      eventLogs: Array.from({ length: 16 }, (_, i) => (i % 2 === 0 ? EVENTS : behind)),
    });
    await t.refresh();
    expect(log.filter((m) => /disagree/.test(m)).length).toBeGreaterThan(0);
    expect(t.current()).toBeNull();
  });

  it("refuses a registry walk that falls short of its own total", async () => {
    const short = { result: { items: REGISTRY.result.items.slice(1), total: 81 } };
    const { t, log } = tracker({ registries: [short] });
    await t.refresh();
    expect(t.current()).toBeNull();
    expect(log[0]).toMatch(/does not match its total/);
  });

  it("excludes, and counts, a name whose transaction is not on our chain", async () => {
    const { t } = tracker({ missing: [item("adrian").txid as string] });
    await t.refresh();
    expect(t.current()!.excludedCount).toBe(1);
    expect(t.lookupName("adrian")!.registrations).toEqual([]);
  });

  it("excludes, and counts, a name on an address that is not a mainnet unified address", async () => {
    const testnet = registryOf(
      REGISTRY.result.items.map((r) => (r.name === "adrian" ? { ...r, address: "utest1abc" } : r)),
    );
    const { t } = tracker({ registries: [testnet] });
    await t.refresh();
    expect(t.current()!.excludedCount).toBe(1);
    expect(t.lookupName("adrian")!.registrations).toEqual([]);
  });

  it("refuses an empty registry rather than publishing that no names exist", async () => {
    const { t } = tracker({ registries: [registryOf([])] });
    await t.refresh();
    expect(t.current()).toBeNull();
  });

  it("withholds every answer once the last good snapshot is over ten minutes old", async () => {
    let now = NOW_MS;
    const { t } = tracker({ now: () => now });
    await t.refresh();
    now += 11 * 60_000;
    const late = t.lookupName("adrian")!;
    expect(late.withheld).toBe(true);
    expect(late.registrations).toEqual([]);
    expect(late.history).toEqual([]);
  });

  it("keeps the last good snapshot when a later poll fails", async () => {
    let down = false;
    const { t } = tracker({ down: () => down });
    await t.refresh();
    const before = t.current();
    down = true;
    await t.refresh();
    expect(t.current()).toBe(before);
    expect(t.lookupName("adrian")!.registrations).toHaveLength(1);
  });
});

describe("zns routes", () => {
  it("answers 400 for a path that cannot be a name", async () => {
    const { t } = tracker();
    await t.refresh();
    expect((await znsRoutes(t).request("/chain/zns/name/not_a_name!")).status).toBe(400);
  });

  it("serves no reverse lookup — a registration does not prove control of its address", async () => {
    const { t } = tracker();
    await t.refresh();
    const address = item("adrian").address as string;
    expect((await znsRoutes(t).request(`/chain/zns/address/${address}`)).status).toBe(404);
  });

  it("answers 503 while cold, and the lookup with its query echoed once warm", async () => {
    const { t } = tracker();
    const app = znsRoutes(t);
    expect((await app.request("/chain/zns/name/adrian")).status).toBe(503);
    await t.refresh();
    const res = await app.request("/chain/zns/name/adrian.zcash");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { query: string; registrations: { address: string }[] };
    expect(body.query).toBe("adrian");
    expect(body.registrations[0]!.address).toBe(item("adrian").address);
  });

  it("answers a miss as an empty answer, never a 404", async () => {
    const { t } = tracker();
    await t.refresh();
    const res = await znsRoutes(t).request("/chain/zns/name/zechariah");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { registrations: unknown[] }).registrations).toEqual([]);
  });
});
