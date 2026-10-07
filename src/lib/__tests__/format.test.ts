import { describe, expect, it } from "vitest";
import {
  dailyUsdForRows,
  feeUsdAtDay,
  formatBytes,
  formatDeltaPct,
  formatSharePct,
  formatUtc,
  formatZec,
  formatZecCompact,
  shortHash,
  timeAgo,
} from "../format";

describe("formatZec", () => {
  it("formats a typical amount with 2 decimals", () => {
    expect(formatZec(100_000_000)).toBe("1.00 ZEC");
  });

  it("carries all eight decimals — a zatoshi is 1e-8 ZEC and rounding is not our call", () => {
    // A five-decimal cap would print 2,099.516 here and discard 999 zatoshis.
    expect(formatZec(123_456_789)).toBe("1.23456789 ZEC");
    expect(formatZec(209_951_599_526)).toBe("2,099.51599526 ZEC");
  });

  it("keeps round amounts short — precision is shown only where it exists", () => {
    expect(formatZec(100_000_000)).toBe("1.00 ZEC");
    expect(formatZec(150_000_000)).toBe("1.50 ZEC");
  });
});

describe("formatZecCompact", () => {
  it("uses the M suffix at 2 decimals above 1,000,000 ZEC", () => {
    expect(formatZecCompact(250_000_000_000_000)).toBe("2.50M ZEC");
  });

  it("uses the K suffix at 1 decimal between 10,000 and 1,000,000 ZEC", () => {
    expect(formatZecCompact(1_500_000_000_000)).toBe("15.0K ZEC");
  });

  it("passes through to formatZec below 10,000 ZEC", () => {
    expect(formatZecCompact(999_900_000_000)).toBe("9,999.00 ZEC");
  });

  it("pins the current boundary quirk just under the M cutoff (documented, not fixed)", () => {
    // At 999,999 ZEC the K branch still applies (< 1,000,000), and
    // (999999 / 1000).toFixed(1) rounds up to "1000.0" — i.e. the
    // compact format can render "1000.0K ZEC" instead of switching
    // to the M suffix. This test pins that existing behavior as-is.
    expect(formatZecCompact(99_999_900_000_000)).toBe("1000.0K ZEC");
  });
});

describe("shortHash", () => {
  const hash = "ab".repeat(32);

  it("defaults to a 4-char edge on each side", () => {
    expect(shortHash(hash)).toBe("abab…abab");
  });

  it("respects a custom edge length", () => {
    expect(shortHash("0123456789abcdef".repeat(4), 8)).toBe("01234567…89abcdef");
  });
});

describe("timeAgo", () => {
  const now = 1_783_875_480;

  it("formats seconds", () => {
    expect(timeAgo(now - 30, now)).toBe("30s ago");
  });

  it("formats minutes", () => {
    expect(timeAgo(now - 90, now)).toBe("1m ago");
  });

  it("formats hours", () => {
    expect(timeAgo(now - 3661, now)).toBe("1h ago");
  });

  it("formats days", () => {
    expect(timeAgo(now - 90_000, now)).toBe("1d ago");
  });

  it("clamps future timestamps to 0s ago", () => {
    expect(timeAgo(now + 1000, now)).toBe("0s ago");
  });
});

describe("formatBytes", () => {
  it("formats sub-1024 byte counts as bytes", () => {
    expect(formatBytes(500)).toBe("500 B");
  });

  it("formats 1024 and above in kB with 1 decimal", () => {
    expect(formatBytes(2048)).toBe("2.0 kB");
  });

  it("groups the digits of a large kB figure", () => {
    expect(formatBytes(1_000 * 1024)).toBe("1,000.0 kB");
  });

  it("switches to MB, at two decimals, from 1,024 kB — the block that read '1872.7 kB'", () => {
    expect(formatBytes(1024 * 1024)).toBe("1.00 MB");
    expect(formatBytes(Math.round(1872.7 * 1024))).toBe("1.83 MB");
  });

  it("steps up a unit when ROUNDING would reach 1,024, never printing 1,024.0 kB", () => {
    expect(formatBytes(1024 * 1024 - 1)).toBe("1.00 MB");
  });

  it("reaches GB for a very large total", () => {
    expect(formatBytes(3 * 1024 ** 3)).toBe("3.00 GB");
  });
});

