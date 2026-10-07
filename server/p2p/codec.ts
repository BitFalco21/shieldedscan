import { createHash } from "node:crypto";
import { printableOnly } from "@/lib/printable";

/**
 * The Zcash P2P wire codec: pure build/parse, no I/O.
 *
 * Zcash inherited Bitcoin's message framing unchanged (24-byte header: magic, command, length,
 * double-SHA256 checksum); only the network magic and the protocol-version numbers differ. This
 * module is the crawler's parse boundary: the one free-text field a stranger controls (the
 * version message's user agent) leaves this module already sanitised.
 *
 * Hand-rolled with no dependency; every constant below is re-derivable from the published wire
 * format, which the codec tests' vectors pin.
 */

export const NETWORK_MAGIC = {
  mainnet: Buffer.from([0x24, 0xe9, 0x27, 0x64]),
  testnet: Buffer.from([0xfa, 0x1a, 0xf9, 0xbf]),
} as const;

/**
 * Sanity cap on a single message's payload. The largest legitimate message a crawler receives
 * is an `addr` of 1,000 entries (~30 KB); a peer declaring more than 2 MB is hostile or broken,
 * and the reader refuses on the header so a declared length can never make it buffer gigabytes.
 */
export const MAX_PAYLOAD_BYTES = 2 * 1024 * 1024;

/** The user agent this crawler announces: honest self-identification. */
export const CRAWLER_USER_AGENT = "/shieldedscan-crawler:0.1.0/";

/** NU6.3, the protocol version the live network speaks. Announcing the current version keeps
 * up-to-date peers from refusing the handshake as obsolete. */
export const CRAWLER_PROTOCOL_VERSION = 170_160;

export class CodecError extends Error {}

export function checksum(payload: Buffer): Buffer {
  const once = createHash("sha256").update(payload).digest();
  return createHash("sha256").update(once).digest().subarray(0, 4);
}

/** Bitcoin's CompactSize. Values above 2^53 − 1 cannot round-trip a JS number and no honest
 * peer sends one, so they are refused rather than silently rounded. */
export function writeCompactSize(value: number): Buffer {
  if (!Number.isSafeInteger(value) || value < 0) throw new CodecError(`bad compact size ${value}`);
  if (value < 0xfd) return Buffer.from([value]);
  if (value <= 0xffff) {
    const b = Buffer.alloc(3, 0xfd);
    b.writeUInt16LE(value, 1);
    return b;
  }
  if (value <= 0xffffffff) {
    const b = Buffer.alloc(5, 0xfe);
    b.writeUInt32LE(value, 1);
    return b;
  }
  const b = Buffer.alloc(9, 0xff);
  b.writeBigUInt64LE(BigInt(value), 1);
  return b;
}

export function readCompactSize(buf: Buffer, at: number): { value: number; next: number } {
  const first = buf[at];
  if (first === undefined) throw new CodecError("compact size past end of buffer");
  if (first < 0xfd) return { value: first, next: at + 1 };
  const width = first === 0xfd ? 2 : first === 0xfe ? 4 : 8;
  if (at + 1 + width > buf.length) throw new CodecError("compact size truncated");
  if (width === 2) return { value: buf.readUInt16LE(at + 1), next: at + 3 };
  if (width === 4) return { value: buf.readUInt32LE(at + 1), next: at + 5 };
  const big = buf.readBigUInt64LE(at + 1);
  if (big > BigInt(Number.MAX_SAFE_INTEGER)) throw new CodecError("compact size overflows");
  return { value: Number(big), next: at + 9 };
}

export function encodeMessage(magic: Buffer, command: string, payload: Buffer): Buffer {
  const header = Buffer.alloc(24);
  magic.copy(header, 0);
  header.write(command, 4, "latin1");
  header.writeUInt32LE(payload.length, 16);
  checksum(payload).copy(header, 20);
  return Buffer.concat([header, payload]);
}

export interface WireMessage {
  command: string;
  payload: Buffer;
}

