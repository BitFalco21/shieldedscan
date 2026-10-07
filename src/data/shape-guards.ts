import { isFiniteNumber, isFiniteOrNull } from "@/lib/finite";
import type {
  Block,
  BlockSummary,
  CrossChainTransfer,
  NetCrawlHistory,
  NetGhost,
  NetHealth,
  NetHistogram,
  NetHub,
  NetMap,
  NetMapCell,
  NetNodePage,
  NetNodeRow,
  NetPeers,
  NetReleaseGroup,
  NetReleases,
  NetShare,
  NetSummary,
  NetTopology,
  PulseBlock,
  PulseBlockPools,
  PulseEvent,
  PulseLedgerRow,
  Transaction,
  ZnsNameEvent,
  ZnsRegistration,
} from "@/domain";
import {
  blockSummaryOf,
  NET_PROBE_FAILURES,
  PULSE_EVENT_KINDS,
  PULSE_SHAPES,
  VALUE_POOL_NAMES,
} from "@/domain";

/**
 * Shape checks, deliberately shallow.
 *
 * The API is ours, so this is not validation against a hostile source — it is a tripwire
 * for version skew during a deploy, which would otherwise render `undefined` into a page as
 * a blank cell rather than failing.
 *
 * Shared by both API adapters and the live feed so that tightening a guard when a domain
 * type gains a field tightens every consumer at once.
 */

export function isBlock(value: unknown): value is Block {
  if (typeof value !== "object" || value === null) return false;
  const b = value as Record<string, unknown>;
  return (
    typeof b.height === "number" &&
    typeof b.hash === "string" &&
    typeof b.timestamp === "number" &&
    Array.isArray(b.txids) &&
    // Header and coinbase-derived fields: a server predating them would otherwise render
    // `undefined` into the block page as blank cells.
    typeof b.version === "number" &&
    typeof b.merkleRoot === "string" &&
    typeof b.nonce === "string" &&
    typeof b.miner === "object" &&
    b.miner !== null &&
    Array.isArray(b.fundingStreams) &&
    typeof b.composition === "object" &&
    b.composition !== null &&
    // Nullable by design — null is "unknown", and must never arrive as 0.
    (b.totalFeeZat === null || typeof b.totalFeeZat === "number")
  );
}

/**
 * A block list row: what `/chain/blocks` sends, without the header fields only a detail
 * page shows. `txCount` is the field an API predating summaries does not send.
 */
function isBlockSummary(value: unknown): value is BlockSummary {
  if (typeof value !== "object" || value === null) return false;
  const b = value as Record<string, unknown>;
  return (
    typeof b.height === "number" &&
    typeof b.hash === "string" &&
    typeof b.timestamp === "number" &&
    typeof b.sizeBytes === "number" &&
    Number.isInteger(b.txCount) &&
    (b.txCount as number) >= 0 &&
    typeof b.miner === "object" &&
    b.miner !== null &&
    Array.isArray(b.fundingStreams) &&
    typeof b.composition === "object" &&
    b.composition !== null &&
    // Nullable by design — null is "unknown", and must never arrive as 0.
    (b.totalFeeZat === null || typeof b.totalFeeZat === "number")
  );
}

/**
 * A list row in either shape an API may send: a summary as is, a full block cut down to
 * one, or null for neither. The full-block branch covers an API one deploy behind, and is
 * exact: `blockSummaryOf` derives every field from a block that passed `isBlock`.
 */
export function blockListRow(value: unknown): BlockSummary | null {
  if (isBlockSummary(value)) return value;
  if (isBlock(value)) return blockSummaryOf(value);
  return null;
}

