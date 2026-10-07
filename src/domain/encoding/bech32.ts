/**
 * Bech32 and Bech32m (BIP-173 / BIP-350), encode and decode, without the 90-character cap:
 * ZIP 316 exempts unified addresses (routinely ~180 characters) from BIP-350's length limit.
 * Sapling addresses use bech32; unified addresses use bech32m.
 */

const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const BECH32_CONST = 1;
const BECH32M_CONST = 0x2bc830a3;

export type Bech32Variant = "bech32" | "bech32m";

function polymod(values: number[]): number {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const b = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) {
      if ((b >>> i) & 1) chk ^= GEN[i]!;
    }
  }
  return chk >>> 0;
}

function hrpExpand(hrp: string): number[] {
  const out: number[] = [];
  for (const ch of hrp) out.push(ch.charCodeAt(0) >>> 5);
  out.push(0);
  for (const ch of hrp) out.push(ch.charCodeAt(0) & 31);
  return out;
}

/** Encode 5-bit groups under `hrp` with the given variant's checksum. */
export function bech32Encode(hrp: string, data: number[], variant: Bech32Variant): string {
  const constant = variant === "bech32m" ? BECH32M_CONST : BECH32_CONST;
  const values = [...hrpExpand(hrp), ...data, 0, 0, 0, 0, 0, 0];
  const mod = polymod(values) ^ constant;
  const checksum: number[] = [];
  for (let i = 0; i < 6; i++) checksum.push((mod >>> (5 * (5 - i))) & 31);
  return `${hrp}1${[...data, ...checksum].map((d) => CHARSET[d]).join("")}`;
}

export interface Bech32Decoded {
  hrp: string;
  /** 5-bit groups, checksum stripped. */
  data: number[];
  variant: Bech32Variant;
}

/**
 * Decode either variant; the checksum determines which. Returns null on anything
 * malformed — mixed case, bad charset, bad checksum — never throws.
 */
export function bech32Decode(input: string): Bech32Decoded | null {
  if (input.length < 8) return null;
  const lower = input.toLowerCase();
  if (input !== lower && input !== input.toUpperCase()) return null;
  for (const ch of lower) {
    const code = ch.charCodeAt(0);
    if (code < 33 || code > 126) return null;
  }
  const sep = lower.lastIndexOf("1");
  if (sep < 1 || sep + 7 > lower.length) return null;
  const hrp = lower.slice(0, sep);
  const data: number[] = [];
  for (const ch of lower.slice(sep + 1)) {
    const index = CHARSET.indexOf(ch);
    if (index === -1) return null;
    data.push(index);
  }
  const check = polymod([...hrpExpand(hrp), ...data]);
  let variant: Bech32Variant;
  if (check === BECH32_CONST) variant = "bech32";
  else if (check === BECH32M_CONST) variant = "bech32m";
  else return null;
  return { hrp, data: data.slice(0, -6), variant };
}

/**
 * Regroup bits: 8→5 with padding when encoding, 5→8 without when decoding.
 * Returns null when the leftover bits are invalid (non-zero padding, or too many).
 */
export function convertBits(
  data: ArrayLike<number>,
  fromBits: number,
  toBits: number,
  pad: boolean,
): number[] | null {
  let acc = 0;
  let bits = 0;
  const out: number[] = [];
  const maxv = (1 << toBits) - 1;
  for (let i = 0; i < data.length; i++) {
    const value = data[i]!;
    if (value < 0 || value >> fromBits !== 0) return null;
    acc = (acc << fromBits) | value;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      out.push((acc >> bits) & maxv);
    }
  }
  if (pad) {
    if (bits > 0) out.push((acc << (toBits - bits)) & maxv);
  } else if (bits >= fromBits || ((acc << (toBits - bits)) & maxv) !== 0) {
    return null;
  }
  return out;
}