/**
 * Reassembles whole messages from a TCP stream. Push chunks in, iterate messages out.
 * Any malformed input THROWS — a peer that frames one message wrongly cannot be trusted
 * about the next, so the caller drops the connection rather than resynchronising.
 */
export class MessageReader {
  // Pieces as they arrived, joined only once a whole header or message is buffered. Joining on
  // every piece copied the whole buffer each time, so a peer dripping a large message in tiny
  // pieces cost quadratic copying.
  #chunks: Buffer[] = [];
  #length = 0;
  readonly #magic: Buffer;

  constructor(magic: Buffer) {
    this.#magic = magic;
  }

  *push(chunk: Buffer): Generator<WireMessage> {
    if (chunk.length > 0) {
      this.#chunks.push(chunk);
      this.#length += chunk.length;
    }
    for (;;) {
      if (this.#length < 24) return;
      this.#joinFirst(24);
      const head = this.#chunks[0]!;
      if (!head.subarray(0, 4).equals(this.#magic)) {
        throw new CodecError("wrong network magic");
      }
      const length = head.readUInt32LE(16);
      if (length > MAX_PAYLOAD_BYTES) throw new CodecError(`payload of ${length} bytes refused`);
      if (this.#length < 24 + length) return;
      this.#joinFirst(24 + length);
      const buffer = this.#chunks[0]!;
      const payload = buffer.subarray(24, 24 + length);
      if (!checksum(payload).equals(buffer.subarray(20, 24))) {
        throw new CodecError("bad checksum");
      }
      // The command is 12 bytes, NUL-padded ASCII.
      const command = buffer.subarray(4, 16).toString("latin1").replace(/\0+$/, "");
      const rest = buffer.subarray(24 + length);
      if (rest.length > 0) this.#chunks[0] = rest;
      else this.#chunks.shift();
      this.#length -= 24 + length;
      yield { command, payload: Buffer.from(payload) };
    }
  }

  /** Makes the first buffered piece at least `bytes` long by joining the pieces after it. */
  #joinFirst(bytes: number): void {
    if (this.#chunks[0]!.length >= bytes) return;
    let count = 0;
    let size = 0;
    while (size < bytes) {
      size += this.#chunks[count]!.length;
      count += 1;
    }
    this.#chunks.splice(0, count, Buffer.concat(this.#chunks.slice(0, count), size));
  }
}

export interface VersionFields {
  protocolVersion: number;
  services: bigint;
  timestampSec: number;
  nonce: Buffer;
  userAgent: string;
  startHeight: number;
}

/** A 26-byte network address as embedded in a `version` message (no timestamp). Zeroed:
 * a crawler advertises nothing and claims no address for its peer. */
const EMPTY_NET_ADDR = Buffer.alloc(26);

export function buildVersion(fields: VersionFields): Buffer {
  const ua = Buffer.from(fields.userAgent, "utf8");
  const head = Buffer.alloc(20);
  head.writeInt32LE(fields.protocolVersion, 0);
  head.writeBigUInt64LE(fields.services, 4);
  head.writeBigInt64LE(BigInt(fields.timestampSec), 12);
  return Buffer.concat([
    head,
    EMPTY_NET_ADDR, // addr_recv
    EMPTY_NET_ADDR, // addr_from
    fields.nonce.subarray(0, 8),
    writeCompactSize(ua.length),
    ua,
    (() => {
      const h = Buffer.alloc(4);
      h.writeInt32LE(fields.startHeight, 0);
      return h;
    })(),
    Buffer.from([0]), // relay = false: we want no transaction inventory, only addresses
  ]);
}

export interface ParsedVersion {
  protocolVersion: number;
  services: bigint;
  timestampSec: number;
  /** Sanitised at this boundary: whitespace collapsed first (`printableOnly` drops a newline,
   * which would join two words the peer never wrote), then control characters stripped and the
   * length capped. A runaway bound, not the display grain: real user agents run ~30 characters. */
  userAgent: string;
  startHeight: number;
}

const MAX_USER_AGENT_CHARS = 128;

function sanitizeUserAgent(raw: string): string {
  const collapsed = raw.replace(/\s+/g, " ").trim();
  return printableOnly(collapsed).slice(0, MAX_USER_AGENT_CHARS);
}

export function parseVersion(payload: Buffer): ParsedVersion {
  // version(4) services(8) timestamp(8) addr_recv(26) addr_from(26) nonce(8) = 80 bytes
  // before the user agent. A payload shorter than that is not a version message.
  if (payload.length < 80 + 1 + 4) throw new CodecError("version payload truncated");
  const protocolVersion = payload.readInt32LE(0);
  const services = payload.readBigUInt64LE(4);
  const timestampSec = Number(payload.readBigInt64LE(12));
  const ua = readCompactSize(payload, 80);
  const uaEnd = ua.next + ua.value;
  if (uaEnd + 4 > payload.length) throw new CodecError("version payload truncated");
  const userAgent = sanitizeUserAgent(payload.subarray(ua.next, uaEnd).toString("utf8"));
  const startHeight = payload.readInt32LE(uaEnd);
  return { protocolVersion, services, timestampSec, userAgent, startHeight };
}

export const buildVerack = (magic: Buffer): Buffer =>
  encodeMessage(magic, "verack", Buffer.alloc(0));
export const buildGetaddr = (magic: Buffer): Buffer =>
  encodeMessage(magic, "getaddr", Buffer.alloc(0));
/** Asks the peer to gossip addrv2 (BIP 155), the only form that can carry a Tor v3 address. The
 * crawler sends it after verack (see `probePeer`); a peer that ignores it answers with legacy addr. */
export const buildSendAddrV2 = (magic: Buffer): Buffer =>
  encodeMessage(magic, "sendaddrv2", Buffer.alloc(0));
/** Peers ping mid-getaddr and drop the connection unanswered, so the crawler must pong. */
export const buildPong = (magic: Buffer, pingPayload: Buffer): Buffer =>
  encodeMessage(magic, "pong", pingPayload);

export type PeerNetwork = "ipv4" | "ipv6" | "torv3";

export interface AddrEntry {
  timestampSec: number;
  services: bigint;
  network: PeerNetwork;
  host: string;
  port: number;
}

/** RFC 4648 base32, lowercase, unpadded — the alphabet .onion addresses use. */
export function base32NoPad(bytes: Buffer): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  let out = "";
  let bits = 0;
  let acc = 0;
  for (const byte of bytes) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(acc >>> (bits - 5)) & 31]!;
      bits -= 5;
    }
  }
  if (bits > 0) out += alphabet[(acc << (5 - bits)) & 31]!;
  return out;
}

