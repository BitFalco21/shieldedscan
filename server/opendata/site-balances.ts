import type { Findings } from "./checks";
import { checkFresh, isMainnetTransparentAddress, upTo } from "./site-checks";
import type { SiteInputs } from "./site-series";
import type { SiteViews } from "./site-views";

/**
 * `address_balance_daily`, read from the site's own table of the same name: the balances of the
 * transparent addresses carrying an exchange label on the site, at each UTC day's highest block,
 * from each address's first use. No label or grouping travels with it: an address is its own name
 * here. The tracker deletes an address taken off the list, so every address in the table is still
 * listed and reaches the final day.
 *
 * Every row's `close_height` must be the stream's own highest block of that day, every address must
 * have a row for every day from its first through the final day, and every balance is a balance
 * (never below zero). The tracker stores only days past the reorg depth, so the view must reach the
 * final day like the others.
 */

type Row = Record<string, unknown>;

const DAY_MS = 86_400_000;
const nextDay = (day: string) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);

export function addressBalances(f: Findings, v: SiteViews, x: SiteInputs): Row[] {
  if (!v.address_balance_daily) return [];
  checkFresh(
    f,
    "address_balance_daily",
    v.address_balance_daily.map((r) => String(r.day)),
    x.finalDay,
  );
  const rows = upTo(v.address_balance_daily, x.finalDay);
  const top = new Map(x.stream.poolRows(x.finalDay).map((p) => [String(p.day), p.top_height]));
  const last = new Map<string, string>();
  const invalid = new Set<string>();
  for (const r of rows) {
    const address = String(r.address);
    const day = String(r.day);
    if (!isMainnetTransparentAddress(address)) {
      // The value itself is never echoed: it failed validation, so it could be anything.
      invalid.add(address);
      continue;
    }
    const expected = top.get(day);
    if (expected === undefined || BigInt(expected as number) !== BigInt(r.close_height as number)) {
      f.add("address_balance_daily close_height is not the day's highest block", day);
    }
    if (BigInt(r.balance_zat as number) < 0n) {
      f.add("address_balance_daily balance below zero", day);
    }
    const prev = last.get(address);
    if (prev !== undefined && day !== nextDay(prev)) {
      f.add("address_balance_daily skips a day", `${prev} to ${day}`);
    }
    last.set(address, day);
  }
  for (const a of invalid) {
    f.add("address_balance_daily address is not a mainnet t-address", `${a.length} characters`);
  }
  for (const [, day] of last) {
    if (day !== x.finalDay) f.add("address_balance_daily stops before the final day", day);
  }
  return rows;
}