export function isTransaction(value: unknown): value is Transaction {
  if (typeof value !== "object" || value === null) return false;
  const t = value as Record<string, unknown>;
  return (
    typeof t.txid === "string" &&
    typeof t.timestamp === "number" &&
    typeof t.isCoinbase === "boolean" &&
    Array.isArray(t.transparentInputs) &&
    Array.isArray(t.transparentOutputs) &&
    (t.lockTime === null || typeof t.lockTime === "number") &&
    // Nullable by design — `feeZat: null` means unknown, and must never arrive as 0.
    (t.feeZat === null || typeof t.feeZat === "number") &&
    (t.blockHeight === null || typeof t.blockHeight === "number") &&
    (t.blockHash === null || typeof t.blockHash === "string") &&
    // Null on every list path by design; a string only from the single-transaction path.
    (t.rawHex === null || typeof t.rawHex === "string") &&
    /*
     * `ironwood` must be present — `null` or a bundle, never absent. An API predating the
     * field omits the key, and `txPools` asks `tx.ironwood !== null`, which `undefined`
     * satisfies: every transaction would be badged IRONWOOD. A wrong badge reads as fact where
     * a blank reads as missing, so the skew must fail here; the fix is deploying the API, not
     * loosening this check.
     */
    "ironwood" in t &&
    (t.ironwood === null || typeof t.ironwood === "object")
  );
}

/**
 * A defensive shape check. The API is ours, but a version skew during a deploy should
 * fail loudly here rather than render `undefined` into the page.
 */
export function isTransfer(value: unknown): value is CrossChainTransfer {
  if (typeof value !== "object" || value === null) return false;
  const t = value as Record<string, unknown>;
  return (
    typeof t.id === "string" &&
    (t.direction === "in" || t.direction === "out") &&
    typeof t.protocol === "string" &&
    typeof t.counterpartChain === "string" &&
    typeof t.zecAmountZat === "number" &&
    typeof t.timestamp === "number" &&
    // Present-and-nullable, so an absent key fails here rather than silently becoming a
    // missing venue link. The fix for a failure is deploying the API, not relaxing this line.
    (t.venueDepositAddress === null || typeof t.venueDepositAddress === "string")
  );
}

/**
 * The two closed sets, from the domain's own arrays rather than retyped here: a second list
 * would let a new kind compile everywhere and then be silently dropped by
 * `.filter(isPulseEvent)`. Widened to `readonly string[]` only so `includes` accepts any
 * string.
 */
const KINDS: readonly string[] = PULSE_EVENT_KINDS;
const SHAPES: readonly string[] = PULSE_SHAPES;

function isPulseLeg(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const l = value as Record<string, unknown>;
  // The ends are checked as non-empty strings, not against a list: `PulseEnd` includes
  // `chain:${string}`, an open set — venues list new chains without notice.
  return (
    typeof l.from === "string" &&
    l.from !== "" &&
    typeof l.to === "string" &&
    l.to !== "" &&
    isFiniteOrNull(l.amountZat)
  );
}

/**
 * One movement, checked at the boundary.
 *
 * Stricter than the other guards: here a non-number amount is drawn as a mark sized on
 * `NaN`, stating that something moved. So every amount must be finite, and `null` is
 * accepted only where the domain means it: the Veil, and a Sprout leg this view does not
 * carry.
 *
 * `subsidyZat` is required-and-nullable while `feeZat` is optional, following the domain
 * type: a coinbase always states its subsidy (absence would be an older API, and reading it
 * as "no subsidy" would claim the coinbase issued nothing), while a swap has no fee.
 */
export function isPulseEvent(value: unknown): value is PulseEvent {
  if (typeof value !== "object" || value === null) return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e.id === "string" &&
    typeof e.kind === "string" &&
    KINDS.includes(e.kind) &&
    typeof e.shape === "string" &&
    SHAPES.includes(e.shape) &&
    isFiniteNumber(e.at) &&
    isFiniteOrNull(e.height) &&
    (e.blockHash === null || typeof e.blockHash === "string") &&
    Array.isArray(e.legs) &&
    e.legs.every(isPulseLeg) &&
    "subsidyZat" in e &&
    isFiniteOrNull(e.subsidyZat) &&
    (e.feeZat === undefined || isFiniteOrNull(e.feeZat))
  );
}

/**
 * The six closes at one height.
 *
 * Every value pool must be present, `null` or a number. A null is a measurement gap drawn
 * as an outlined `unavailable` box; an absent key is an API that does not know the pool
 * exists, which would draw five pools as though they were six. The list comes from
 * `VALUE_POOL_NAMES`.
 */