/**
 * A Tor v3 onion address from its 32-byte ed25519 public key, per the Tor rendezvous spec:
 * base32(pubkey || checksum || version) + ".onion", where checksum is the first two bytes of
 * SHA3-256(".onion checksum" || pubkey || version) and version is 0x03.
 */
export function onionV3Address(pubkey: Buffer): string {
  const version = Buffer.from([3]);
  const digest = createHash("sha3-256")
    .update(Buffer.concat([Buffer.from(".onion checksum", "ascii"), pubkey, version]))
    .digest();
  return `${base32NoPad(Buffer.concat([pubkey, digest.subarray(0, 2), version]))}.onion`;
}

/** A 16-byte wire IP: IPv4-mapped (::ffff:a.b.c.d) renders as the dotted quad, anything
 * else as canonical-enough IPv6 (lowercase hex groups, longest zero run compressed). */
function formatWireIp(bytes: Buffer): { network: "ipv4" | "ipv6"; host: string } {
  const V4_PREFIX = Buffer.from("00000000000000000000ffff", "hex");
  if (bytes.subarray(0, 12).equals(V4_PREFIX)) {
    return { network: "ipv4", host: [...bytes.subarray(12)].join(".") };
  }
  const groups: string[] = [];
  for (let i = 0; i < 16; i += 2) groups.push(bytes.readUInt16BE(i).toString(16));
  // Compress the longest run of zero groups, as inet_ntop does.
  let bestStart = -1;
  let bestLen = 0;
  for (let i = 0; i < groups.length;) {
    if (groups[i] !== "0") {
      i += 1;
      continue;
    }
    let j = i;
    while (j < groups.length && groups[j] === "0") j += 1;
    if (j - i > bestLen) {
      bestLen = j - i;
      bestStart = i;
    }
    i = j;
  }
  if (bestLen < 2) return { network: "ipv6", host: groups.join(":") };
  const head = groups.slice(0, bestStart).join(":");
  const tail = groups.slice(bestStart + bestLen).join(":");
  return { network: "ipv6", host: `${head}::${tail}` };
}

