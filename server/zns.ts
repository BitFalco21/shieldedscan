import {
  decodeUnifiedAddress,
  parseZnsName,
  ZNS_MAX_LAG_BLOCKS,
  type ZnsEventAction,
  type ZnsLastAction,
  type ZnsLookup,
  type ZnsNameEvent,
  type ZnsRegistration,
} from "@/domain";
import { readJsonCapped } from "./body-limit";

/**
 * The Zcash Name System registry (zcashnames.com), read as a snapshot.
 *
 * - A snapshot, never a per-query forward: the whole registry is read every two minutes and every
 *   lookup is answered from memory, so no visitor's search ever reaches the registry.
 * - No SDK: the parsers follow what the resolver actually sends, and the SDK carries runtime
 *   dependencies and pins keys of its own that have lagged the live registry.
 * - A registration is a Name Note: a zero-value shielded note to the registry whose memo carries the
 *   binding, which only the registry's viewing key can read. The resolver does that work; what we
 *   can check, we do, and a row failing any check is excluded and counted: the resolver identifies
 *   itself with the viewing key pinned here (a key taken from the server it vouches for proves
 *   nothing about that server); the address is a mainnet unified address; and the transaction the
 *   row rests on is in our index at the height it claims, which also drops a claim a reorg removed.
 * - A name past its `expires_at` is answered as unregistered. The resolver keeps serving it, but an
 *   expired registration is no longer a payment instruction.
 * - Freshness is a content check across the registry's backend pool, which has been observed
 *   rotating between current and stale backends. A poll reads status, the registry and the event
 *   log each READS_PER_ATTEMPT times in a row, so each kind of read spans the pool, and accepts the
 *   snapshot only when at least one status read is within ZNS_MAX_LAG_BLOCKS of our tip and every
 *   registry copy and every event-log copy is identical. A stale backend that is behind on content
 *   disagrees, and the poll is refused, which is the case that would serve an outdated address.
 *   Residual risk: with other clients' requests interleaved, all copies could come from stale
 *   backends that agree; only the registry can close that.
 */

/** The mainnet endpoint `zcashname-sdk` presets; `main.zcashnames.com` fronts the same pool. */
export const ZNS_MAINNET_URL = "https://light.zcash.me/zns-mainnet";
/**
 * The registry's unified full viewing key, from the mainnet ceremony that relaunched the registry
 * at block 3,518,764. Pinned from the `UFVK` constant in the resolver's own source
 * (github.com/zcashme/zns-resolver, `src/main.rs`), which matches the live `status.viewing_key`.
 */
export const ZNS_MAINNET_VIEWING_KEY =
  "uview1209ld9y4fr2sel9q87kfjg7xm2sy53e3qf7dvcw3w8jwhhjpldl8z0vk0a6hveg4jk7xcn0rc9mr8yg77djfpc0uxrm5pqzt8q7ul4w0nvs3x5q9vmk9nm2crywtqaealek4mp47ur7ywu7g4g4xcdlwv6gnqzvu5panv5je2ps6rxmx4856unlt5wde8fpz8uhrqchmwhn2j252h3cyx5phad877xezerm6ex8l5kcfjw02ll7m0nspfufamh3ae9ea48395elptspnv6vvc70j2gcjrdze9syt8kpr2kc67flvg8687thdkpha7lpt9r4p9wjty90q2v2yjanqsr2zrecrqs7lfx9cpkmshf7jyh2vvwfqnyzwtpuy7p72hm2mjhperdafvm9u5rwa6s6urcy0uw30f687e3jnmas45qfqtwyz39kf6kxklfrdn7t4hkz56jegmlr8s8hwmt9wa8vz8zlmm76lrmzyj82nzpeqfu572njq";

const POLL_MS = 2 * 60_000;
/** Past this the last good snapshot is withheld: a registry we cannot read is not a current one. */
const MAX_SNAPSHOT_AGE_SECONDS = 10 * 60;
const REQUEST_TIMEOUT_MS = 15_000;
/** The resolver's own `limit` ceiling. */
const PAGE_SIZE = 500;
/** A backstop on the page walk: 20,000 names, far above the registry's current size. */
const MAX_PAGES = 40;
/** Attempts per poll at an accepted read before keeping the previous snapshot. */
const ATTEMPTS_PER_POLL = 4;
/**
 * Consecutive reads of each kind per attempt. Under round-robin, N consecutive requests reach N
 * distinct backends for any pool of up to N backends.
 */
const READS_PER_ATTEMPT = 4;

export interface ZnsStatus {
  syncedHeight: number;
  viewingKey: string;
}

