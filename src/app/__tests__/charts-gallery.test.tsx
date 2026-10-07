import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { COMPACT_TICK_FONT } from "@/components/chart-axes";
import Page from "../charts/page";

/**
 * The /charts gallery renders every chart compact: each card is about half the content
 * column, so base-size ticks would render at ~5.5px. Asserted at the page, because a prop
 * dropped downstream would still render without error.
 */
describe("/charts gallery axes", () => {
  it("renders every chart's ticks at the compact size", async () => {
    const ui = await Page();
    const { container } = render(ui);
    const fonts = [...container.querySelectorAll("text.chart-tick")].map((t) =>
      t.getAttribute("font-size"),
    );
    expect(fonts.length).toBeGreaterThan(0);
    expect(new Set(fonts)).toEqual(new Set([String(COMPACT_TICK_FONT)]));
  });
});