/** Legacy `addr`: count, then 30-byte entries (time, services, 16-byte IP, big-endian port). */
export function parseAddr(payload: Buffer): AddrEntry[] {
  const count = readCompactSize(payload, 0);
  if (count.next + count.value * 30 !== payload.length) {
    throw new CodecError("addr count disagrees with payload length");
  }
  const entries: AddrEntry[] = [];
  for (let i = 0; i < count.value; i += 1) {
    const at = count.next + i * 30;
    const ip = formatWireIp(payload.subarray(at + 12, at + 28));
    entries.push({
      timestampSec: payload.readUInt32LE(at),
      services: payload.readBigUInt64LE(at + 4),
      network: ip.network,
      host: ip.host,
      port: payload.readUInt16BE(at + 28),
    });
  }
  return entries;
}

/** BIP 155 network ids this crawler understands. i2p and cjdns entries are counted as
 * skipped rather than dropped silently. */
const ADDRV2_LENGTHS: Record<number, { network: PeerNetwork; length: number }> = {
  1: { network: "ipv4", length: 4 },
  2: { network: "ipv6", length: 16 },
  4: { network: "torv3", length: 32 },
};

export function parseAddrV2(payload: Buffer): { entries: AddrEntry[]; skipped: number } {
  const count = readCompactSize(payload, 0);
  const entries: AddrEntry[] = [];
  let skipped = 0;
  let at = count.next;
  for (let i = 0; i < count.value; i += 1) {
    if (at + 4 > payload.length) throw new CodecError("addrv2 truncated");
    const timestampSec = payload.readUInt32LE(at);
    const services = readCompactSize(payload, at + 4);
    const networkId = payload[services.next];
    if (networkId === undefined) throw new CodecError("addrv2 truncated");
    const addrLen = readCompactSize(payload, services.next + 1);
    const addrEnd = addrLen.next + addrLen.value;
    if (addrEnd + 2 > payload.length) throw new CodecError("addrv2 truncated");
    const known = ADDRV2_LENGTHS[networkId];
    if (known) {
      if (addrLen.value !== known.length) {
        throw new CodecError(`addrv2 network ${networkId} with ${addrLen.value} address bytes`);
      }
      const addr = payload.subarray(addrLen.next, addrEnd);
      const port = payload.readUInt16BE(addrEnd);
      // An IPv6 slot can carry an IPv4-mapped address; take the family from the bytes, so the
      // routability check applies the IPv4 rules to it.
      const wire = known.network === "ipv6" ? formatWireIp(addr) : null;
      const host =
        known.network === "ipv4"
          ? [...addr].join(".")
          : wire !== null
            ? wire.host
            : onionV3Address(addr);
      entries.push({
        timestampSec,
        services: BigInt(services.value),
        network: wire?.network ?? known.network,
        host,
        port,
      });
    } else {
      skipped += 1;
    }
    at = addrEnd + 2;
  }
  if (at !== payload.length) throw new CodecError("addrv2 count disagrees with payload length");
  return { entries, skipped };
}
