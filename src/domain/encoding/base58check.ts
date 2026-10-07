import { sha256 } from "./sha256";

/**
 * Base58Check. Encoding renders a unified address's transparent receiver in its standalone form
 * (`t1…`/`t3…`, or `tm…`/`t2…` on testnet). Decoding is used by `/learn` to catch a typo in a
 * pasted t-address before a reader asks an exchange to withdraw to it.
 */

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function base58checkEncode(payload: Uint8Array): string {
  const checksum = sha256(sha256(payload)).subarray(0, 4);
  const bytes = new Uint8Array(payload.length + 4);
  bytes.set(payload);
  bytes.set(checksum, payload.length);

  // Count leading zero bytes — each becomes a literal '1'.
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;

  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);

  let encoded = "";
  while (value > 0n) {
    encoded = ALPHABET[Number(value % 58n)] + encoded;
    value /= 58n;
  }
  return "1".repeat(zeros) + encoded;
}

/**
 * The payload of a Base58Check string with its checksum removed, or null when a character is
 * outside the alphabet or the checksum does not match. A changed character fails the checksum
 * with probability 1 − 2⁻³², which is the property a typo check needs.
 */
export function base58checkDecode(text: string): Uint8Array | null {
  let value = 0n;
  for (const char of text) {
    const digit = ALPHABET.indexOf(char);
    if (digit < 0) return null;
    value = value * 58n + BigInt(digit);
  }
  const body: number[] = [];
  while (value > 0n) {
    body.unshift(Number(value & 0xffn));
    value >>= 8n;
  }
  // Each leading '1' is a leading zero byte, the mirror of the encoder above.
  let zeros = 0;
  while (zeros < text.length && text[zeros] === "1") zeros++;
  const bytes = Uint8Array.from([...new Array<number>(zeros).fill(0), ...body]);
  if (bytes.length < 5) return null;
  const payload = bytes.subarray(0, bytes.length - 4);
  const checksum = sha256(sha256(payload)).subarray(0, 4);
  for (let i = 0; i < 4; i++) {
    if (bytes[bytes.length - 4 + i] !== checksum[i]) return null;
  }
  return payload.slice();
}
