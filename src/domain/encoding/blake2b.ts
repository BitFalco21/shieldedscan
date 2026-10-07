/**
 * BLAKE2b (RFC 7693), pure TypeScript, with the two parameters F4Jumble (ZIP 316) needs and
 * Node's OpenSSL build does not expose: a variable digest length and a 16-byte
 * personalization. Unkeyed only.
 *
 * Hand-rolled to avoid a runtime dependency; pinned by the RFC 7693 appendix vector and,
 * transitively, every official ZIP 316 F4Jumble vector. BigInt 64-bit words are fast enough
 * for one ~200-byte address decode per render.
 */

const MASK64 = (1n << 64n) - 1n;

const IV: readonly bigint[] = [
  0x6a09e667f3bcc908n,
  0xbb67ae8584caa73bn,
  0x3c6ef372fe94f82bn,
  0xa54ff53a5f1d36f1n,
  0x510e527fade682d1n,
  0x9b05688c2b3e6c1fn,
  0x1f83d9abfb41bd6bn,
  0x5be0cd19137e2179n,
];

// prettier-ignore
const SIGMA: readonly (readonly number[])[] = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3],
  [11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4],
  [7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8],
  [9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13],
  [2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9],
  [12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11],
  [13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10],
  [6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5],
  [10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0],
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3],
];

function rotr(x: bigint, n: bigint): bigint {
  return ((x >> n) | (x << (64n - n))) & MASK64;
}

function readLE64(bytes: Uint8Array, offset: number): bigint {
  let word = 0n;
  for (let i = 7; i >= 0; i--) {
    word = (word << 8n) | BigInt(bytes[offset + i] ?? 0);
  }
  return word;
}

function compress(h: bigint[], block: Uint8Array, tBytes: bigint, isLast: boolean): void {
  const m: bigint[] = new Array(16);
  for (let i = 0; i < 16; i++) m[i] = readLE64(block, i * 8);

  const v: bigint[] = new Array(16);
  for (let i = 0; i < 8; i++) v[i] = h[i]!;
  for (let i = 0; i < 8; i++) v[i + 8] = IV[i]!;
  v[12] = v[12]! ^ (tBytes & MASK64);
  v[13] = v[13]! ^ ((tBytes >> 64n) & MASK64);
  if (isLast) v[14] = v[14]! ^ MASK64;

  const G = (a: number, b: number, c: number, d: number, x: bigint, y: bigint) => {
    v[a] = (v[a]! + v[b]! + x) & MASK64;
    v[d] = rotr(v[d]! ^ v[a]!, 32n);
    v[c] = (v[c]! + v[d]!) & MASK64;
    v[b] = rotr(v[b]! ^ v[c]!, 24n);
    v[a] = (v[a]! + v[b]! + y) & MASK64;
    v[d] = rotr(v[d]! ^ v[a]!, 16n);
    v[c] = (v[c]! + v[d]!) & MASK64;
    v[b] = rotr(v[b]! ^ v[c]!, 63n);
  };

  for (let round = 0; round < 12; round++) {
    const s = SIGMA[round]!;
    G(0, 4, 8, 12, m[s[0]!]!, m[s[1]!]!);
    G(1, 5, 9, 13, m[s[2]!]!, m[s[3]!]!);
    G(2, 6, 10, 14, m[s[4]!]!, m[s[5]!]!);
    G(3, 7, 11, 15, m[s[6]!]!, m[s[7]!]!);
    G(0, 5, 10, 15, m[s[8]!]!, m[s[9]!]!);
    G(1, 6, 11, 12, m[s[10]!]!, m[s[11]!]!);
    G(2, 7, 8, 13, m[s[12]!]!, m[s[13]!]!);
    G(3, 4, 9, 14, m[s[14]!]!, m[s[15]!]!);
  }

  for (let i = 0; i < 8; i++) h[i] = h[i]! ^ v[i]! ^ v[i + 8]!;
}

/**
 * Unkeyed BLAKE2b of `input`, `digestLength` bytes (1–64), with an optional
 * personalization of at most 16 bytes (zero-padded into the parameter block).
 */
export function blake2b(
  input: Uint8Array,
  digestLength: number,
  personalization?: Uint8Array,
): Uint8Array {
  if (!Number.isInteger(digestLength) || digestLength < 1 || digestLength > 64) {
    throw new Error(`blake2b digest length out of range: ${digestLength}`);
  }
  if (personalization && personalization.length > 16) {
    throw new Error("blake2b personalization exceeds 16 bytes");
  }

  // Parameter block: digest length, key length 0, fanout 1, depth 1; the
  // personalization occupies bytes 48–63. Everything else zero.
  const param = new Uint8Array(64);
  param[0] = digestLength;
  param[2] = 1;
  param[3] = 1;
  if (personalization) param.set(personalization, 48);

  const h: bigint[] = new Array(8);
  for (let i = 0; i < 8; i++) h[i] = IV[i]! ^ readLE64(param, i * 8);

  // Every block except the last is full; the last (possibly empty input's only
  // block) is zero-padded. `t` counts bytes fed so far, including the last block's.
  const blockCount = Math.max(1, Math.ceil(input.length / 128));
  for (let i = 0; i < blockCount; i++) {
    const isLast = i === blockCount - 1;
    const chunk = input.subarray(i * 128, Math.min((i + 1) * 128, input.length));
    let block = chunk;
    if (chunk.length < 128) {
      block = new Uint8Array(128);
      block.set(chunk);
    }
    const fed = isLast ? input.length : (i + 1) * 128;
    compress(h, block, BigInt(fed), isLast);
  }

  const out = new Uint8Array(digestLength);
  for (let i = 0; i < digestLength; i++) {
    out[i] = Number((h[i >> 3]! >> BigInt(8 * (i & 7))) & 0xffn);
  }
  return out;
}
