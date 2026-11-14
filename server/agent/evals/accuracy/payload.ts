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
  const bounded = (needle: string) =>
    new RegExp(`(?<![\\d.,])${needle.replace(/[.,]/g, (c) => `\\${c}`)}(?![\\d]|[.,]\\d)`).test(
      text,
    );
  const hasDigits = (digits: string) => bounded(digits);
  const grouped = (n: number) => Math.trunc(n).toLocaleString("en-US");
  switch (c.expect.unit) {
    case "count": {
      // A small count ("3") is found in any payload, which proves nothing.
      if (typeof value !== "number" || Math.abs(value) < 1000) return null;
      return hasDigits(String(value)) || bounded(grouped(value));
    }
    case "zec": {
      if (typeof value !== "number") return null;
      const zec = (value / 1e8).toFixed(8).replace(/\.?0+$/, "");
      const [whole, frac] = zec.split(".");
      const groupedZec = `${Number(whole).toLocaleString("en-US")}${frac ? `.${frac}` : ""}`;
      if (zec.replace(/^0\.?0*/, "").replace(".", "").length < 4) return null;
      return hasDigits(String(value)) || bounded(zec) || bounded(groupedZec);
    }
    case "day":
      return typeof value === "string" ? text.includes(value) : null;
    default:
      return null;
  }
}
