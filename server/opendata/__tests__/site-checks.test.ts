import { describe, expect, it } from "vitest";
import { base58checkEncode } from "@/domain/encoding/base58check";
import { Findings } from "../checks";
import {
  checkFresh,
  checkUtcMidnights,
  compareRows,
  HEX64,
  isMainnetTransparentAddress,
} from "../site-checks";
import { readSiteViews } from "../site-views";

const spec = {
  name: "ours",
  against: "theirs",
  key: ["day"],
  columns: ["n", "avg"],
  floats: ["avg"],
};
const run = (fn: (f: Findings) => void) => {
  const f = new Findings();
  fn(f);
  return f.list();
};

describe("comparing a table with the site's", () => {
  it("compares integers exactly whatever their JS type, and floats to rounding", () => {
    const ours = [{ day: "2026-01-01", n: 5, avg: 1 / 3 }];
    const theirs = [{ day: "2026-01-01", n: 5n, avg: 0.3333333333333333 * (1 + 1e-12) }];
    expect(run((f) => compareRows(f, spec, ours, theirs))).toEqual([]);
  });

  it("reports a different value, a float past rounding, and NULL against a value", () => {
    const failures = run((f) =>
      compareRows(
        f,
        spec,
        [
          { day: "2026-01-01", n: 5, avg: 1 },
          { day: "2026-01-02", n: null, avg: 1 },
        ],
        [
          { day: "2026-01-01", n: 6n, avg: 1 + 1e-6 },
          { day: "2026-01-02", n: 0n, avg: 1 },
        ],
      ),
    );
    expect(failures).toEqual([
      "ours differs from theirs: 3 (e.g. 2026-01-01 n: 5 vs 6; 2026-01-01 avg: 1 vs 1.000001; 2026-01-02 n: NULL vs 0)",
    ]);
  });

  it("reports a day on either side only", () => {
    const failures = run((f) =>
      compareRows(
        f,
        spec,
        [{ day: "2026-01-01", n: 1, avg: 1 }],
        [{ day: "2026-01-02", n: 1, avg: 1 }],
      ),
    );
    expect(failures).toEqual([
      "ours differs from theirs: 2 (e.g. 2026-01-01: missing from theirs; 2026-01-02: missing from ours)",
    ]);
  });
});

describe("staleness", () => {
  it("needs a row for the final day and one after it", () => {
    expect(run((f) => checkFresh(f, "v", ["2026-01-01", "2026-01-02"], "2026-01-01"))).toEqual([]);
    expect(run((f) => checkFresh(f, "v", ["2026-01-01"], "2026-01-01"))).toEqual([
      "stale view: nothing after the final day: 1 (e.g. v)",
    ]);
    expect(run((f) => checkFresh(f, "v", ["2025-12-31", "2026-01-02"], "2026-01-01"))).toEqual([
      "stale view: no row for the final day: 1 (e.g. v)",
    ]);
    expect(run((f) => checkFresh(f, "v", [], "2026-01-01"))).toHaveLength(2);
  });

  it("needs each truncated day to be a UTC midnight", () => {
    expect(run((f) => checkUtcMidnights(f, "v", [86_400n, 0, 172_800]))).toEqual([]);
    expect(run((f) => checkUtcMidnights(f, "v", [86_400n, 86_400n - 32_400n]))).toEqual([
      "day not truncated in UTC (the refresher's time zone is not UTC): 1 (e.g. v: 54000)",
    ]);
  });
});

describe("formats", () => {
  const t = (prefix: number[], fill = 7) =>
    base58checkEncode(Uint8Array.from([...prefix, ...new Array<number>(20).fill(fill)]));

  it("accepts mainnet P2PKH and P2SH addresses only", () => {
    expect(isMainnetTransparentAddress(t([0x1c, 0xb8]))).toBe(true);
    expect(isMainnetTransparentAddress(t([0x1c, 0xbd]))).toBe(true);
    // Testnet P2PKH (tm…), a broken checksum, an empty string, and anything else.
    expect(isMainnetTransparentAddress(t([0x1d, 0x25]))).toBe(false);
    const good = t([0x1c, 0xb8]);
    const flipped = good.slice(0, -1) + (good.endsWith("a") ? "b" : "a");
    expect(isMainnetTransparentAddress(flipped)).toBe(false);
    expect(isMainnetTransparentAddress("")).toBe(false);
    expect(isMainnetTransparentAddress("http://evil.example/t1")).toBe(false);
  });

  it("accepts a lowercase 64-hex transaction id only", () => {
    expect(HEX64.test("ab".repeat(32))).toBe(true);
    expect(HEX64.test("AB".repeat(32))).toBe(false);
    expect(HEX64.test("ab".repeat(31))).toBe(false);
  });
});

describe("reading the site's views", () => {
  const client = (fail: Record<string, { code?: string }>) => ({
    statements: [] as string[],
    async query(sql: string) {
      this.statements.push(sql);
      const view = Object.keys(fail).find((v) => new RegExp(`opendata\\.${v}\\b`).test(sql));
      if (view) throw Object.assign(new Error("boom"), fail[view]);
      return { rows: [{ day: "2026-01-01" }] };
    },
  });

  it("turns a never-populated or missing view into a failure, and rolls back to its savepoint", async () => {
    const c = client({ check_day_pool_tx: { code: "55000" }, fees_monthly: { code: "42P01" } });
    const { views, failures } = await readSiteViews(c as never);
    expect(views.check_day_pool_tx).toBeNull();
    expect(views.fees_monthly).toBeNull();
    expect(views.check_day_rollup).toEqual([{ day: "2026-01-01" }]);
    expect(failures).toEqual([
      "site view opendata.check_day_pool_tx: never populated (a WITH NO DATA matview not yet refreshed)",
      "site view opendata.fees_monthly: missing (apply server/schema-opendata.sql)",
    ]);
    expect(c.statements.filter((s) => s === "ROLLBACK TO SAVEPOINT site_view")).toHaveLength(2);
  });

  it("lets any other error through", async () => {
    await expect(
      readSiteViews(client({ check_day_rollup: { code: "57014" } }) as never),
    ).rejects.toThrow("boom");
  });
});