export function isPulseBlockPools(value: unknown): value is PulseBlockPools {
  if (typeof value !== "object" || value === null) return false;
  const p = value as Record<string, unknown>;
  if (typeof p.pools !== "object" || p.pools === null) return false;
  const balances = p.pools as Record<string, unknown>;
  return (
    isFiniteNumber(p.height) &&
    typeof p.hash === "string" &&
    typeof p.prevHash === "string" &&
    isFiniteNumber(p.timestamp) &&
    isFiniteOrNull(p.receivedAt) &&
    VALUE_POOL_NAMES.every((pool) => pool in balances && isFiniteOrNull(balances[pool]))
  );
}

/**
 * One block of a frame or a replay hour.
 *
 * `eventCount` is required because it is what makes a cap honest: `events` is a window onto
 * the count, and without it a truncated block would present itself as whole.
 * `intervalSeconds` is required-and-nullable: a recorded gap and a field the API has never
 * heard of are different facts.
 */
export function isPulseBlock(value: unknown): value is PulseBlock {
  if (typeof value !== "object" || value === null) return false;
  const b = value as Record<string, unknown>;
  return (
    isPulseBlockPools(b.pools) &&
    Array.isArray(b.events) &&
    b.events.every(isPulseEvent) &&
    isFiniteNumber(b.eventCount) &&
    "intervalSeconds" in b &&
    isFiniteOrNull(b.intervalSeconds)
  );
}

/**
 * One transparent output in the ledger box. Checked whole because the row elides the
 * address for display and keeps the full string in `title` and the copy control; a missing
 * address would copy an empty string with no visible symptom.
 */
export function isPulseLedgerRow(value: unknown): value is PulseLedgerRow {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.txid === "string" &&
    typeof r.blockHash === "string" &&
    typeof r.address === "string" &&
    isFiniteNumber(r.height) &&
    isFiniteNumber(r.valueZat)
  );
}

/*
 * The node map (`/chain/network/*`).
 *
 * Same shallow tripwire standard as above, plus one check that is not about version skew:
 * `assertNoAddressLiterals`. The crawler's tables hold full node addresses and the routes
 * publish derived facts only; the server tests assert that, and this is an independent
 * second layer at the boundary the page reads from. It throws rather than scrubbing, so a
 * route regression cannot be hidden.
 */

const IPV4_LITERAL = /\b\d{1,3}(?:\.\d{1,3}){3}\b/;
/**
 * A run of hex groups joined by at least two colons, compressed (`2001:db8::7`) or not,
 * that carries a hex letter, a `::`, or the full eight groups. A `host:port`, a clock
 * reading (`12:30:45`) and a bare number do not match; every real IPv6 address does.
 */
const IPV6_LITERAL =
  /(?<![0-9a-z:])(?=[0-9a-f:]*(?:::|[a-f]|(?:[0-9a-f]*:){7}))[0-9a-f]*(?::[0-9a-f]*){2,7}(?![0-9a-z:])/i;
const ONION_LITERAL = /\.onion\b/i;

/**
 * Walks a payload and throws on the first string shaped like an address. `skipKeys` names
 * fields whose values are known not to be addresses but could look like one — a client
 * version string is the only such field today.
 */
export function assertNoAddressLiterals(
  value: unknown,
  options: { skipKeys?: readonly string[]; label?: string } = {},
  path = "$",
): void {
  const skip = options.skipKeys ?? [];
  if (typeof value === "string") {
    if (IPV4_LITERAL.test(value) || IPV6_LITERAL.test(value) || ONION_LITERAL.test(value)) {
      throw new Error(
        `chain API ${options.label ?? "network"} payload carries an address-shaped string at ${path}`,
      );
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoAddressLiterals(v, options, `${path}[${i}]`));
    return;
  }
  if (typeof value === "object" && value !== null) {
    for (const [k, v] of Object.entries(value)) {
      if (skip.includes(k)) continue;
      assertNoAddressLiterals(v, options, `${path}.${k}`);
    }
  }
}

function isNetShare(value: unknown): value is NetShare {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Record<string, unknown>;
  return isFiniteNumber(s.pct) && isFiniteNumber(s.numerator) && isFiniteNumber(s.denominator);
}

function stringOrNull(value: unknown): boolean {
  return value === null || typeof value === "string";
}

