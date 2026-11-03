import { base58checkDecode } from "@/domain/encoding/base58check";
import type { Findings } from "./checks";

/**
 * The comparisons that hold the site's precomputed tables to the export's own stream, and the
 * staleness rules for the views. The site's matviews are refreshed on timers and carry no refresh
 * time, so freshness is judged by content: a view must reach past the release's final day, and
 * where it counts blocks its counts must equal the stream's.
 */

type Row = Record<string, unknown>;

/** A float's agreement: summed in another order by PostgreSQL, so equal only to rounding. */
const FLOAT_TOLERANCE = 1e-9;

function same(a: unknown, b: unknown, float: boolean): boolean {
  if (a === null || a === undefined || b === null || b === undefined) {
    return (a ?? null) === (b ?? null);
  }
  if (float) {
    const x = Number(a);
    const y = Number(b);
    return x === y || Math.abs(x - y) <= FLOAT_TOLERANCE * Math.max(Math.abs(x), Math.abs(y));
  }
  const numeric = (v: unknown): v is number | bigint =>
    typeof v === "bigint" || (typeof v === "number" && Number.isSafeInteger(v));
  if (numeric(a) && numeric(b)) return BigInt(a) === BigInt(b);
  return a === b;
}

/** Rows up to and including the final day; days are `YYYY-MM-DD`, so string order is date order. */
export const upTo = (rows: readonly Row[] | null, finalDay: string): Row[] =>
  (rows ?? []).filter((r) => String(r.day) <= finalDay);

export const daysOf = (rows: readonly Row[]): string[] => rows.map((r) => String(r.day));

const show = (v: unknown) => (v === null || v === undefined ? "NULL" : String(v));

export interface CompareSpec {
  /** The published or stream-side name, and the site table it is held to. */
  name: string;
  against: string;
  key: readonly string[];
  columns: readonly string[];
  floats?: readonly string[];
}

/**
 * Two sets of rows must hold the same keys with the same values, column by column: a key on one
 * side only is a missing day (stale or incomplete), a different value a disagreement. Integers are
 * compared exactly whatever their JS type.
 */
export function compareRows(
  f: Findings,
  spec: CompareSpec,
  left: readonly Row[],
  right: readonly Row[],
): void {
  const rule = `${spec.name} differs from ${spec.against}`;
  const keyOf = (r: Row) => spec.key.map((k) => show(r[k])).join(" ");
  const index = (rows: readonly Row[]) => new Map(rows.map((r) => [keyOf(r), r]));
  const l = index(left);
  const r = index(right);
  for (const [key, a] of l) {
    const b = r.get(key);
    if (b === undefined) {
      f.add(rule, `${key}: missing from ${spec.against}`);
      continue;
    }
    for (const col of spec.columns) {
      if (!same(a[col], b[col], spec.floats?.includes(col) ?? false)) {
        f.add(rule, `${key} ${col}: ${show(a[col])} vs ${show(b[col])}`);
      }
    }
  }
  for (const key of r.keys()) if (!l.has(key)) f.add(rule, `${key}: missing from ${spec.name}`);
}

/**
 * A view is current at the release when it has a row for the final day and one after it. Days
 * are `YYYY-MM-DD`, compared as strings.
 */
export function checkFresh(
  f: Findings,
  view: string,
  days: readonly string[],
  finalDay: string,
): void {
  if (!days.includes(finalDay)) f.add("stale view: no row for the final day", view);
  if (!days.some((d) => d > finalDay)) f.add("stale view: nothing after the final day", view);
}

/** A unix second the site's matviews truncated to a day: a non-midnight one means a non-UTC zone. */
export function checkUtcMidnights(f: Findings, view: string, ts: readonly unknown[]): void {
  const bad = ts.find((t) => t === null || BigInt(t as bigint | number) % 86_400n !== 0n);
  if (bad !== undefined) {
    f.add("day not truncated in UTC (the refresher's time zone is not UTC)", `${view}: ${bad}`);
  }
}

export const HEX64 = /^[0-9a-f]{64}$/;

/** Mainnet P2PKH (`t1…`) and P2SH (`t3…`) prefixes, as `/learn`'s address check reads them. */
const MAINNET_T_PREFIXES = new Set(["1cb8", "1cbd"]);
const T_ADDRESS_SHAPE = /^t[13][1-9A-HJ-NP-Za-km-z]{33}$/;

/** A well-formed mainnet transparent address: shape, Base58Check checksum and version prefix. */
export function isMainnetTransparentAddress(text: string): boolean {
  if (!T_ADDRESS_SHAPE.test(text)) return false;
  const payload = base58checkDecode(text);
  if (payload === null || payload.length !== 22) return false;
  const prefix = Array.from(payload.subarray(0, 2), (b) => b.toString(16).padStart(2, "0"));
  return MAINNET_T_PREFIXES.has(prefix.join(""));
}
