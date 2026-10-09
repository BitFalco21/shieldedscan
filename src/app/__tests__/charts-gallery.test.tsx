import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { VISIBLE_CHARTS } from "@/features/charts/catalog";
import Page from "../charts/page";

/**
 * The /charts library renders one card per chart this deployment shows, each linking to the
 * chart's own page. Asserted at the page, against the catalogue, so a chart dropped between the
 * two would fail here rather than vanish from the library.
 */
describe("/charts library", () => {
  it("renders a card for every visible chart, linking to its page", async () => {
    const ui = await Page();
    const { container } = render(ui);
    const hrefs = [...container.querySelectorAll("a[href^='/charts/']")].map((a) =>
      a.getAttribute("href"),
    );
    expect(hrefs.sort()).toEqual(VISIBLE_CHARTS.map((c) => `/charts/${c.slug}`).sort());
  });
});