function isNetReleaseGroup(value: unknown): value is NetReleaseGroup {
  if (typeof value !== "object" || value === null) return false;
  const g = value as Record<string, unknown>;
  return (
    typeof g.client === "string" &&
    stringOrNull(g.version) &&
    isFiniteOrNull(g.protocolVersion) &&
    isFiniteNumber(g.nodes) &&
    isFiniteNumber(g.behindTip) &&
    isFiniteNumber(g.tipUnknown)
  );
}

/**
 * The releases payload. Requires the groups to sum to `answering`: a page printing "N of M"
 * from two disagreeing figures is a defect a type cannot catch.
 */
export function isNetReleases(value: unknown): value is NetReleases {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    r.basis === "floor" &&
    isFiniteNumber(r.windowSeconds) &&
    isFiniteNumber(r.answering) &&
    isFiniteNumber(r.behindTipBlocks) &&
    Array.isArray(r.groups) &&
    r.groups.every(isNetReleaseGroup) &&
    (r.groups as NetReleaseGroup[]).reduce((s, g) => s + g.nodes, 0) === r.answering &&
    Array.isArray(r.history) &&
    r.history.every((d: unknown) => {
      if (typeof d !== "object" || d === null) return false;
      const day = d as Record<string, unknown>;
      return (
        typeof day.day === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(day.day) &&
        Array.isArray(day.groups) &&
        day.groups.every(isNetReleaseGroup)
      );
    }) &&
    isFiniteNumber(r.asOf)
  );
}

export function isNetSummary(value: unknown): value is NetSummary {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Record<string, unknown>;
  return (
    s.basis === "floor" &&
    isFiniteNumber(s.reachable) &&
    isFiniteNumber(s.windowSeconds) &&
    isFiniteNumber(s.known) &&
    isFiniteNumber(s.everReachable) &&
    isFiniteNumber(s.neverAnswered) &&
    isFiniteNumber(s.ipv6Known) &&
    isFiniteNumber(s.ipv6Reachable) &&
    isFiniteNumber(s.torKnown) &&
    isFiniteNumber(s.countries) &&
    isFiniteNumber(s.asns) &&
    isNetShare(s.answeredEveryCrawl) &&
    isFiniteOrNull(s.medianPingMs) &&
    isFiniteOrNull(s.avgPingMs) &&
    typeof s.pingBasis === "string" &&
    Array.isArray(s.clients) &&
    s.clients.every((c: unknown) => {
      if (typeof c !== "object" || c === null) return false;
      const r = c as Record<string, unknown>;
      return typeof r.client === "string" && isNetShare(r) && isNetShare(r.answerRate);
    }) &&
    Array.isArray(s.versions) &&
    Array.isArray(s.protocolVersions) &&
    typeof s.crawls === "object" &&
    s.crawls !== null &&
    isFiniteNumber((s.crawls as Record<string, unknown>).count) &&
    isFiniteNumber(s.asOf)
  );
}

function isNetMapCell(value: unknown): value is NetMapCell {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;
  return (
    isFiniteNumber(c.lat) &&
    isFiniteNumber(c.lon) &&
    isFiniteNumber(c.nodes) &&
    stringOrNull(c.city) &&
    stringOrNull(c.country) &&
    Array.isArray(c.clients) &&
    Array.isArray(c.asns) &&
    isFiniteOrNull(c.medianPingMs) &&
    (c.uptime === null || isNetShare(c.uptime))
  );
}

export function isNetMap(value: unknown): value is NetMap {
  if (typeof value !== "object" || value === null) return false;
  const m = value as Record<string, unknown>;
  return (
    m.basis === "floor" &&
    typeof m.note === "string" &&
    isFiniteNumber(m.cellDegrees) &&
    Array.isArray(m.cells) &&
    m.cells.every(isNetMapCell) &&
    Array.isArray(m.ghostCells) &&
    m.ghostCells.every(
      (g: unknown) =>
        typeof g === "object" &&
        g !== null &&
        isFiniteNumber((g as Record<string, unknown>).lat) &&
        isFiniteNumber((g as Record<string, unknown>).lon) &&
        isFiniteNumber((g as Record<string, unknown>).count),
    ) &&
    isFiniteNumber(m.ghostTotal) &&
    isFiniteNumber(m.unplaced) &&
    Array.isArray(m.countries) &&
    isFiniteNumber(m.asOf)
  );
}

