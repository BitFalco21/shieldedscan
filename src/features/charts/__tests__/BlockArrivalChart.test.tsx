import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { getBlockArrival } from "@/fixtures/block-arrival";
import { BlockArrivalChart } from "../BlockArrivalChart";
import { chartData } from "../chart-data";
import { chartTable } from "../chart-table";

describe("BlockArrivalChart", () => {
  const series = getBlockArrival();
  const table = chartTable("block-arrival-age", chartData({ blockArrival: series }), "all")!;

  it("draws a pool's negative median as measured, and names the pools too thin to state", () => {
    const { container } = render(<BlockArrivalChart series={series} table={table} />);
    const text = container.textContent ?? "";
    expect(text).toContain("KuPool");
    expect(text).toMatch(/−\d+ s/);
    expect(text).toContain("Not clock skew");
    expect(container.innerHTML).not.toMatch(/\sstyle=/);
    expect(container.innerHTML).not.toMatch(/\sid=/);
  });

  it("keeps every day in the CSV, the partial one marked", () => {
    expect(table.rows).toHaveLength(series.days.length);
    const partial = table.columns.indexOf("partial");
    expect(table.rows.at(-1)![partial]).toBe(1);
    expect(table.columns).toContain("f2pool_median_s");
  });
});
