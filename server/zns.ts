import { createPublicKey, verify, type KeyObject } from "node:crypto";
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
 * - No SDK: the parsers follow what the server actually sends (established by calling the
 *   endpoints), and the SDK defaults to testnet and carries runtime dependencies.
 * - A row is published only after three checks, any failure excluding and counting it: the
 *   registry identifies itself with the UIVK and admin key pinned here (a key taken from the
 *   server it vouches for proves nothing about that server); the row's Ed25519 signature verifies
 *   under the real preimage rules; and the transaction it rests on is in our index at the height it
 *   claims, which also drops a claim a reorg removed.
 * - Freshness is a content check across the registry's backend pool, which has been observed
 *   rotating between current and stale backends. A poll reads status, the registry and the event
 *   log each READS_PER_ATTEMPT times in a row, so each kind of read spans the pool, and accepts the
 *   snapshot only when at least one status read is within ZNS_MAX_LAG_BLOCKS of our tip and every
 *   registry copy and every event-log copy is identical. A stale backend that is behind on content
 *   disagrees, and the poll is refused, which is the case that would serve an outdated address.
 *   Residual risk: with other clients' requests interleaved, all copies could come from stale
 *   backends that agree; only the registry can close that.
 */

export const ZNS_MAINNET_URL = "https://main.zcashnames.com";
/** Matches `NETWORKS.mainnet.uivk` in zcashname-sdk 0.12.0 and the live `status.uivk`. */
export const ZNS_MAINNET_UIVK =
  "uivk1gl26qy0xjja7lqhyg3pf0x4j4j66kqwewrjkdcg28eqq4wgtzjmujpee7x9cs2ec9xhnlgrm8ptlw8z80j2aryw8nqtssser2ys778a0s00uvgkdjnfr58sndhfvc3f4zqjs6ywva6";
/**
 * The registry's admin Ed25519 key, base64 (not hex). Every live mainnet name is OTP-controlled, so
 * this is the key every published signature verifies under.
 */
export const ZNS_MAINNET_ADMIN_PUBKEY = "zobrGyAwpM3mtC0Vo4UOk0bc9Ygg0gdDeD8dCQAOXI4=";

const POLL_MS = 2 * 60_000;
/** Past this the last good snapshot is withheld: a registry we cannot read is not a current one. */
const MAX_SNAPSHOT_AGE_SECONDS = 10 * 60;
const REQUEST_TIMEOUT_MS = 15_000;
/** The registry's own `limit` ceiling. */
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
/** SPKI DER prefix for a raw 32-byte Ed25519 public key (RFC 8410). */
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export interface ZnsStatus {
  syncedHeight: number;
  uivk: string;
  adminPubkey: string;
  registered: number;
}

/** A registration as the registry sends it, before verification. */
export interface ZnsRawRegistration {
  name: string;
  address: string;
  txid: string;
  height: number;
  lastAction: ZnsLastAction;
  nonce: number;
  signature: string | null;
  listingPriceZat: number | null;
}

/** An event-log entry as the registry sends it, before the chain check. */
export interface ZnsRawEvent {
  id: number;
  name: string;
  action: ZnsEventAction;
  txid: string;
  height: number;
  address: string | null;
  priceZat: number | null;
}

export interface ZnsSnapshot {
  asOf: number;
  indexerHeight: number;
  tipHeight: number;
  /** Rows the registry served that failed a check and are not published. */
  excludedCount: number;
  byName: ReadonlyMap<string, ZnsRegistration>;
  /** Each name's history, newest first; events whose transaction is not on our chain are left out. */
  historyByName: ReadonlyMap<string, readonly ZnsNameEvent[]>;
}

const LAST_ACTIONS: readonly ZnsLastAction[] = ["CLAIM", "UPDATE", "BUY", "DELIST", "RELEASE"];

function resultOf(body: unknown): unknown {
  if (typeof body !== "object" || body === null) return undefined;
  const envelope = body as { result?: unknown; error?: unknown };
  return envelope.error === undefined ? envelope.result : undefined;
}

const isCount = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;

export function parseZnsStatus(body: unknown): ZnsStatus | null {
  const r = resultOf(body) as Record<string, unknown> | undefined;
  if (
    !r ||
    !isCount(r.synced_height) ||
    typeof r.uivk !== "string" ||
    typeof r.admin_pubkey !== "string" ||
    !isCount(r.registered)
  ) {
    return null;
  }
  return {
    syncedHeight: r.synced_height,
    uivk: r.uivk,
    adminPubkey: r.admin_pubkey,
    registered: r.registered,
  };
}

