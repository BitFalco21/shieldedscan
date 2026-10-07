// server/__tests__/zns.test.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseZnsRegistrations,
  parseZnsStatus,
  verifyRegistration,
  ZNS_MAINNET_ADMIN_PUBKEY,
  ZNS_MAINNET_UIVK,
  znsAdminKey,
  ZnsTracker,
  type ZnsRawRegistration,
} from "../zns";
import { znsRoutes } from "../zns-routes";

/**
 * Real captures of the mainnet registry (69 names). The status was served by a backend stuck at
 * 3,492,901, which is why the tests set our tip just above it.
 */
const capture = (name: string): unknown =>
  JSON.parse(readFileSync(join(__dirname, "..", "__fixtures__", "zns", name), "utf8"));
const STATUS = capture("mainnet-status.json") as { result: Record<string, unknown> };
const REGISTRY = capture("mainnet-registry.json") as { result: Record<string, unknown>[] };
const EVENTS = capture("mainnet-events.json") as {
  result: { events: Record<string, unknown>[]; total: number };
};
const SYNCED = STATUS.result.synced_height as number;
const KEY = znsAdminKey(ZNS_MAINNET_ADMIN_PUBKEY);

const rows = (): ZnsRawRegistration[] => parseZnsRegistrations(REGISTRY)!.rows;
const row = (name: string): ZnsRawRegistration => rows().find((r) => r.name === name)!;

describe("parsing the live shapes", () => {
  it("reads the status the registry actually sends — a base64 admin key, not the guide's hex", () => {
    const s = parseZnsStatus(STATUS)!;
    expect(s.uivk).toBe(ZNS_MAINNET_UIVK);
    expect(s.adminPubkey).toBe(ZNS_MAINNET_ADMIN_PUBKEY);
    expect(s.registered).toBe(69);
  });

  it("refuses a status missing the identity fields (the testnet shape) rather than guessing", () => {
    expect(
      parseZnsStatus({ result: { synced_height: 1, viewing_key: "x", registered: 5 } }),
    ).toBeNull();
    expect(parseZnsStatus({ error: { code: -32601 } })).toBeNull();
  });

  it("parses every row, though no row carries the `pubkey` key the guide documents", () => {
    const parsed = parseZnsRegistrations(REGISTRY)!;
    expect(parsed.served).toBe(69);
    expect(parsed.rows).toHaveLength(69);
    expect(REGISTRY.result.some((r) => "pubkey" in r)).toBe(false);
  });

  it("drops a malformed row and still reports what was served, so it is counted", () => {
    const parsed = parseZnsRegistrations({ result: [...REGISTRY.result, { name: 7 }] })!;
    expect(parsed.served).toBe(70);
    expect(parsed.rows).toHaveLength(69);
  });
});

describe("signatures, under the rules the registry actually signs", () => {
  it("verifies every live row against the pinned admin key", () => {
    expect(
      rows()
        .filter((r) => !verifyRegistration(r, KEY))
        .map((r) => r.name),
    ).toEqual([]);
  });

  it("verifies an UPDATE whose signature covers the nonce at update time, not the current one", () => {
    const z = row("zechariah");
    expect(z.lastAction).toBe("UPDATE");
    expect(z.nonce).toBe(2); // a later LIST moved it on; the signature covers 1
    expect(verifyRegistration(z, KEY)).toBe(true);
  });

  it("verifies a BUY over BUY:{name}:{buyer} — a preimage the guide says does not exist", () => {
    const c = row("childish");
    expect(c.lastAction).toBe("BUY");
    expect(verifyRegistration(c, KEY)).toBe(true);
  });

  it("fails a row whose address was swapped, and one whose signature was altered", () => {
    const z = row("zenith");
    const other = row("grandma").address;
    expect(verifyRegistration({ ...z, address: other }, KEY)).toBe(false);
    const sig = Buffer.from(z.signature!, "base64");
    sig[10] = sig[10]! ^ 1;
    expect(verifyRegistration({ ...z, signature: sig.toString("base64") }, KEY)).toBe(false);
  });

  it("never trusts a row resting on a DELIST or RELEASE, which sign no address", () => {
    expect(verifyRegistration({ ...row("zenith"), lastAction: "DELIST" }, KEY)).toBe(false);
  });
});

interface StubOptions {
  /** synced_height per status call, in order; the last repeats. */
  heights?: number[];
  uivk?: string;
  registered?: number[];
  /** Registry bodies per resolve call, in order; the last repeats. */
  registries?: unknown[];
  /** Event-log bodies per events call, in order; the last repeats. */
  eventLogs?: unknown[];
}

const nth = <T>(list: T[], i: number): T => list[Math.min(i, list.length - 1)]!;