/** A registration as the resolver sends it, before the chain check. */
export interface ZnsRawRegistration {
  name: string;
  address: string;
  txid: string;
  height: number;
  lastAction: ZnsLastAction;
  /** Unix seconds, or null for a registration that never expires. */
  expiresAt: number | null;
}

/** An event-log entry as the resolver sends it, before the chain check. */
export interface ZnsRawEvent {
  name: string;
  action: ZnsEventAction;
  txid: string;
  height: number;
  /** The address the action bound the name to or, for a release, the binding it ended. */
  address: string;
}

/** A published registration and when it lapses, which is judged when a lookup is answered. */
interface PublishedName {
  registration: ZnsRegistration;
  expiresAt: number | null;
}

export interface ZnsSnapshot {
  asOf: number;
  indexerHeight: number;
  tipHeight: number;
  /** Rows the registry served that failed a check and are not published. */
  excludedCount: number;
  byName: ReadonlyMap<string, PublishedName>;
  /** Each name's history, newest first; events whose transaction is not on our chain are left out. */
  historyByName: ReadonlyMap<string, readonly ZnsNameEvent[]>;
}

/** The resolver's lowercase actions. A registration rests on a claim or an update, never a release. */
const ACTIONS: Readonly<Record<string, ZnsEventAction>> = {
  claim: "CLAIM",
  update: "UPDATE",
  release: "RELEASE",
};

function resultOf(body: unknown): unknown {
  if (typeof body !== "object" || body === null) return undefined;
  const envelope = body as { result?: unknown; error?: unknown };
  return envelope.error === undefined ? envelope.result : undefined;
}

const isCount = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const isTxid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);

/** `expires_at` is `"none"` or decimal unix seconds; undefined for anything else. */
function parseExpiry(v: unknown): number | null | undefined {
  if (v === "none") return null;
  if (typeof v !== "string" || !/^(0|[1-9][0-9]{0,15})$/.test(v)) return undefined;
  return Number(v);
}

export function parseZnsStatus(body: unknown): ZnsStatus | null {
  const r = resultOf(body) as Record<string, unknown> | undefined;
  if (!r || !isCount(r.synced_height) || typeof r.viewing_key !== "string") return null;
  return { syncedHeight: r.synced_height, viewingKey: r.viewing_key };
}

/**
 * One `list_names` page. Malformed rows are dropped (and counted by the caller, which compares the
 * page length) rather than failing the page, so one bad row cannot hide every other name. A
 * malformed envelope is null: that is a broken response.
 */
export function parseZnsRegistrations(
  body: unknown,
): { rows: ZnsRawRegistration[]; served: number; total: number } | null {
  const result = resultOf(body) as { items?: unknown; total?: unknown } | undefined;
  if (!result || !Array.isArray(result.items) || !isCount(result.total)) return null;
  const rows: ZnsRawRegistration[] = [];
  for (const raw of result.items) {
    if (typeof raw !== "object" || raw === null) continue;
    const r = raw as Record<string, unknown>;
    const lastAction = ACTIONS[String(r.last_action)];
    const expiresAt = parseExpiry(r.expires_at);
    if (
      typeof r.name !== "string" ||
      typeof r.address !== "string" ||
      !isTxid(r.txid) ||
      !isCount(r.height) ||
      lastAction === undefined ||
      lastAction === "RELEASE" ||
      expiresAt === undefined
    ) {
      continue;
    }
    rows.push({
      name: r.name,
      address: r.address,
      txid: r.txid,
      height: r.height,
      lastAction,
      expiresAt,
    });
  }
  return { rows, served: result.items.length, total: result.total };
}

/** One event-log page, malformed entries dropped and counted like registry rows. */
export function parseZnsEvents(
  body: unknown,
): { events: ZnsRawEvent[]; served: number; total: number } | null {
  const result = resultOf(body) as { events?: unknown; total?: unknown } | undefined;
  if (!result || !Array.isArray(result.events) || !isCount(result.total)) return null;
  const events: ZnsRawEvent[] = [];
  for (const raw of result.events) {
    if (typeof raw !== "object" || raw === null) continue;
    const e = raw as Record<string, unknown>;
    const action = ACTIONS[String(e.action)];
    if (
      typeof e.name !== "string" ||
      action === undefined ||
      !isTxid(e.txid) ||
      !isCount(e.height) ||
      typeof e.address !== "string"
    ) {
      continue;
    }
    events.push({ name: e.name, action, txid: e.txid, height: e.height, address: e.address });
  }
  return { events, served: result.events.length, total: result.total };
}

