/**
 * secp256k1 public-key derivation, pure TypeScript over BigInt, for `/satoshi`: each draw needs
 * the uncompressed public key of a random scalar. Hand-rolled to keep `node:crypto` out of a
 * graph that reaches the browser.
 *
 * Not constant-time, by design: the scalar is the visitor's own throwaway, generated in their
 * tab, and nothing here signs. Do not lift it into a signer.
 *
 * Jacobian coordinates (x = X/Z², y = Y/Z³) need one modular inverse at the end rather than one
 * per step: ~1.2 ms per derivation in Node against ~100+ ms affine. Formulas are dbl-2009-l
 * (a = 0) and add-2007-bl; test results are checked against OpenSSL's ECDH and the curve
 * equation.
 */

export const SECP256K1_P = 2n ** 256n - 2n ** 32n - 977n;
export const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
export const SECP256K1_G = {
  x: 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n,
  y: 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n,
} as const;

const P = SECP256K1_P;

const mod = (a: bigint): bigint => {
  const r = a % P;
  return r < 0n ? r + P : r;
};

function modPow(base: bigint, exponent: bigint): bigint {
  let result = 1n;
  let b = mod(base);
  let e = exponent;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % P;
    b = (b * b) % P;
    e >>= 1n;
  }
  return result;
}

/** Fermat: a⁻¹ = a^(p−2) mod p. One call per derivation, so its cost does not matter. */
const modInverse = (a: bigint): bigint => modPow(a, P - 2n);

type Jacobian = readonly [X: bigint, Y: bigint, Z: bigint];
const INFINITY: Jacobian = [0n, 1n, 0n];

function double([X, Y, Z]: Jacobian): Jacobian {
  if (Y === 0n || Z === 0n) return INFINITY;
  const A = (X * X) % P;
  const B = (Y * Y) % P;
  const C = (B * B) % P;
  const D = mod(2n * ((((X + B) * (X + B)) % P) - A - C));
  const E = (3n * A) % P;
  const F = (E * E) % P;
  const X3 = mod(F - 2n * D);
  const Y3 = mod(E * (D - X3) - 8n * C);
  const Z3 = (2n * Y * Z) % P;
  return [X3, Y3, Z3];
}

function add(p: Jacobian, q: Jacobian): Jacobian {
  const [X1, Y1, Z1] = p;
  const [X2, Y2, Z2] = q;
  if (Z1 === 0n) return q;
  if (Z2 === 0n) return p;
  const Z1Z1 = (Z1 * Z1) % P;
  const Z2Z2 = (Z2 * Z2) % P;
  const U1 = (X1 * Z2Z2) % P;
  const U2 = (X2 * Z1Z1) % P;
  const S1 = (Y1 * Z2 * Z2Z2) % P;
  const S2 = (Y2 * Z1 * Z1Z1) % P;
  const H = mod(U2 - U1);
  const r = mod(2n * (S2 - S1));
  if (H === 0n) return r === 0n ? double(p) : INFINITY;
  const I = (2n * H * (2n * H)) % P;
  const J = (H * I) % P;
  const V = (U1 * I) % P;
  const X3 = mod(r * r - J - 2n * V);
  const Y3 = mod(r * (V - X3) - 2n * S1 * J);
  const Z3 = mod(((((Z1 + Z2) * (Z1 + Z2)) % P) - Z1Z1 - Z2Z2) * H);
  return [X3, Y3, Z3];
}

/** y² = x³ + 7 over the field. Exported so a test can check a derived point independently. */
export function isOnCurve(x: bigint, y: bigint): boolean {
  if (x < 0n || x >= P || y < 0n || y >= P) return false;
  return mod(y * y - x * x * x - 7n) === 0n;
}

function scalarFromBytes(bytes: Uint8Array): bigint {
  let k = 0n;
  for (const byte of bytes) k = (k << 8n) | BigInt(byte);
  return k;
}

function toBytes32(value: bigint, out: Uint8Array, offset: number): void {
  let v = value;
  for (let i = 31; i >= 0; i--) {
    out[offset + i] = Number(v & 0xffn);
    v >>= 8n;
  }
}

/**
 * The uncompressed public key `04 || x || y` (65 bytes) for a 32-byte big-endian scalar, or
 * `null` when the input is not a valid private key (wrong length, zero, or ≥ n). Uncompressed
 * because that is the form the genesis output carries.
 */
export function secp256k1PublicKey(privateKey: Uint8Array): Uint8Array | null {
  if (privateKey.length !== 32) return null;
  const k = scalarFromBytes(privateKey);
  if (k === 0n || k >= SECP256K1_N) return null;

  let result: Jacobian = INFINITY;
  const base: Jacobian = [SECP256K1_G.x, SECP256K1_G.y, 1n];
  for (let i = 255; i >= 0; i--) {
    result = double(result);
    if ((k >> BigInt(i)) & 1n) result = add(result, base);
  }

  const [X, Y, Z] = result;
  const zInv = modInverse(Z);
  const zInv2 = (zInv * zInv) % P;
  const x = (X * zInv2) % P;
  const y = (Y * zInv2 * zInv) % P;

  const out = new Uint8Array(65);
  out[0] = 0x04;
  toBytes32(x, out, 1);
  toBytes32(y, out, 33);
  return out;
}
