/**
 * Invisible characters that can hide or reorder text: zero-width spaces and marks, bidirectional
 * overrides and isolates, word joiners, the byte-order mark, and Unicode "tag" characters (which
 * can smuggle a hidden instruction). The zero-width joiner (U+200D) is kept: emoji sequences
 * need it.
 */
function isInvisibleFormat(code: number): boolean {
  return (
    code === 0x200b ||
    code === 0x200c ||
    code === 0x200e ||
    code === 0x200f ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2060 && code <= 0x2064) ||
    (code >= 0x2066 && code <= 0x2069) ||
    code === 0xfeff ||
    (code >= 0xe0000 && code <= 0xe007f)
  );
}

/**
 * Keeps characters a person can read.
 *
 * Drops C0/C1 control characters and U+FFFD. The replacement character matters most: it is
 * what invalid UTF-8 decodes to, so dropping it is what removes binary noise while leaving
 * genuine multi-byte text — miners do embed emoji, such as 🦓.
 *
 * The single definition of "printable" for every string a stranger chooses: coinbase tags,
 * venue labels, ZIP headers and the agent's step subjects.
 */
export function printableOnly(text: string): string {
  let out = "";
  for (const character of text) {
    const code = character.codePointAt(0);
    if (code === undefined || code === 0xfffd) continue;
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) continue;
    if (isInvisibleFormat(code)) continue;
    out += character;
  }
  return out;
}
