import type { AccuracyCase, TruthRow } from "./types";

/**
 * Whether the truth figure reached Zeno at all: a plain string search over the machine-formatted
 * tool output. Separates "the right number was there and the answer misquoted it" from "the data
 * or the route never carried it". Null where a search cannot say (a share Zeno is handed as a
 * rounded percentage, or a figure that must not exist).
 */
export function payloadCarries(
  c: AccuracyCase,
  row: TruthRow,
  payloads: readonly string[],
): boolean | null {
  const value = row[c.expect.column];
  if (value === null || value === undefined) return null;
  const text = payloads.join("\n");
  const hasDigits = (digits: string) => new RegExp(`(?<![\\d.])${digits}(?![\\d])`).test(text);
  const grouped = (n: number) => Math.trunc(n).toLocaleString("en-US");
  switch (c.expect.unit) {
    case "count": {
      if (typeof value !== "number") return null;
      return hasDigits(String(value)) || text.includes(grouped(value));
    }
    case "zec": {
      if (typeof value !== "number") return null;
      const zec = (value / 1e8).toFixed(8).replace(/\.?0+$/, "");
      const [whole, frac] = zec.split(".");
      const groupedZec = `${Number(whole).toLocaleString("en-US")}${frac ? `.${frac}` : ""}`;
      return hasDigits(String(value)) || text.includes(zec) || text.includes(groupedZec);
    }
    case "day":
      return typeof value === "string" ? text.includes(value) : null;
    default:
      return null;
  }
}