/**
 * One registry page. Malformed rows are dropped (and counted by the caller, which compares the page
 * length) rather than failing the page, so one bad row cannot hide every other name. A malformed
 * envelope is null: that is a broken response.
 */
export function parseZnsRegistrations(
  body: unknown,
): { rows: ZnsRawRegistration[]; served: number } | null {
  const result = resultOf(body);
  if (!Array.isArray(result)) return null;
  const rows: ZnsRawRegistration[] = [];
  for (const raw of result) {
    if (typeof raw !== "object" || raw === null) continue;
    const r = raw as Record<string, unknown>;
    if (
      typeof r.name !== "string" ||
      typeof r.address !== "string" ||
      typeof r.txid !== "string" ||
      !/^[0-9a-f]{64}$/.test(r.txid) ||
      !isCount(r.height) ||
      !isCount(r.nonce) ||
      !LAST_ACTIONS.includes(r.last_action as ZnsLastAction) ||
      (r.signature !== null && typeof r.signature !== "string")
    ) {
      continue;
    }
    rows.push({
      name: r.name,
      address: r.address,
      txid: r.txid,
      height: r.height,
      lastAction: r.last_action as ZnsLastAction,
      nonce: r.nonce,
      signature: r.signature as string | null,
      listingPriceZat: listingPrice(r.listing),
    });
  }
  return { rows, served: result.length };
}

function listingPrice(listing: unknown): number | null {
  if (typeof listing !== "object" || listing === null) return null;
  const price = (listing as { price?: unknown }).price;
  return isCount(price) ? price : null;
}

const EVENT_ACTIONS: readonly ZnsEventAction[] = [
  "CLAIM",
  "UPDATE",
  "BUY",
  "LIST",
  "SETPRICE",
  "DELIST",
  "RELEASE",
];

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
    if (
      !isCount(e.id) ||
      typeof e.name !== "string" ||
      !EVENT_ACTIONS.includes(e.action as ZnsEventAction) ||
      typeof e.txid !== "string" ||
      !/^[0-9a-f]{64}$/.test(e.txid) ||
      !isCount(e.height) ||
      (e.ua !== null && typeof e.ua !== "string") ||
      (e.price !== null && !isCount(e.price))
    ) {
      continue;
    }
    events.push({
      id: e.id,
      name: e.name,
      action: e.action as ZnsEventAction,
      txid: e.txid,
      height: e.height,
      address: e.ua as string | null,
      priceZat: e.price as number | null,
    });
  }
  return { events, served: result.events.length, total: result.total };
}

export function znsAdminKey(base64: string): KeyObject {
  const raw = Buffer.from(base64, "base64");
  if (raw.length !== 32) throw new Error("ZNS admin key is not a 32-byte Ed25519 key");
  return createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, raw]),
    format: "der",
    type: "spki",
  });
}

/**
 * The messages a row's signature may cover, as the registry actually signs them:
 *
 * - `CLAIM:{name}:{address}`.
 * - `BUY:{name}:{address}`, with the buyer's address.
 * - `UPDATE:{name}:{address}:{k}`, where `k` is the nonce at the time of the update, which a later
 *   LIST or DELIST moves on. The registry does not report `k`, so every value up to the current
 *   nonce is tried; each candidate still binds this name to this address, so a match states nothing
 *   the row does not.
 *
 * DELIST and RELEASE sign no address, so a row resting on one cannot be bound to the address it
 * reports and yields no candidates: it is excluded, not trusted.
 */
export function registrationPreimages(r: ZnsRawRegistration): string[] {
  switch (r.lastAction) {
    case "CLAIM":
      return [`CLAIM:${r.name}:${r.address}`];
    case "BUY":
      return [`BUY:${r.name}:${r.address}`];
    case "UPDATE":
      return Array.from({ length: r.nonce + 1 }, (_, k) => `UPDATE:${r.name}:${r.address}:${k}`);
    case "DELIST":
    case "RELEASE":
      return [];
  }
}

export function verifyRegistration(r: ZnsRawRegistration, key: KeyObject): boolean {
  if (r.signature === null) return false;
  const signature = Buffer.from(r.signature, "base64");
  if (signature.length !== 64) return false;
  return registrationPreimages(r).some((m) => verify(null, Buffer.from(m), key, signature));
}