function isNetHub(value: unknown): value is NetHub {
  if (typeof value !== "object" || value === null) return false;
  const h = value as Record<string, unknown>;
  return (
    typeof h.id === "string" &&
    typeof h.client === "string" &&
    stringOrNull(h.version) &&
    stringOrNull(h.country) &&
    stringOrNull(h.asnOrg) &&
    isFiniteNumber(h.outDeg) &&
    isFiniteNumber(h.inDeg)
  );
}

const FAILURES: readonly string[] = NET_PROBE_FAILURES;

function isNetGhost(value: unknown): value is NetGhost {
  if (typeof value !== "object" || value === null) return false;
  const g = value as Record<string, unknown>;
  return (
    typeof g.id === "string" &&
    (g.network === "ipv4" || g.network === "ipv6" || g.network === "torv3") &&
    typeof g.torExit === "boolean" &&
    stringOrNull(g.country) &&
    (g.failure === null || (typeof g.failure === "string" && FAILURES.includes(g.failure))) &&
    Array.isArray(g.by) &&
    g.by.every((i: unknown) => isFiniteNumber(i))
  );
}

/**
 * The gossip graph. Ghosts are required when `scope` is `all` and must be absent otherwise:
 * a hubs-only graph is well-formed, so the scope echo is what tells a sky drawn from the
 * wrong payload apart.
 */
export function isNetTopology(value: unknown): value is NetTopology {
  if (typeof value !== "object" || value === null) return false;
  const t = value as Record<string, unknown>;
  const base =
    typeof t.note === "string" &&
    (t.scope === "hubs" || t.scope === "all") &&
    Array.isArray(t.hubs) &&
    t.hubs.every(isNetHub) &&
    Array.isArray(t.hubEdges) &&
    t.hubEdges.every(
      (e: unknown) => Array.isArray(e) && e.length === 2 && e.every((i) => isFiniteNumber(i)),
    ) &&
    isFiniteNumber(t.edgesTotal) &&
    isFiniteNumber(t.asOf);
  if (!base) return false;
  if (t.scope === "hubs") return t.ghosts === undefined;
  return (
    Array.isArray(t.ghosts) &&
    t.ghosts.every(isNetGhost) &&
    isFiniteNumber(t.ghostsTotal) &&
    isFiniteNumber(t.ghostEdgesDrawn)
  );
}

function isNetHistogram(value: unknown): value is NetHistogram {
  if (typeof value !== "object" || value === null) return false;
  const h = value as Record<string, unknown>;
  return (
    Array.isArray(h.buckets) &&
    h.buckets.every(
      (b: unknown) =>
        typeof b === "object" &&
        b !== null &&
        typeof (b as Record<string, unknown>).label === "string" &&
        isFiniteNumber((b as Record<string, unknown>).from) &&
        isFiniteOrNull((b as Record<string, unknown>).to) &&
        isFiniteNumber((b as Record<string, unknown>).count),
    ) &&
    isFiniteNumber(h.denominator)
  );
}

export function isNetHealth(value: unknown): value is NetHealth {
  if (typeof value !== "object" || value === null) return false;
  const h = value as Record<string, unknown>;
  const c = h.concentration as Record<string, unknown> | undefined;
  const f = h.facts as Record<string, unknown> | undefined;
  return (
    h.basis === "floor" &&
    typeof h.pingBasis === "string" &&
    isNetHistogram(h.latency) &&
    isNetHistogram(h.uptime) &&
    typeof c === "object" &&
    c !== null &&
    typeof c.note === "string" &&
    Array.isArray(c.topAsns) &&
    c.topAsns.every(
      (a: unknown) =>
        typeof a === "object" &&
        a !== null &&
        typeof (a as Record<string, unknown>).org === "string" &&
        isNetShare(a),
    ) &&
    isNetShare(c.top3) &&
    Array.isArray(h.clusteredSubnets) &&
    typeof f === "object" &&
    f !== null &&
    isFiniteNumber(f.known) &&
    isFiniteNumber(f.everReachable) &&
    isFiniteNumber(f.neverAnswered) &&
    isFiniteNumber(f.torKnown) &&
    isFiniteNumber(f.ipv6Known) &&
    isFiniteNumber(f.ipv6Reachable) &&
    Array.isArray(f.failures) &&
    isFiniteNumber(f.crawls) &&
    isFiniteNumber(h.asOf)
  );
}