function stubFetch(opts: StubOptions = {}): { fetch: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const counts = { status: 0, resolve: 0, events: 0 };
  const fetchStub = (async (_url: string, init?: RequestInit) => {
    const { method } = JSON.parse(String(init?.body)) as { method: keyof typeof counts };
    calls.push(method);
    const i = counts[method]++;
    if (method === "status") {
      return Response.json({
        result: {
          ...STATUS.result,
          synced_height: nth(opts.heights ?? [SYNCED], i),
          registered: nth(opts.registered ?? [69], i),
          uivk: opts.uivk ?? ZNS_MAINNET_UIVK,
        },
      });
    }
    if (method === "events") return Response.json(nth(opts.eventLogs ?? [EVENTS], i));
    return Response.json(nth(opts.registries ?? [REGISTRY], i));
  }) as typeof fetch;
  return { fetch: fetchStub, calls };
}

/** Our chain's view of every txid the registry cites: its height and a timestamp. */
const ALL_TXIDS = [
  ...REGISTRY.result.map((r) => [r.txid as string, r.height as number] as const),
  ...EVENTS.result.events.map((e) => [e.txid as string, e.height as number] as const),
].map(([txid, height]) => [txid, { height, timestamp: 1_700_000_000 + height }] as const);

function tracker(
  opts: StubOptions & { now?: () => number; missing?: string[]; tip?: number } = {},
): { t: ZnsTracker; calls: string[]; log: string[] } {
  const { fetch: f, calls } = stubFetch(opts);
  const heights = new Map(ALL_TXIDS);
  for (const txid of opts.missing ?? []) heights.delete(txid);
  const log: string[] = [];
  const t = new ZnsTracker({
    url: "https://zns.test",
    pinnedUivk: ZNS_MAINNET_UIVK,
    pinnedAdminPubkey: ZNS_MAINNET_ADMIN_PUBKEY,
    txBlocks: async () => heights,
    tipHeight: async () => opts.tip ?? SYNCED + 3,
    fetch: f,
    now: opts.now ?? (() => 1_790_000_000_000),
    log: (m) => log.push(m),
    sleep: async () => {},
  });
  return { t, calls, log };
}

const ONE_ATTEMPT = [
  ...Array(4).fill("status"),
  ...Array(4).fill("resolve"),
  ...Array(4).fill("events"),
];

