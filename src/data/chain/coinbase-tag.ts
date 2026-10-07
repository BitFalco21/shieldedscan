import { printableOnly } from "@/lib/printable";

/**
 * The miner's message, read out of a coinbase input script.
 *
 * This is the one field on a block page whose content an outsider chooses: the coinbase
 * script is arbitrary bytes, written by whoever mined the block. Everything here exists to
 * turn those bytes into something safe and honest to display.
 *
 * Why this filters bytes instead of parsing the script. A coinbase script looks like a
 * sequence of length-prefixed pushes, and parsing it that way yields a clean tag on blocks
 * that follow the convention. On real blocks (see `__fixtures__/`) it does not:
 *
 *   | block     | push-parsed        | byte-filtered                            |
 *   |-----------|--------------------|------------------------------------------|
 *   | 3,426,987 | `🦓bdgj`           | `🦓bdgjFoundry Zcash Pool #PrivacyMatters` |
 *   | 3,426,970 | `` 🦓`gj ``        | `` 🦓`gjFoundry Zcash Pool #PrivacyMatters `` |
 *
 * In those blocks the miner writes a 4-byte timestamp push (`bdgj` is 0x6a676462 — the
 * block's own `time` — little-endian) and then the pool name as raw bytes with no push
 * prefix. A push parser stops at the first byte that is not a valid opcode and discards the
 * pool's name, the most interesting thing in the field.
 *
 * So the rule is: drop the one structure that is guaranteed (the BIP34 height push), then
 * keep whatever is printable. The cost is a few stray characters from binary fields that
 * happen to fall in the printable range. Showing slightly more of what the miner actually
 * wrote is the right failure: the alternative hides the name and looks tidy doing it.
 */

/** Long enough for every real tag seen; short enough that no one can push a wall of text. */
const MAX_TAG_LENGTH = 120;

/**
 * Drops the leading block-height push.
 *
 * Zcash inherits BIP34: a coinbase script starts with the height as a length-prefixed
 * push, so the first byte is a small count (1–4) and the bytes it covers are binary. That
 * part is structure, not message, and it is the only part that can be relied on.
 */
function skipHeightPush(bytes: Buffer): Buffer {
  const length = bytes[0];
  if (length === undefined || length < 1 || length > 4) return bytes;
  return bytes.length > 1 + length ? bytes.subarray(1 + length) : bytes;
}

/**
 * Decodes a coinbase input script (hex) into a display string, or null when nothing
 * printable survives — which is the common case, since most miners write no message at all.
 */
export function decodeCoinbaseTag(scriptHex: string | undefined): string | null {
  if (scriptHex === undefined || scriptHex.length === 0) return null;
  if (!/^[0-9a-fA-F]*$/.test(scriptHex) || scriptHex.length % 2 !== 0) return null;

  const bytes = Buffer.from(scriptHex, "hex");
  if (bytes.length === 0) return null;

  const tag = printableOnly(skipHeightPush(bytes).toString("utf8"))
    // Runs of whitespace collapse: a tag is a label, not layout, and padding a name out
    // to a column width is a cheap way to shove the rest of a table sideways.
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TAG_LENGTH);

  return tag.length === 0 ? null : tag;
}