function isNetNodeRow(value: unknown): value is NetNodeRow {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    typeof r.client === "string" &&
    stringOrNull(r.version) &&
    isFiniteOrNull(r.protocolVersion) &&
    (r.network === "ipv4" || r.network === "ipv6" || r.network === "torv3") &&
    stringOrNull(r.country) &&
    stringOrNull(r.city) &&
    isFiniteOrNull(r.asn) &&
    stringOrNull(r.asnOrg) &&
    isFiniteOrNull(r.pingMs) &&
    isFiniteNumber(r.reached) &&
    isFiniteNumber(r.attempted) &&
    isFiniteNumber(r.firstSeen) &&
    isFiniteNumber(r.lastReachable)
  );
}

/**
 * A page of nodes. `applied` is required: an API one deploy behind would ignore `?client=`
 * and answer with every node, a well-formed page. The adapter compares the echo to what it
 * sent.
 */
export function isNetNodePage(value: unknown): value is NetNodePage {
  if (typeof value !== "object" || value === null) return false;
  const p = value as Record<string, unknown>;
  const a = p.applied as Record<string, unknown> | undefined;
  return (
    Array.isArray(p.items) &&
    p.items.every(isNetNodeRow) &&
    stringOrNull(p.nextCursor) &&
    stringOrNull(p.prevCursor) &&
    typeof a === "object" &&
    a !== null &&
    stringOrNull(a.client) &&
    isFiniteOrNull(a.asn) &&
    isFiniteNumber(p.total) &&
    isFiniteNumber(p.denominator)
  );
}

export function isNetCrawlHistory(value: unknown): value is NetCrawlHistory {
  if (typeof value !== "object" || value === null) return false;
  const h = value as Record<string, unknown>;
  return (
    Array.isArray(h.crawls) &&
    h.crawls.every(
      (c: unknown) =>
        typeof c === "object" &&
        c !== null &&
        isFiniteNumber((c as Record<string, unknown>).startedAt) &&
        isFiniteNumber((c as Record<string, unknown>).finishedAt) &&
        isFiniteNumber((c as Record<string, unknown>).attempted) &&
        isFiniteNumber((c as Record<string, unknown>).reachable) &&
        isFiniteNumber((c as Record<string, unknown>).newNodes),
    ) &&
    isFiniteNumber(h.total) &&
    isFiniteOrNull(h.firstStartedAt) &&
    typeof h.truncated === "boolean"
  );
}

export function isNetPeers(value: unknown): value is NetPeers {
  if (typeof value !== "object" || value === null) return false;
  const p = value as Record<string, unknown>;
  return (
    p.basis === "ours" &&
    isFiniteNumber(p.count) &&
    isFiniteNumber(p.inbound) &&
    isFiniteNumber(p.outbound) &&
    isFiniteOrNull(p.medianPingMs) &&
    isFiniteNumber(p.asOf)
  );
}

/**
 * One verified ZNS registration. The address is checked to be a `u1` string because a name is a
 * payment destination: a registration carrying anything else is not one this site may hand over.
 */
export function isZnsRegistration(value: unknown): value is ZnsRegistration {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.name === "string" &&
    typeof r.address === "string" &&
    r.address.startsWith("u1") &&
    typeof r.txid === "string" &&
    typeof r.height === "number" &&
    typeof r.timestamp === "number" &&
    typeof r.lastAction === "string" &&
    (r.listingPriceZat === null || typeof r.listingPriceZat === "number")
  );
}

/** One verified entry of a name's history. */
export function isZnsNameEvent(value: unknown): value is ZnsNameEvent {
  if (typeof value !== "object" || value === null) return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e.action === "string" &&
    typeof e.txid === "string" &&
    typeof e.height === "number" &&
    typeof e.timestamp === "number" &&
    (e.address === null || (typeof e.address === "string" && e.address.startsWith("u1"))) &&
    (e.priceZat === null || typeof e.priceZat === "number")
  );
}
