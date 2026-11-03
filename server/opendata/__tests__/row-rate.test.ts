import { describe, expect, it } from "vitest";
import { RowRate } from "../row-rate";

describe("RowRate", () => {
  const clock = () => {
    let t = 0;
    return { now: () => t, advance: (ms: number) => (t += ms) };
  };

  it("lets a burst through, then waits exactly long enough to hold the rate", () => {
    const c = clock();
    const rate = new RowRate(1_000, 10, c.now);
    expect(rate.take(10_000)).toBe(0); // the whole burst
    expect(rate.take(2_000)).toBe(2_000); // 2,000 rows owed at 1,000/s
    c.advance(2_000);
    expect(rate.take(0)).toBe(0); // repaid
  });

  it("holds the long-run average at the rate, whatever the chunk sizes", () => {
    const c = clock();
    const rate = new RowRate(500, 5, c.now);
    let rows = 0;
    for (let i = 0; i < 200; i++) {
      const chunk = (i % 7) * 300 + 50;
      rows += chunk;
      c.advance(rate.take(chunk));
      c.advance(10); // the chunk's own work
    }
    // Everything beyond the initial burst is paid for in time.
    expect(rows - 500 * 5).toBeLessThanOrEqual((c.now() / 1000) * 500 + 1);
  });

  it("never saves more than the burst during a long rest", () => {
    const c = clock();
    const rate = new RowRate(1_000, 3, c.now);
    expect(rate.take(3_000)).toBe(0);
    c.advance(3_600_000); // an hour of rest
    expect(rate.take(3_000)).toBe(0);
    expect(rate.take(1_000)).toBe(1_000);
  });

  it("refuses limits that would never let a row through", () => {
    expect(() => new RowRate(0, 10)).toThrow();
    expect(() => new RowRate(100, 0)).toThrow();
  });
});
