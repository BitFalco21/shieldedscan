import { bytesToHex } from "./encoding/hex";
import { base58checkEncode } from "./encoding/base58check";
import { bech32Decode, bech32Encode, convertBits } from "./encoding/bech32";
import {
  F4JUMBLE_MAX_LENGTH,
  F4JUMBLE_MIN_LENGTH,
  f4jumble,
  f4jumbleInverse,
} from "./encoding/f4jumble";

/**
 * Unified address (ZIP 316, revision 0) receiver decoding.
 *
 * This is decoding, not decryption: a `u1…` string is a Bech32m + F4Jumble encoding of its
 * receivers' TLV, invertible by anyone with no key and no chain data. It reveals which
 * receivers the address publishes and nothing about balances, history, or which receiver a
 * payment used.
 *
 * Every official vector from zcash-hackworks/zcash-test-vectors must pass, and every decode
 * must round-trip: the parsed items re-encoded through F4Jumble + Bech32m must reproduce the
 * input byte for byte, or the decoder returns null rather than a possibly wrong answer.
 *
 * Revision 2 (`zu`/`tu` HRPs) is a draft and out of scope: those HRPs decode to null. Supporting
 * it means adding the HRPs and the MUST-understand metadata typecodes (0xE0–0xFC), which
 * revision 0 rejects.
 */

export interface UnifiedAddressComponents {
  network: "mainnet" | "testnet";
  /** In the address's own (strictly ascending typecode) order. */
  receivers: UnifiedReceiver[];
}

export type UnifiedReceiver =
  /**
   * Orchard has no standalone address format, so the receiver is carried as raw bytes in hex.
   * Never present it as an address: hex pasted into a wallet fails.
   */
  | { kind: "orchard"; receiverHex: string }
  | { kind: "sapling"; address: string }
  | { kind: "p2pkh" | "p2sh"; address: string }
  | { kind: "unknown"; typecode: number };

const HRP_BY_NETWORK = { mainnet: "u", testnet: "utest" } as const;

const TYPECODE_P2PKH = 0x00;
const TYPECODE_P2SH = 0x01;
const TYPECODE_SAPLING = 0x02;
const TYPECODE_ORCHARD = 0x03;
/** Revision-0 addresses must not carry MUST-understand metadata (0xE0–0xFC). */
const MUST_UNDERSTAND_MIN = 0xe0;
const MUST_UNDERSTAND_MAX = 0xfc;
/** ZIP 316: any typecode above this is invalid everywhere. */
const TYPECODE_CEILING = 0x02000000;

/** Standalone-form prefixes/HRPs per network, for re-encoding receivers. */
const STANDALONE = {
  mainnet: { p2pkh: [0x1c, 0xb8], p2sh: [0x1c, 0xbd], saplingHrp: "zs" },
  testnet: { p2pkh: [0x1d, 0x25], p2sh: [0x1c, 0xba], saplingHrp: "ztestsapling" },
} as const;

interface RawItem {
  typecode: number;
  bytes: Uint8Array;
}

/** Bitcoin-style compactSize. Returns null on truncation or a non-minimal encoding. */
function readCompactSize(
  bytes: Uint8Array,
  offset: number,
): { value: number; next: number } | null {
  const first = bytes[offset];
  if (first === undefined) return null;
  if (first < 0xfd) return { value: first, next: offset + 1 };
  const width = first === 0xfd ? 2 : first === 0xfe ? 4 : 8;
  if (offset + 1 + width > bytes.length) return null;
  let value = 0;
  for (let i = width - 1; i >= 0; i--) value = value * 256 + bytes[offset + 1 + i]!;
  // Minimal-encoding check; 8-byte values are beyond the typecode ceiling anyway.
  const minimal =
    (width === 2 && value >= 0xfd) ||
    (width === 4 && value > 0xffff) ||
    (width === 8 && value > 0xffffffff);
  if (!minimal || !Number.isSafeInteger(value)) return null;
  return { value, next: offset + 1 + width };
}

function writeCompactSize(value: number): number[] {
  if (value < 0xfd) return [value];
  if (value <= 0xffff) return [0xfd, value & 0xff, value >> 8];
  return [0xfe, value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >> 24) & 0xff];
}

function requiredLength(typecode: number): number | null {
  switch (typecode) {
    case TYPECODE_P2PKH:
    case TYPECODE_P2SH:
      return 20;
    case TYPECODE_SAPLING:
    case TYPECODE_ORCHARD:
      return 43;
    default:
      return null;
  }
}

