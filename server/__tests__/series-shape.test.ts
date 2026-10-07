import { describe, expect, it } from "vitest";
import { ParamError } from "../v1/params";
import { applyShape, parseShape } from "../v1/series-shape";

/**
 * `sort`/`order`/`top`/`fields` over an analytics answer's list. The rules are the agent's
 * ranking rules, and each has a case that a naive implementation fails: a null must not rank as
 * zero, a tie at the top must be reported, and `unknowns` must follow its row.
 */

const body = () => ({
  query: {},
  data: {
    interval: "day",
    points: [
      { periodStart: "2026-09-01", blocks: 1000, avgDifficulty: 100, avgBlockBytes: 2000 },
      { periodStart: "2026-09-02", blocks: 3000, avgDifficulty: null, avgBlockBytes: null },
      { periodStart: "2026-09-03", blocks: 3000, avgDifficulty: 300, avgBlockBytes: 900 },
    ],
  },
  unknowns: {
    "data.points.1.avgDifficulty": "unmeasured",
    "data.points.1.avgBlockBytes": "unmeasured",
  },
});

const shape = (q: Record<string, string>) => parseShape(q);

describe("parseShape", () => {
  it("is null when nothing is asked, so the answer is returned untouched", () => {
    expect(parseShape({ from: "2026-01-01" })).toBeNull();
  });

  it("refuses top or order without sort, and out-of-range values", () => {
    for (const q of <Record<string, string>[]>[
      { top: "3" },
      { order: "asc" },
      { sort: "blocks", top: "0" },
      { sort: "blocks", top: "101" },
      { sort: "blocks", order: "down" },
      { sort: "1bad" },
      { fields: "," },
    ]) {
      expect(() => parseShape(q), JSON.stringify(q)).toThrow(ParamError);
    }
  });
});

describe("applyShape", () => {
  it("ranks by a field, drops the unmeasured, and reports a tie at the top", () => {
    const out = applyShape(body(), shape({ sort: "blocks" }));
    expect(out.data.points.map((p) => p.periodStart)).toEqual([
      "2026-09-02",
      "2026-09-03",
      "2026-09-01",
    ]);
    expect((out.data as unknown as { ranking: unknown }).ranking).toEqual({
      by: "blocks",
      order: "desc",
      top: null,
      considered: 3,
      unmeasured: 0,
      tiedAtTop: 2,
    });
  });

  it("never ranks a null as zero: the lowest difficulty is a measured day", () => {
    const out = applyShape(body(), shape({ sort: "avgDifficulty", order: "asc", top: "1" }));
    expect(out.data.points.map((p) => p.periodStart)).toEqual(["2026-09-01"]);
    expect((out.data as unknown as { ranking: { unmeasured: number } }).ranking.unmeasured).toBe(1);
  });

  it("renumbers unknowns to follow their rows and drops those whose row is gone", () => {
    const sorted = applyShape(body(), shape({ sort: "blocks" }));
    // The unmeasured 2026-09-02 moved from position 1 to position 0.
    expect(sorted.unknowns).toEqual({
      "data.points.0.avgDifficulty": "unmeasured",
      "data.points.0.avgBlockBytes": "unmeasured",
    });
    const top1 = applyShape(body(), shape({ sort: "avgDifficulty", top: "1" }));
    expect(top1.unknowns).toEqual({});
  });

  it("keeps only the fields asked for, and the period label always", () => {
    const out = applyShape(body(), shape({ fields: "avgDifficulty" }));
    expect(out.data.points[1]).toEqual({ periodStart: "2026-09-02", avgDifficulty: null });
    expect(out.unknowns).toEqual({ "data.points.1.avgDifficulty": "unmeasured" });
  });

  it("names the valid paths when asked for one that does not exist", () => {
    expect(() => applyShape(body(), shape({ sort: "transactions.total" }))).toThrow(
      /one of blocks, avgDifficulty, avgBlockBytes/,
    );
    expect(() => applyShape(body(), shape({ fields: "nope" }))).toThrow(/fields: no field nope/);
  });

  it("ranks nested paths and cross-chain groups", () => {
    const groups = {
      data: {
        groupBy: "chain",
        groups: [
          { key: "BTC", in: { transfers: 3, zat: 50 } },
          { key: "ETH", in: { transfers: 9, zat: 10 } },
        ],
      },
      unknowns: {},
    };
    const out = applyShape(groups, shape({ sort: "in.zat", top: "1" }));
    expect(out.data.groups.map((g) => g.key)).toEqual(["BTC"]);
  });
});