describe("formatUtc", () => {
  it("formats a known timestamp as an exact UTC string", () => {
    expect(formatUtc(1_783_875_480)).toBe("2026-07-12 16:58 UTC");
  });
});

describe("formatSharePct", () => {
  it("renders an ordinary share at one decimal", () => {
    expect(formatSharePct(92.34)).toBe("92.3%");
    expect(formatSharePct(4.75)).toBe("4.8%");
    expect(formatSharePct(100)).toBe("100.0%");
  });

  it("never rounds a real share down to 0.0%", () => {
    // e.g. 271.6 ZEC of a 1,759,746 ZEC pool is 0.0154%; "0.0%" beside a real amount would
    // state a share of zero.
    expect(formatSharePct(0.015_433)).toBe("<0.1%");
    expect(formatSharePct(0.049)).toBe("<0.1%");
  });

  it("keeps the sign when a tiny share is an outflow", () => {
    // A negative term is a real direction here, so it must not collapse to the same string
    // as a tiny inflow — nor to "-0.0%", which `toFixed` would otherwise produce.
    expect(formatSharePct(-0.015_433)).toBe(">-0.1%");
    expect(formatSharePct(-0.049)).toBe(">-0.1%");
  });

  it("still prints 0.0% for a term that is exactly zero", () => {
    // Exactly zero is a measurement, not a rounding artefact, and must stay distinguishable
    // from "smaller than this column can show".
    expect(formatSharePct(0)).toBe("0.0%");
  });

  it("hands anything the column can actually show to toFixed unchanged", () => {
    // The threshold is the display grain, not an arbitrary epsilon: 0.05 is the smallest
    // value that rounds to a visible 0.1%.
    expect(formatSharePct(0.05)).toBe("0.1%");
    expect(formatSharePct(-0.05)).toBe("-0.1%");
  });
});

/**
 * The change formatter. A change is unbounded where a share is not, so one decimal on
 * "2,437.6%" is noise; and a real but tiny movement must never round to a flat "0.0%" beside
 * an arrow claiming a direction.
 */
describe("formatDeltaPct", () => {
  it("gives one decimal below 100% and whole percent above", () => {
    expect(formatDeltaPct(18.24)).toBe("18.2%");
    expect(formatDeltaPct(-4.15)).toBe("4.2%");
    expect(formatDeltaPct(112.6)).toBe("113%");
    expect(formatDeltaPct(2437.6)).toBe("2,438%");
  });

  it("drops the sign, because the caller draws the arrow", () => {
    expect(formatDeltaPct(-50)).toBe(formatDeltaPct(50));
  });

  it("refuses to round a real movement to nothing", () => {
    expect(formatDeltaPct(0.02)).toBe("<0.1%");
    expect(formatDeltaPct(-0.02)).toBe("<0.1%");
  });

  it("keeps an exact zero exact — a measurement, not a rounding artefact", () => {
    expect(formatDeltaPct(0)).toBe("0.0%");
  });
});

describe("dailyUsdForRows", () => {
  const map = {
    "2026-09-10": 100,
    "2026-09-11": 101,
    "2026-09-12": 102,
    "2026-09-13": 103,
    "2019-01-01": 50,
    "2016-10-29": 1,
  };
  const now = Date.UTC(2026, 8, 14, 12) / 1000; // 2026-09-14

  it("keeps only the rows' own days plus the last few days before today", () => {
    const rows = [Date.UTC(2019, 0, 1, 5) / 1000];
    expect(dailyUsdForRows(map, rows, now)).toEqual({
      "2019-01-01": 50,
      "2026-09-11": 101,
      "2026-09-12": 102,
      "2026-09-13": 103,
    });
  });

  it("prices a row identically through the pruned map and the full one", () => {
    const ts = Date.UTC(2019, 0, 1, 5) / 1000;
    const pruned = dailyUsdForRows(map, [ts], now);
    expect(feeUsdAtDay(1_000_000, ts, pruned, 999, now)).toBe(
      feeUsdAtDay(1_000_000, ts, map, 999, now),
    );
  });
});
