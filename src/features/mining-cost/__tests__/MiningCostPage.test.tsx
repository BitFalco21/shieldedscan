import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { getMiningTerms } from "@/fixtures/mining-terms";
import { MiningCostPage } from "../MiningCostPage";
import { ELECTRICITY_TARIFFS, TARIFF_VALIDATION } from "@/data/electricity";
import { WORLD_MAP_PATHS, WORLD_MAP_POINTS } from "../world-map.generated";

/**
 * The page's honesty claims, rendered:
 *
 * - every tariff row in the committed dataset lands on the map as a path or a point, so no
 *   country the data holds is silently absent;
 * - the break-even, the height, the venue's quarter and the read day all print;
 * - the solution rate is labelled with its basis;
 * - nothing renders as NaN, undefined or Infinity;
 * - no country is called profitable or unprofitable.
 */

const terms = getMiningTerms();

describe("the dataset and the geometry agree", () => {
  it("has a path or a point for every country in the tariff table", () => {
    const missing = ELECTRICITY_TARIFFS.rows
      .filter((r) => !(r.iso3 in WORLD_MAP_PATHS) && !(r.iso3 in WORLD_MAP_POINTS))
      .map((r) => `${r.iso3} ${r.name}`);
    expect(missing, `tariff rows with no geometry:\n${missing.join("\n")}`).toEqual([]);
  });

  it("carries its provenance: source, licence, quarter and read day", () => {
    expect(ELECTRICITY_TARIFFS.source).toBe("GlobalPetrolPrices.com");
    expect(ELECTRICITY_TARIFFS.licence).toMatch(/^CC BY-NC-ND/);
    expect(ELECTRICITY_TARIFFS.quarter).toMatch(/^Q[1-4] 20\d\d$/);
    expect(ELECTRICITY_TARIFFS.readOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(ELECTRICITY_TARIFFS.rows.length).toBeGreaterThan(120);
  });

  it("keys every row by a real ISO 3166-1 alpha-3 code", () => {
    for (const r of ELECTRICITY_TARIFFS.rows) {
      expect(r.iso3, r.name).toMatch(/^[A-Z]{3}$/);
      expect(r.iso2, r.name).toMatch(/^[A-Z]{2}$/);
    }
  });

  it("draws no empty path", () => {
    for (const [iso3, d] of Object.entries(WORLD_MAP_PATHS)) {
      expect(d.length, iso3).toBeGreaterThan(10);
      expect(d.startsWith("M"), iso3).toBe(true);
    }
  });
});

describe("MiningCostPage", () => {
  it("states the break-even tariff, the height and the tariff vintage", () => {
    const { container } = render(
      <MiningCostPage terms={terms} tariffs={ELECTRICITY_TARIFFS} validation={TARIFF_VALIDATION} />,
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(
      /what it costs to mine one zec/i,
    );
    expect(screen.getByText(/break-even electricity price/i)).toBeDefined();
    expect(container.textContent).toContain(terms.height.toLocaleString("en-US"));
    expect(container.textContent).toContain(ELECTRICITY_TARIFFS.quarter);
    expect(container.textContent).toContain(ELECTRICITY_TARIFFS.readOn);
  });

  it("labels the solution rate with where it came from", () => {
    const measured = render(
      <MiningCostPage terms={terms} tariffs={ELECTRICITY_TARIFFS} validation={TARIFF_VALIDATION} />,
    );
    expect(measured.container.textContent).toMatch(/network · node-measured/i);
    measured.unmount();
    const estimated = render(
      <MiningCostPage
        terms={{ ...terms, networkSolps: { value: terms.networkSolps.value, basis: "estimated" } }}
        tariffs={ELECTRICITY_TARIFFS}
        validation={TARIFF_VALIDATION}
      />,
    );
    expect(estimated.container.textContent).toMatch(/network · estimated/i);
  });

  it("renders no NaN, undefined or Infinity anywhere", () => {
    const { container } = render(
      <MiningCostPage terms={terms} tariffs={ELECTRICITY_TARIFFS} validation={TARIFF_VALIDATION} />,
    );
    expect(container.textContent).not.toMatch(/NaN|undefined|Infinity/);
  });

  it("says the real cost is higher and names no country profitable", () => {
    const { container } = render(
      <MiningCostPage terms={terms} tariffs={ELECTRICITY_TARIFFS} validation={TARIFF_VALIDATION} />,
    );
    expect(container.textContent).toMatch(/so the real cost is higher/i);
    expect(container.textContent).not.toMatch(/\bprofitable\b|\bunprofitable\b/i);
  });

  it("with no price, states there is no break-even and keeps the kWh figure", () => {
    const { container } = render(
      <MiningCostPage
        terms={{ ...terms, priceUsd: null }}
        tariffs={ELECTRICITY_TARIFFS}
        validation={TARIFF_VALIDATION}
      />,
    );
    expect(container.textContent).toMatch(/no break-even to state/i);
    expect(container.textContent).toMatch(/energy per zec/i);
    expect(container.textContent).toMatch(/kWh/);
    // No margin column header names a price when there is none.
    expect(container.textContent).not.toMatch(/margin of \$/);
  });

  it("credits the source with a noreferrer link to the page the data was read from", () => {
    render(
      <MiningCostPage terms={terms} tariffs={ELECTRICITY_TARIFFS} validation={TARIFF_VALIDATION} />,
    );
    const link = screen.getByRole("link", { name: ELECTRICITY_TARIFFS.source });
    expect(link.getAttribute("rel")).toContain("noreferrer");
    expect(link.getAttribute("href")).toBe(ELECTRICITY_TARIFFS.sourceUrls[0]);
  });
});

describe("the tariff check is quoted with its day", () => {
  it("prints the Eurostat medians and the day they were measured, never a placeholder", () => {
    render(
      <MiningCostPage terms={terms} tariffs={ELECTRICITY_TARIFFS} validation={TARIFF_VALIDATION} />,
    );
    const p = screen.getByText(/Checked \d{4}-\d{2}-\d{2} against/).textContent ?? "";
    expect(p).toContain(TARIFF_VALIDATION.checkedOn);
    expect(p).toContain(TARIFF_VALIDATION.eurostat.period);
    expect(p).toContain(`${TARIFF_VALIDATION.eurostat.business.medianPct.toFixed(1)}%`);
    expect(p).toContain(`${TARIFF_VALIDATION.eurostat.household.medianPct.toFixed(1)}%`);
    expect(TARIFF_VALIDATION.checkedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(TARIFF_VALIDATION.eurostat.business.countries).toBeGreaterThanOrEqual(15);
  });
});
