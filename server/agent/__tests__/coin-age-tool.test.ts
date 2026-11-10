import { describe, expect, it } from "vitest";
import { coinAgeTotalZat } from "@/domain/coin-age";
import { getCoinAge } from "@/fixtures/coin-age";
import { formatZecAmount } from "@/lib/format";
import { AgentTools } from "../tools";
import { FIXTURE_NOW_MS, makeChain, makeV1 } from "../testing/fixture-world";

/**
 * Zeno and transparent coin age: the last year by default, the window asked for, and all of
 * history when asked for — never a year presented as all of it.
 */

const dispatch = async (args: Record<string, unknown>) =>
  (
    await new AgentTools(makeV1(), makeChain(), () => FIXTURE_NOW_MS).dispatch(
      "chain_activity",
      JSON.stringify({ mode: "coin-age", ...args }),
    )
  ).content;

const dataOf = (content: string) =>
  JSON.parse(content.slice(content.indexOf("</notice>") + 9, content.lastIndexOf("</data>"))) as {
    monthEnds: {
      asOf: string;
      height: number;
      totalZec: string;
      valueZec: Record<string, string>;
      sharePct: Record<string, number>;
    }[];
    monthEndsTotalPoints?: number;
    monthEndsWithheld?: string;
    latest: { asOf: string } | null;
  };

describe("chain_activity 'coin-age'", () => {
  it("reads the last year of month-ends when no window is given", async () => {
    const content = await dispatch({});
    expect(content).toMatch(/^<note source="GET \/v1\/analytics\/coin-age\?from=2025-08-01">/);
  });

  it("reads all of history for allTime, sending no edge", async () => {
    const content = await dispatch({ allTime: true });
    expect(content).toMatch(/^<note source="GET \/v1\/analytics\/coin-age">/);
    // Every month-end since launch was asked for; the model sees the newest, with the true count.
    expect(dataOf(content).monthEndsTotalPoints).toBe(getCoinAge().monthEnds.length);
    expect(getCoinAge().monthEnds[0]!.asOf).toBe("2016-10-31");
  });

  it("hands the model a compact series: each band's ZEC and its share of the point's total", async () => {
    const content = await dispatch({ allTime: true });
    // Served whole it was ~390 KB, read twice a turn.
    expect(new TextEncoder().encode(content).length).toBeLessThan(66 * 1024);
    const data = dataOf(content);
    expect(data.monthEndsWithheld).toMatch(/most recent of/);
    expect(data.latest).not.toBeNull();
    const want = getCoinAge().monthEnds.at(-1)!;
    const got = data.monthEnds.at(-1)!;
    const total = coinAgeTotalZat(want);
    expect([got.asOf, got.height, got.totalZec]).toEqual([
      want.asOf,
      want.height,
      formatZecAmount(total),
    ]);
    for (const band of want.bands) {
      expect(got.valueZec[band.key]).toBe(formatZecAmount(band.valueZat));
      expect(got.sharePct[band.key]).toBe(Math.round((band.valueZat / total) * 10_000) / 100);
    }
    // The note says what the share is a share of.
    expect(content).toMatch(/sharePct[^]*OF THAT POINT'S `totalZec`/);
    expect(content).not.toMatch(/"outputs"|"numerator"|"denominator"|"zat"/);
  });

  it("refuses allTime beside a window", async () => {
    expect(await dispatch({ allTime: true, from: "2025-01-01" })).toMatch(/not both/);
    expect(await dispatch({ allTime: true, lastDays: 30 })).toMatch(/not both/);
  });
});
