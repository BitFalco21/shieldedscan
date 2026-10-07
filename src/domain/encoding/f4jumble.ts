import { blake2b } from "./blake2b";

/**
 * F4Jumble (ZIP 316): the keyless, invertible 4-round Feistel-like transform applied to every
 * unified address before Bech32m. A one-character typo garbles the whole address rather than
 * one receiver, which is why the decoder can rely on the 16-byte HRP padding check.
 *
 * Personalizations pinned from the ZIP text (fetched 2026-08-17):
 *   H_i: "UA_F4Jumble_H" ‖ [i, 0, 0]      → BLAKE2b, digest length ℓ_L
 *   G_i: "UA_F4Jumble_G" ‖ [i] ‖ LE16(j)  → BLAKE2b-512, concatenated, first ℓ_R bytes
 * with ℓ_L = min(64, floor(ℓ_M / 2)), ℓ_R = ℓ_M − ℓ_L, and 38 ≤ ℓ_M ≤ 4,194,368.
 */

export const F4JUMBLE_MIN_LENGTH = 38;
export const F4JUMBLE_MAX_LENGTH = 4_194_368;

const H_PERSONAL = "UA_F4Jumble_H";
const G_PERSONAL = "UA_F4Jumble_G";

function ascii(text: string): number[] {
  return Array.from(text, (ch) => ch.charCodeAt(0));
}

function hPersonalization(i: number): Uint8Array {
  return Uint8Array.from([...ascii(H_PERSONAL), i, 0, 0]);
}

function gPersonalization(i: number, j: number): Uint8Array {
  return Uint8Array.from([...ascii(G_PERSONAL), i, j & 0xff, (j >> 8) & 0xff]);
}

function xorInto(target: Uint8Array, source: Uint8Array): void {
  for (let i = 0; i < target.length; i++) target[i] = target[i]! ^ source[i]!;
}

/** H_i over `input`, truncated to `length` bytes (ℓ_L ≤ 64, so one BLAKE2b call). */
function roundH(i: number, input: Uint8Array, length: number): Uint8Array {
  return blake2b(input, length, hPersonalization(i));
}

/** G_i over `input`: 64-byte BLAKE2b blocks j = 0, 1, …, first `length` bytes. */
function roundG(i: number, input: Uint8Array, length: number): Uint8Array {
  const out = new Uint8Array(length);
  for (let j = 0; j * 64 < length; j++) {
    const block = blake2b(input, 64, gPersonalization(i, j));
    out.set(block.subarray(0, Math.min(64, length - j * 64)), j * 64);
  }
  return out;
}

function splitLengths(messageLength: number): { left: number; right: number } | null {
  if (messageLength < F4JUMBLE_MIN_LENGTH || messageLength > F4JUMBLE_MAX_LENGTH) return null;
  const left = Math.min(64, Math.floor(messageLength / 2));
  return { left, right: messageLength - left };
}

export function f4jumble(message: Uint8Array): Uint8Array | null {
  const lengths = splitLengths(message.length);
  if (!lengths) return null;
  const a = message.slice(0, lengths.left);
  const b = message.slice(lengths.left);
  const x = b; // x = b ⊕ G_0(a)
  xorInto(x, roundG(0, a, lengths.right));
  const y = a; // y = a ⊕ H_0(x)
  xorInto(y, roundH(0, x, lengths.left));
  const d = x; // d = x ⊕ G_1(y)
  xorInto(d, roundG(1, y, lengths.right));
  const c = y; // c = y ⊕ H_1(d)
  xorInto(c, roundH(1, d, lengths.left));
  const out = new Uint8Array(message.length);
  out.set(c);
  out.set(d, lengths.left);
  return out;
}

export function f4jumbleInverse(jumbled: Uint8Array): Uint8Array | null {
  const lengths = splitLengths(jumbled.length);
  if (!lengths) return null;
  const c = jumbled.slice(0, lengths.left);
  const d = jumbled.slice(lengths.left);
  const y = c; // y = c ⊕ H_1(d)
  xorInto(y, roundH(1, d, lengths.left));
  const x = d; // x = d ⊕ G_1(y)
  xorInto(x, roundG(1, y, lengths.right));
  const a = y; // a = y ⊕ H_0(x)
  xorInto(a, roundH(0, x, lengths.left));
  const b = x; // b = x ⊕ G_0(a)
  xorInto(b, roundG(0, a, lengths.right));
  const out = new Uint8Array(jumbled.length);
  out.set(a);
  out.set(b, lengths.left);
  return out;
}