export interface ZnsTrackerDeps {
  url: string;
  pinnedViewingKey: string;
  /** The block (height, timestamp) each txid sits in on our index; absent when it is not there. */
  txBlocks: (
    txids: readonly string[],
  ) => Promise<ReadonlyMap<string, { height: number; timestamp: number }>>;
  /** Our indexed tip, or null when unreadable. */
  tipHeight: () => Promise<number | null>;
  fetch: typeof globalThis.fetch;
  now: () => number;
  log: (m: string) => void;
  /** Pause between attempts; a test passes a no-op. */
  sleep?: (ms: number) => Promise<void>;
}

export class ZnsTracker {
  #snapshot: ZnsSnapshot | null = null;
  #timer: NodeJS.Timeout | null = null;

  constructor(private readonly deps: ZnsTrackerDeps) {}

  current(): ZnsSnapshot | null {
    return this.#snapshot;
  }

  /**
   * A forward lookup, name to registration; null while no snapshot has been taken (and for a string
   * that cannot be a name, which the route refuses before asking).
   *
   * There is no reverse lookup. Nothing in a registration proves control of the address it names,
   * so a name found by address may have been pointed there by a stranger, and listing it would let
   * anyone label anyone's address.
   */
  lookupName(raw: string): ZnsLookup | null {
    const name = parseZnsName(raw);
    if (name === null) return null;
    return this.#answer(name);
  }