export interface ZnsTrackerDeps {
  url: string;
  pinnedUivk: string;
  pinnedAdminPubkey: string;
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
  readonly #key: KeyObject;

  constructor(private readonly deps: ZnsTrackerDeps) {
    // Thrown at construction: a malformed pinned key is a deploy error, not a runtime state.
    this.#key = znsAdminKey(deps.pinnedAdminPubkey);
  }

  current(): ZnsSnapshot | null {
    return this.#snapshot;
  }

  /**
   * A forward lookup, name to registration; null while no snapshot has been taken (and for a string
   * that cannot be a name, which the route refuses before asking).
   *
   * There is no reverse lookup. A CLAIM does not prove control of the address it names (the
   * registry requires that proof only for update, list, delist and release), so a name found by
   * address may have been pointed there by a stranger, and listing it would let anyone label
   * anyone's address.
   */
  lookupName(raw: string): ZnsLookup | null {
    const name = parseZnsName(raw);
    if (name === null) return null;
    return this.#answer(name);
  }

  #answer(name: string): ZnsLookup | null {
    const s = this.#snapshot;
    if (s === null) return null;
    const ageSeconds = Math.floor(this.deps.now() / 1000) - s.asOf;
    const withheld =
      ageSeconds > MAX_SNAPSHOT_AGE_SECONDS || s.tipHeight - s.indexerHeight > ZNS_MAX_LAG_BLOCKS;
    const hit = withheld ? undefined : s.byName.get(name);
    return {
      query: name,
      registrations: hit ? [hit] : [],
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
    if (status.uivk !== this.deps.pinnedUivk)
      throw new IdentityError("UIVK does not match the pin");
    if (status.adminPubkey !== this.deps.pinnedAdminPubkey) {
      throw new IdentityError("admin key does not match the pin");
    }
    return status;
  }

  async #registry(): Promise<{ rows: ZnsRawRegistration[]; served: number }> {
    const rows: ZnsRawRegistration[] = [];
    let served = 0;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const parsed = parseZnsRegistrations(
        await this.#rpc("resolve", { query: "", limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
      );
      if (parsed === null) throw new Error("unrecognised registry page shape");
      rows.push(...parsed.rows);
      served += parsed.served;
      if (parsed.served < PAGE_SIZE) return { rows, served };
    }
    throw new Error(`registry exceeded ${MAX_PAGES} pages — refusing a partial snapshot`);
  }

  async #events(): Promise<ZnsRawEvent[]> {
    const events: ZnsRawEvent[] = [];
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const parsed = parseZnsEvents(
        await this.#rpc("events", { limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
      );
      if (parsed === null) throw new Error("unrecognised events page shape");
      events.push(...parsed.events);
      if (parsed.served < PAGE_SIZE || events.length >= parsed.total) return events;
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
    const registered = statuses[0]!.registered;
    const registry = registries[0]!;
    const sameRegistry = registries.every((r) => JSON.stringify(r) === JSON.stringify(registry));
    const events = eventLogs[0]!;
    const sameEvents = eventLogs.every((e) => JSON.stringify(e) === JSON.stringify(events));
    if (
      !statuses.every((s) => s.registered === registered) ||
      registry.served !== registered ||
      !sameRegistry ||
      !sameEvents
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

    const byName = new Map<string, ZnsRegistration>();
    for (const r of registry.rows) {
      if (
        parseZnsName(r.name) !== r.name ||
        nameCounts.get(r.name) !== 1 ||
        decodeUnifiedAddress(r.address)?.network !== "mainnet" ||
        onChain.get(r.txid)?.height !== r.height ||
        !verifyRegistration(r, this.#key)
      ) {
        continue;
      }
      byName.set(r.name, {
        name: r.name,
        address: r.address,
        txid: r.txid,
        height: r.height,
        timestamp: onChain.get(r.txid)!.timestamp,
        lastAction: r.lastAction,
        listingPriceZat: r.listingPriceZat,
      });
    }

    const historyByName = new Map<string, ZnsNameEvent[]>();
    const ordered = [...events].sort((a, b) => b.height - a.height || b.id - a.id);
    for (const e of ordered) {
      const block = onChain.get(e.txid);
      if (parseZnsName(e.name) !== e.name || block?.height !== e.height) continue;
      const list = historyByName.get(e.name) ?? [];
      list.push({
        action: e.action,
        txid: e.txid,
        height: e.height,
        timestamp: block.timestamp,
        address: e.address,
        priceZat: e.priceZat,
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

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