describe("ZnsTracker", () => {
  it("publishes all 69 live names, and resolves any case or the .zcash form", async () => {
    const { t, calls } = tracker();
    await t.refresh();
    expect(t.current()!.byName.size).toBe(69);
    expect(t.current()!.excludedCount).toBe(0);
    // Each kind of read four times IN A ROW, so each spans the backend pool.
    expect(calls).toEqual(ONE_ATTEMPT);
    const hit = t.lookupName("  Zenith.ZCASH ")!;
    expect(hit.query).toBe("zenith");
    expect(hit.withheld).toBe(false);
    expect(hit.registrations.map((r) => r.name)).toEqual(["zenith"]);
    // The date comes from OUR index's block, never from the registry.
    expect(hit.registrations[0]!.timestamp).toBe(1_700_000_000 + hit.registrations[0]!.height);
    expect(t.lookupName("nobody")!.registrations).toEqual([]);
  });

  it("carries the listing price of a name on the marketplace, and null otherwise", async () => {
    const { t } = tracker();
    await t.refresh();
    expect(t.lookupName("bitcoin")!.registrations[0]!.listingPriceZat).toBe(55_500_000_000);
    expect(t.lookupName("zenith")!.registrations[0]!.listingPriceZat).toBeNull();
  });

  it("carries each name's history newest first, and a released name's history with no registration", async () => {
    const { t } = tracker();
    await t.refresh();
    const childish = t.lookupName("childish")!.history.map((e) => e.action);
    expect(childish).toEqual(["BUY", "LIST", "CLAIM"]);
    const released = t.lookupName("kazecstan")!;
    expect(released.registrations).toEqual([]);
    expect(released.history[0]!.action).toBe("RELEASE");
  });

  it("leaves out a history entry whose transaction is not on our chain", async () => {
    const buy = EVENTS.result.events.find((e) => e.name === "childish" && e.action === "BUY")!;
    const { t } = tracker({ missing: [buy.txid as string] });
    await t.refresh();
    expect(t.lookupName("childish")!.history.map((e) => e.action)).toEqual(["LIST", "CLAIM"]);
  });

  it("is cold (null) before its first good snapshot, which the route turns into a 503", () => {
    const { t } = tracker();
    expect(t.lookupName("zenith")).toBeNull();
  });

  it("refuses a registry whose UIVK is not the pin, without retrying", async () => {
    const { t, calls } = tracker({ uivk: "uivk1somethingelse" });
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
    const zenith = REGISTRY.result.find((r) => r.name === "zenith")!;
    const moved = {
      result: REGISTRY.result.map((r) =>
        r.name === "zenith" ? { ...zenith, address: REGISTRY.result[1]!.address } : r,
      ),
    };
    const { t, log } = tracker({ registries: [REGISTRY, moved, REGISTRY, REGISTRY] });
    await t.refresh();
    // Refused on attempt one; the stub then serves agreeing copies, so attempt two is accepted.
    expect(log[0]).toMatch(/disagree/);
    expect(t.lookupName("zenith")!.registrations[0]!.address).toBe(zenith.address);
  });

  it("refuses a read where one backend's event log is behind", async () => {
    const behind = {
      result: { events: EVENTS.result.events.slice(1), total: EVENTS.result.total - 1 },
    };
    const { t, log } = tracker({
      eventLogs: Array.from({ length: 16 }, (_, i) => (i % 2 === 0 ? EVENTS : behind)),
    });
    await t.refresh();
    expect(log.filter((m) => /disagree/.test(m)).length).toBeGreaterThan(0);
    expect(t.current()).toBeNull();
  });

  it("refuses a read where the backends disagree about how many names exist", async () => {
    const { t } = tracker({ registered: [69, 70] });
    await t.refresh();
    expect(t.current()).toBeNull();
  });

  it("excludes, and counts, a name whose transaction is not on our chain", async () => {
    const zenith = REGISTRY.result.find((r) => r.name === "zenith")!;
    const { t } = tracker({ missing: [zenith.txid as string] });
    await t.refresh();
    expect(t.current()!.excludedCount).toBe(1);
    expect(t.lookupName("zenith")!.registrations).toEqual([]);
  });

  it("refuses an empty registry rather than publishing that no names exist", async () => {
    const { t } = tracker({ registered: [0], registries: [{ result: [] }] });
    await t.refresh();
    expect(t.current()).toBeNull();
  });

  it("withholds every answer once the last good snapshot is over ten minutes old", async () => {
    let now = 1_790_000_000_000;
    const { t } = tracker({ now: () => now });
    await t.refresh();
    now += 11 * 60_000;
    const late = t.lookupName("zenith")!;
    expect(late.withheld).toBe(true);
    expect(late.registrations).toEqual([]);
    expect(late.history).toEqual([]);
  });

  it("keeps the last good snapshot when a later poll fails", async () => {
    let down = false;
    const { fetch: good } = stubFetch();
    const t = new ZnsTracker({
      url: "https://zns.test",
      pinnedUivk: ZNS_MAINNET_UIVK,
      pinnedAdminPubkey: ZNS_MAINNET_ADMIN_PUBKEY,
      txBlocks: async () => new Map(ALL_TXIDS),
      tipHeight: async () => SYNCED + 3,
      fetch: ((url: string, init?: RequestInit) =>
        down ? Promise.reject(new TypeError("fetch failed")) : good(url, init)) as typeof fetch,
      now: () => 1_790_000_000_000,
      log: () => {},
      sleep: async () => {},
    });
    await t.refresh();
    const before = t.current();
    down = true;
    await t.refresh();
    expect(t.current()).toBe(before);
    expect(t.lookupName("zenith")!.registrations).toHaveLength(1);
  });
});

describe("zns routes", () => {
  it("answers 400 for a path that cannot be a name", async () => {
    const { t } = tracker();
    await t.refresh();
    expect((await znsRoutes(t).request("/chain/zns/name/not_a_name!")).status).toBe(400);
  });

  it("serves no reverse lookup — a claim does not prove control of the address it names", async () => {
    const { t } = tracker();
    await t.refresh();
    expect((await znsRoutes(t).request(`/chain/zns/address/${row("zenith").address}`)).status).toBe(
      404,
    );
  });

  it("answers 503 while cold, and the lookup with its query echoed once warm", async () => {
    const { t } = tracker();
    const app = znsRoutes(t);
    expect((await app.request("/chain/zns/name/zenith")).status).toBe(503);
    await t.refresh();
    const res = await app.request("/chain/zns/name/zenith.zcash");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { query: string; registrations: { address: string }[] };
    expect(body.query).toBe("zenith");
    expect(body.registrations[0]!.address).toBe(row("zenith").address);
  });

  it("answers a miss as an empty answer, never a 404", async () => {
    const { t } = tracker();
    await t.refresh();
    const res = await znsRoutes(t).request("/chain/zns/name/nobodyhere");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { registrations: unknown[] }).registrations).toEqual([]);
  });
});