  #answer(name: string): ZnsLookup | null {
    const s = this.#snapshot;
    if (s === null) return null;
    const nowSeconds = Math.floor(this.deps.now() / 1000);
    const withheld =
      nowSeconds - s.asOf > MAX_SNAPSHOT_AGE_SECONDS ||
      s.tipHeight - s.indexerHeight > ZNS_MAX_LAG_BLOCKS;
    const hit = withheld ? undefined : s.byName.get(name);
    const live = hit !== undefined && (hit.expiresAt === null || hit.expiresAt > nowSeconds);
    return {
      query: name,
      registrations: live ? [hit.registration] : [],
      history: withheld ? [] : [...(s.historyByName.get(name) ?? [])],
      withheld,
      indexerHeight: s.indexerHeight,
      tipHeight: s.tipHeight,
      asOf: s.asOf,
    };
  }

  async #rpc(method: string, params: Record<string, unknown>): Promise<unknown> {
    const res = await this.deps.fetch(this.deps.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${method}`);
    return readJsonCapped(res);
  }

  async #status(): Promise<ZnsStatus> {
    const status = parseZnsStatus(await this.#rpc("status", {}));
    if (status === null) throw new Error("unrecognised status shape");
    // Not retried: a different key is a different registry, or a compromised one.
    if (status.viewingKey !== this.deps.pinnedViewingKey) {
      throw new IdentityError("viewing key does not match the pin");
    }
    return status;
  }

  /** The whole registry, or a throw: a walk that does not end at the reported total is partial. */
  async #registry(): Promise<{ rows: ZnsRawRegistration[]; served: number }> {
    const rows: ZnsRawRegistration[] = [];
    let served = 0;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const parsed = parseZnsRegistrations(
        await this.#rpc("list_names", { limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
      );
      if (parsed === null) throw new Error("unrecognised registry page shape");
      rows.push(...parsed.rows);
      served += parsed.served;
      if (parsed.served < PAGE_SIZE || served >= parsed.total) {
        if (served !== parsed.total) throw new Error("registry walk does not match its total");
        return { rows, served };
      }
    }
    throw new Error(`registry exceeded ${MAX_PAGES} pages — refusing a partial snapshot`);
  }

  async #events(): Promise<ZnsRawEvent[]> {
    const events: ZnsRawEvent[] = [];
    let served = 0;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const parsed = parseZnsEvents(
        await this.#rpc("events", { limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
      );
      if (parsed === null) throw new Error("unrecognised events page shape");
      events.push(...parsed.events);
      served += parsed.served;
      if (parsed.served < PAGE_SIZE || served >= parsed.total) return events;
    }
    throw new Error(`event log exceeded ${MAX_PAGES} pages — refusing a partial snapshot`);
  }

  async #repeat<T>(read: () => Promise<T>): Promise<T[]> {
    const out: T[] = [];
    // Sequential on purpose: consecutive requests are what spread the reads across the pool.
    for (let i = 0; i < READS_PER_ATTEMPT; i += 1) out.push(await read());
    return out;
  }

  /**
   * One read across the pool, or null when it could not be accepted this time (the caller retries).
   * Throws on an identity mismatch or a malformed response.
   */
  async #attempt(tip: number): Promise<ZnsSnapshot | null> {
    const statuses = await this.#repeat(() => this.#status());
    const registries = await this.#repeat(() => this.#registry());
    const eventLogs = await this.#repeat(() => this.#events());

    const indexerHeight = Math.max(...statuses.map((s) => s.syncedHeight));
    if (tip - indexerHeight > ZNS_MAX_LAG_BLOCKS) {
      this.deps.log(
        `[zns] no backend within ${ZNS_MAX_LAG_BLOCKS} blocks of our tip — not accepted`,
      );
      return null;
    }
    const registry = registries[0]!;
    const events = eventLogs[0]!;
    if (
      !registries.every((r) => JSON.stringify(r) === JSON.stringify(registry)) ||
      !eventLogs.every((e) => JSON.stringify(e) === JSON.stringify(events))
    ) {
      this.deps.log("[zns] backends disagree on the registry's contents — not accepted");
      return null;
    }
    if (registry.served === 0) throw new Error("registry is empty — refusing an empty snapshot");

    const onChain = await this.deps.txBlocks([
      ...new Set([...registry.rows.map((r) => r.txid), ...events.map((e) => e.txid)]),
    ]);
    const nameCounts = new Map<string, number>();
    for (const r of registry.rows) nameCounts.set(r.name, (nameCounts.get(r.name) ?? 0) + 1);

    const byName = new Map<string, PublishedName>();
    for (const r of registry.rows) {
      const block = onChain.get(r.txid);
      if (
        parseZnsName(r.name) !== r.name ||
        nameCounts.get(r.name) !== 1 ||
        !isMainnetAddress(r.address) ||
        block?.height !== r.height
      ) {
        continue;
      }
      byName.set(r.name, {
        registration: {
          name: r.name,
          address: r.address,
          txid: r.txid,
          height: r.height,
          timestamp: block.timestamp,
          lastAction: r.lastAction,
        },
        expiresAt: r.expiresAt,
      });
    }

    // The log arrives newest first in the resolver's canonical order (height, then position in
    // the block), which our data cannot reproduce, so it is kept as sent.
    const historyByName = new Map<string, ZnsNameEvent[]>();
    for (const e of events) {
      const block = onChain.get(e.txid);
      const bound = e.action !== "RELEASE";
      if (
        parseZnsName(e.name) !== e.name ||
        block?.height !== e.height ||
        (bound && !isMainnetAddress(e.address))
      ) {
        continue;
      }
      const list = historyByName.get(e.name) ?? [];
      list.push({
        action: e.action,
        txid: e.txid,
        height: e.height,
        timestamp: block.timestamp,
        // A release carries the address it ended; the history says where an action pointed.
        address: bound ? e.address : null,
      });
      historyByName.set(e.name, list);
    }

    return {
      asOf: Math.floor(this.deps.now() / 1000),
      indexerHeight,
      tipHeight: tip,
      excludedCount: registry.served - byName.size,
      byName,
      historyByName,
    };
  }

  async refresh(): Promise<void> {
    try {
      const tip = await this.deps.tipHeight();
      if (tip === null) throw new Error("our tip is unreadable — cannot judge freshness");
      for (let attempt = 1; attempt <= ATTEMPTS_PER_POLL; attempt += 1) {
        const snapshot = await this.#attempt(tip);
        if (snapshot !== null) {
          this.#snapshot = snapshot;
          this.deps.log(
            `[zns] snapshot: ${snapshot.byName.size} names, ${snapshot.excludedCount} excluded, ` +
              `registry at ${snapshot.indexerHeight}, tip ${tip} (attempt ${attempt})`,
          );
          return;
        }
        if (attempt < ATTEMPTS_PER_POLL)
          await (this.deps.sleep ?? defaultSleep)(1_000 + 2_000 * Math.random());
      }
      this.deps.log(
        `[zns] no fresh read in ${ATTEMPTS_PER_POLL} attempts — keeping the last snapshot`,
      );
    } catch (error) {
      // Keep the previous snapshot; a failure is never stored. It ages into `withheld`.
      this.deps.log(`[zns] refresh failed: ${String(error)}`);
    }
  }

  start(): () => void {
    void this.refresh();
    const timer = setInterval(() => void this.refresh(), POLL_MS);
    timer.unref();
    this.#timer = timer;
    return () => {
      if (this.#timer !== null) clearInterval(this.#timer);
    };
  }
}

class IdentityError extends Error {}

const isMainnetAddress = (address: string): boolean =>
  decodeUnifiedAddress(address)?.network === "mainnet";

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
