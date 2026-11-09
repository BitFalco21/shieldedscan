import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { OrphanRateSeries } from "@/domain";
import { ORPHAN_RATE_DAYS } from "@/domain";
import { OrphanRateChart } from "../OrphanRateChart";

const DAY = 86_400;
const TODAY = Date.UTC(2026, 10, 9) / 1000;

/** Five observed days, observation beginning mid-day on the first, read at today's noon. */
const series: OrphanRateSeries = {
  observingSince: TODAY - 4 * DAY + 6 * 3_600,
  asOf: TODAY + 12 * 3_600,
  upgrade: { name: "NU7", height: 3_543_405, activatedAt: TODAY - 2 * DAY + 9_242 },
  days: [
    { timestamp: TODAY - 4 * DAY, orphans: 1, blocks: 900, partial: true },
    { timestamp: TODAY - 3 * DAY, orphans: 3, blocks: 1_150, partial: false },
    { timestamp: TODAY - 2 * DAY, orphans: 0, blocks: 3_000, partial: false },
    { timestamp: TODAY - DAY, orphans: 7, blocks: 3_456, partial: false },
    { timestamp: TODAY, orphans: 2, blocks: 1_700, partial: true },
  ],
  windows: [
    {
      key: "24h",
      orphans: 4,
      blocks: 3_450,
      firstBlockAt: TODAY - DAY / 2,
      lastBlockAt: TODAY + 43_100,
    },
    {
      key: "7d",
      orphans: 13,
      blocks: 10_206,
      firstBlockAt: TODAY - 4 * DAY + 21_700,
      lastBlockAt: TODAY + 43_100,
    },
    {
      key: "30d",
      orphans: 13,
      blocks: 10_206,
      firstBlockAt: TODAY - 4 * DAY + 21_700,
      lastBlockAt: TODAY + 43_100,
    },
    {
      key: "before-upgrade",
      orphans: 4,
      blocks: 2_200,
      firstBlockAt: TODAY - 4 * DAY + 21_700,
      lastBlockAt: TODAY - 2 * DAY + 9_200,
    },
    { key: "since-upgrade", orphans: 0, blocks: 0, firstBlockAt: null, lastBlockAt: null },
  ],
};

describe("OrphanRateChart", () => {
  it("states every window's counts beside its rate", () => {
    render(<OrphanRateChart series={series} />);
    expect(screen.getByText("LAST 24 HOURS")).toBeDefined();
    expect(screen.getByText("0.12%")).toBeDefined();
    expect(screen.getByText(/4 orphans · 3,450 blocks/)).toBeDefined();
    // The 24h tile names the span it covers.
    expect(screen.getByText(/11-08 12:00 – 11-09 11:58 UTC/)).toBeDefined();
    // A window shorter than its label says where it starts.
    expect(screen.getAllByText(/from 2026-11-05/).length).toBeGreaterThan(0);
    expect(screen.getByText("BEFORE NU7")).toBeDefined();
  });

  it("never prints a rate over no blocks", () => {
    render(<OrphanRateChart series={series} />);
    expect(screen.getByText("SINCE NU7")).toBeDefined();
    expect(screen.getByText("no blocks")).toBeDefined();
    expect(screen.getByText(/0 orphans · 0 blocks/)).toBeDefined();
  });

  it("draws one bar a day, leaves unobserved days empty and marks the upgrade and today", () => {
    const { container } = render(<OrphanRateChart series={series} />);
    // The zero day draws no bar; the other four do.
    expect(container.querySelectorAll("rect.chart-band")).toHaveLength(4);
    expect(container.querySelector(".chart-marker-label")?.textContent).toBe("NU7");
    expect(screen.getByText("so far")).toBeDefined();
    expect(ORPHAN_RATE_DAYS - series.days.length).toBeGreaterThan(0);
    expect(screen.getByText("not yet observed")).toBeDefined();
  });

  it("says the rate is one node's view", () => {
    render(<OrphanRateChart series={series} />);
    expect(screen.getByText(/never received is not counted/)).toBeDefined();
  });
});