function parseItems(payload: Uint8Array): RawItem[] | null {
  const items: RawItem[] = [];
  let offset = 0;
  let previousTypecode = -1;
  while (offset < payload.length) {
    const typecode = readCompactSize(payload, offset);
    if (!typecode) return null;
    const length = readCompactSize(payload, typecode.next);
    if (!length) return null;
    const end = length.next + length.value;
    if (end > payload.length) return null;
    // Strictly ascending covers the no-duplicates rule too.
    if (typecode.value <= previousTypecode) return null;
    if (typecode.value >= TYPECODE_CEILING) return null;
    if (typecode.value >= MUST_UNDERSTAND_MIN && typecode.value <= MUST_UNDERSTAND_MAX) {
      return null;
    }
    const expected = requiredLength(typecode.value);
    if (expected !== null && length.value !== expected) return null;
    items.push({ typecode: typecode.value, bytes: payload.slice(length.next, end) });
    previousTypecode = typecode.value;
    offset = end;
  }
  if (items.length === 0) return null;
  // Revision 0: at least one shielded receiver, and never both transparent forms.
  const typecodes = new Set(items.map((item) => item.typecode));
  if (!typecodes.has(TYPECODE_SAPLING) && !typecodes.has(TYPECODE_ORCHARD)) return null;
  if (typecodes.has(TYPECODE_P2PKH) && typecodes.has(TYPECODE_P2SH)) return null;
  return items;
}

/** The exact forward pipeline, for the round-trip guard. */
function encodeUnified(hrp: string, items: RawItem[]): string | null {
  const tlv: number[] = [];
  for (const item of items) {
    tlv.push(...writeCompactSize(item.typecode), ...writeCompactSize(item.bytes.length));
    for (const byte of item.bytes) tlv.push(byte);
  }
  const padding = new Uint8Array(16);
  for (let i = 0; i < hrp.length; i++) padding[i] = hrp.charCodeAt(i);
  const message = Uint8Array.from([...tlv, ...padding]);
  const jumbled = f4jumble(message);
  if (!jumbled) return null;
  const groups = convertBits(jumbled, 8, 5, true);
  if (!groups) return null;
  return bech32Encode(hrp, groups, "bech32m");
}

function standaloneFor(item: RawItem, network: "mainnet" | "testnet"): UnifiedReceiver {
  const forms = STANDALONE[network];
  switch (item.typecode) {
    case TYPECODE_ORCHARD:
      return {
        kind: "orchard",
        receiverHex: bytesToHex(item.bytes),
      };
    case TYPECODE_SAPLING: {
      const groups = convertBits(item.bytes, 8, 5, true);
      // convertBits with pad never fails on byte input; guarded for the compiler.
      return groups
        ? { kind: "sapling", address: bech32Encode(forms.saplingHrp, groups, "bech32") }
        : { kind: "unknown", typecode: item.typecode };
    }
    case TYPECODE_P2PKH:
    case TYPECODE_P2SH: {
      const prefix = item.typecode === TYPECODE_P2PKH ? forms.p2pkh : forms.p2sh;
      const payload = Uint8Array.from([...prefix, ...item.bytes]);
      return {
        kind: item.typecode === TYPECODE_P2PKH ? "p2pkh" : "p2sh",
        address: base58checkEncode(payload),
      };
    }
    default:
      return { kind: "unknown", typecode: item.typecode };
  }
}

/**
 * Decode a unified address into its receivers, or null on any defect — bad checksum, wrong
 * HRP, bad padding, malformed TLV, out-of-order or duplicate typecodes, both transparent forms,
 * no shielded receiver, MUST-understand metadata, a failed round-trip. Never a partial answer.
 */
export function decodeUnifiedAddress(address: string): UnifiedAddressComponents | null {
  const decoded = bech32Decode(address);
  if (!decoded || decoded.variant !== "bech32m") return null;

  let network: "mainnet" | "testnet";
  if (decoded.hrp === HRP_BY_NETWORK.mainnet) network = "mainnet";
  else if (decoded.hrp === HRP_BY_NETWORK.testnet) network = "testnet";
  else return null;

  const bytes = convertBits(decoded.data, 5, 8, false);
  if (!bytes) return null;
  const message = Uint8Array.from(bytes);
  if (message.length < F4JUMBLE_MIN_LENGTH || message.length > F4JUMBLE_MAX_LENGTH) return null;

  const unjumbled = f4jumbleInverse(message);
  if (!unjumbled) return null;

  // The last 16 bytes must be the HRP, zero-padded.
  const padding = unjumbled.subarray(unjumbled.length - 16);
  for (let i = 0; i < 16; i++) {
    const expected = i < decoded.hrp.length ? decoded.hrp.charCodeAt(i) : 0;
    if (padding[i] !== expected) return null;
  }

  const items = parseItems(unjumbled.subarray(0, unjumbled.length - 16));
  if (!items) return null;

  // Round-trip guard: what we parsed must reproduce the input exactly.
  if (encodeUnified(decoded.hrp, items) !== address.toLowerCase()) return null;

  return { network, receivers: items.map((item) => standaloneFor(item, network)) };
}
