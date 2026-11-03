/**
 * RFC 4180 CSV, written by hand: the format is a dozen lines of rules and a dependency would be
 * larger than this file.
 *
 * Records end in CRLF, a field is quoted only when it holds a quote, comma, CR or LF, and a quote
 * inside one is doubled. A cell is a string already formatted by `formatCell`, or null, which is an
 * empty field: in these files an empty field is NULL and never zero.
 */

const NEEDS_QUOTES = /[",\r\n]/;

export function csvField(cell: string | null): string {
  if (cell === null) return "";
  return NEEDS_QUOTES.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

export function csvRecord(cells: readonly (string | null)[]): string {
  return `${cells.map(csvField).join(",")}\r\n`;
}

/**
 * A finite number as plain decimal text, never in exponent form (`1e-7`, `1e+21`), which a
 * spreadsheet or a strict parser can read as text or as a different number. Integers must be safe:
 * one past 2^53 has already lost its last digit, and writing it would publish a wrong figure.
 */
export function plainNumber(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`not a finite number: ${n}`);
  if (Number.isInteger(n)) {
    if (!Number.isSafeInteger(n)) throw new Error(`integer beyond 2^53 lost precision: ${n}`);
    return String(n);
  }
  const s = String(n);
  if (!/e/i.test(s)) return s;
  // Up to 20 fraction digits covers every double below 1e-6 that String() would have shortened.
  return n.toFixed(20).replace(/0+$/, "").replace(/\.$/, "");
}
