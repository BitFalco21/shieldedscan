import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { RichListSummary } from "@/domain";
import { getRichListSummary, listRichList } from "@/fixtures/rich-list";
import { RichListPage } from "../RichListPage";

/**
 * The rich list.
 *
 * The tests worth having are about the claims, not the layout: that shares name the
 * denominator they were computed against, that a real holding is never rounded to nothing,
 * that no address is labelled unless someone published it, and that the excluded value is
 * stated rather than folded in.
 */

const summary = getRichListSummary();
const entries = listRichList({ limit: 50 }).items;

const renderAt = (over: Partial<RichListSummary> = {}, priceUsd: number | null = 42) =>
  render(
    <RichListPage
      entries={entries}
      priceUsd={priceUsd}
      summary={{ ...summary, ...over }}
      newerHref={null}
      olderHref="/rich-list?before=x"
      newestHref={null}
      oldestHref="/rich-list?after=y"
    />,
  );

describe("the figures", () => {
  it("states the denominator every share is a share of", () => {
    // A bare percentage would be read against circulating supply, a third larger than the
    // transparent total these use. Stated in the footer, so it survives the top-100 card being
    // hidden on a small chain.
    renderAt({ addressCount: 24 });
    expect(screen.getByText(/Every share is of the transparent total/)).toBeDefined();
  });

  it("prints the height the balances were computed at", () => {
    // The view refreshes hourly. Naming the height makes that staleness visible.
    renderAt();
    expect(screen.getByText(/at block 3,445,548/)).toBeDefined();
  });

  it("never rounds a real holding to zero", () => {
    // `formatZecWhole` alone renders 0.42 ZEC as "0 ZEC" — a real balance displayed as
    // nothing, the same failure as a 0.0% share beside a visible amount.
    const { container } = renderAt();
    const balances = [...container.querySelectorAll("tbody tr")]
      .map((row) => row.querySelectorAll("td")[2]?.textContent ?? "")
      .filter(Boolean);

    expect(balances.length).toBeGreaterThan(0);
    expect(balances).not.toContain("0 ZEC");
  });

  it("draws each share bar to its exact proportion, never snapped to a cell", () => {
    // The bargraph's cells are a SCALE — seams laid over a continuous fill — so the
    // quantisation must live in the ruler and never in the value. One cell is 2.5% of a
    // 400-unit track, i.e. 10 units; if a fill were ever snapped to the grid, every width
    // here would be a multiple of 10. Asserted as a property over the whole panel rather
    // than against one golden number, so it holds whatever the fixture bands become.
    const { container } = renderAt();
    const fills = [...container.querySelectorAll("tbody svg > rect:nth-of-type(2)")].map((r) =>
      Number(r.getAttribute("width")),
    );

    expect(fills.length).toBeGreaterThan(0);
    expect(fills.every((w) => Number.isFinite(w))).toBe(true);
    // A band holding something is never drawn as nothing, and never wider than the track.
    expect(fills.every((w) => w > 0 && w <= 400)).toBe(true);
    // At least one fill lands off the cell grid — proof the fill is the real proportion.
    expect(fills.some((w) => w % 10 !== 0)).toBe(true);
  });

  it("states the value that belongs to no single address", () => {
    // The difference between this page's total and the node's transparent value pool. 0.006%,
    // and named rather than rounded away.
    renderAt();
    expect(screen.getByText(/outputs naming no single address/)).toBeDefined();
  });
});

describe("the NAME TAG column", () => {
  const bodyRows = (container: HTMLElement) => {
    // The LAST table on the page: the first is the distribution, which has no links.
    const tables = container.querySelectorAll<HTMLTableElement>("table");
    return Array.from(tables[tables.length - 1]!.querySelectorAll<HTMLTableRowElement>("tbody tr"));
  };
  /** The NAME TAG cell of a row, found by the header's position rather than a hard index. */
  const nameTagCell = (container: HTMLElement, row: HTMLTableRowElement) => {
    const tables = container.querySelectorAll<HTMLTableElement>("table");
    const headers = Array.from(tables[tables.length - 1]!.querySelectorAll("thead th"));
    const at = headers.findIndex((h) => h.textContent?.trim() === "NAME TAG");
    expect(at, "the table has a NAME TAG column").toBeGreaterThan(-1);
    return row.querySelectorAll("td")[at]!;
  };

  it("names the addresses somebody has attributed", () => {
    const { container } = renderAt();
    const named = bodyRows(container).map((r) => nameTagCell(container, r).textContent?.trim());
    expect(named).toContain("Gemini Cold Wallet");
    expect(named).toContain("Binance Cold Wallet");
  });

  it("leaves the cell empty for an address nobody has named, rather than guessing", () => {
    // An em dash or a repeat of the address would be noise on the ~843,000 rows that have
    // no name. Silence is the honest rendering of "nobody has attributed this".
    const { container } = renderAt();
    const unlabelled = bodyRows(container).find((r) =>
      within(r).getByRole("link").getAttribute("title")?.startsWith("t1FixtureRichAddr"),
    )!;
    expect(nameTagCell(container, unlabelled).textContent?.trim()).toBe("");
    // No tag icon standing beside nothing.
    expect(nameTagCell(container, unlabelled).querySelector("[data-label-icon]")).toBeNull();
  });

  it("puts the tag icon before every name", () => {
    const { container } = renderAt();
    const named = bodyRows(container)
      .map((r) => nameTagCell(container, r))
      .filter((cell) => cell.textContent?.trim());
    expect(named.length).toBeGreaterThan(0);
    for (const cell of named) {
      const tag = cell.firstElementChild;
      expect(tag?.firstElementChild?.hasAttribute("data-label-icon"), cell.textContent ?? "").toBe(
        true,
      );
    }
  });

  it("states the name once — the ADDRESS cell keeps showing the address", () => {
    // With a column of its own, the name beside the address too would be one fact twice.
    const { container } = renderAt();
    const labelled = bodyRows(container).find(
      (r) => nameTagCell(container, r).textContent?.trim() === "Binance Cold Wallet",
    )!;
    const addressCell = labelled.querySelectorAll("td")[1]!;
    expect(within(addressCell).getByRole("link").getAttribute("title")).toMatch(/^t[13]/);
    expect(addressCell.textContent).not.toContain("Binance");
  });

  it("is a desktop column, so a phone keeps the table it already had", () => {
    // At 375px a visible name column wraps to three lines and pushes SHARE behind a sideways
    // scroll. USD and TXNS are hidden there for the same reason.
    const { container } = renderAt();
    const row = bodyRows(container)[0]!;
    expect(nameTagCell(container, row).className).toContain("hidden");
    expect(nameTagCell(container, row).className).toContain("sm:table-cell");
  });

  it("makes no claim the labels cannot support", () => {
    // The footer must not claim labels come only from their owners: the names are third-party.
    const { container } = renderAt();
    expect(container.textContent).not.toMatch(/unless its owner published/i);
  });

  it("takes the name from the ADDRESS, not from anything the API sent", () => {
    // One editorial label table, looked up by address: `RichListEntry` carries no label field,
    // so whatever name renders came from the address, not from the wire.
    render(
      <RichListPage
        entries={entries}
        priceUsd={42}
        summary={summary}
        newerHref={null}
        olderHref={null}
        newestHref={null}
        oldestHref={null}
      />,
    );
    expect(screen.getAllByText("Binance Cold Wallet").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Gemini Cold Wallet").length).toBeGreaterThan(0);
  });

  it("never prints the basis or the source", () => {
    // The labelling basis is recorded per entry, not rendered.
    const { container } = renderAt();
    expect(container.textContent).not.toMatch(/third-party|self-declared|arkm/i);
  });
});

describe("the top-100 card", () => {
  it("is hidden when there are not yet 100 addresses", () => {
    // Otherwise it reads "100.0% of transparent value" — true, and telling a reader nothing.
    // Reachable on a young testnet chain, not only in fixtures.
    renderAt({ addressCount: 24 });
    expect(screen.queryByText("TOP 100 HOLD")).toBeNull();
  });

  it("appears once there are", () => {
    renderAt({ addressCount: 843_103 });
    expect(screen.getByText("TOP 100 HOLD")).toBeDefined();
  });
});

describe("the distribution", () => {
  it("bands every address exactly once", () => {
    const banded = summary.bands.reduce((sum, b) => sum + b.addresses, 0);
    expect(banded).toBe(summary.addressCount);
  });

  it("bands every zatoshi exactly once", () => {
    const banded = summary.bands.reduce((sum, b) => sum + b.totalZat, 0);
    expect(banded).toBe(summary.totalZat);
  });
});

describe("the columns", () => {
  it("prices a balance in dollars, because a transparent balance is genuinely public", () => {
    // The rule this satisfies rather than bends: a USD figure may sit only beside a public ZEC
    // amount. A transparent balance is exactly that — `sum(outputs) − sum(inputs)`, arithmetic
    // over public data — so converting it asserts nothing the chain does not already say.
    renderAt();
    expect(screen.getByRole("columnheader", { name: "USD" })).toBeDefined();
  });

  it("drops the dollar column entirely when there is no price, rather than emptying it", () => {
    // Null is both an outage and the permanent answer on testnet, where TAZ has no market. A
    // header over a column of blanks reads as a chart that failed to draw, and a dollar sign
    // beside a testnet amount would price the worthless.
    renderAt({}, null);
    expect(screen.queryByRole("columnheader", { name: "USD" })).toBeNull();
    // The balance it would have priced is still there — the column went, not the fact.
    expect(screen.getByRole("columnheader", { name: "BALANCE" })).toBeDefined();
  });

  it("counts the transactions an address appears in", () => {
    renderAt();
    expect(screen.getByRole("columnheader", { name: "TXNS" })).toBeDefined();
  });

  it("renders an uncounted address as unknown, never as zero", () => {
    // Every row is in this state until `repair-tx-count` reaches it. An address in this table
    // has been in at least one transaction by construction, so a `0` here would be false.
    const { container } = renderAt();
    const rows = [...container.querySelectorAll("tbody tr")];
    const cells = rows.map((r) => [...r.querySelectorAll("td")].at(-1)?.textContent ?? "");
    expect(cells.filter((c) => c === "unavailable").length).toBe(1);
    expect(cells).not.toContain("0");
  });

  it("does not carry the removed columns", () => {
    renderAt();
    for (const gone of ["RECEIVED", "FIRST", "LAST"]) {
      expect(screen.queryByRole("columnheader", { name: gone })).toBeNull();
    }
  });
});

describe("column layout", () => {
  it("puts a copy button beside every address, holding the UNTRUNCATED value", () => {
    // The link shows an elision, so copying the displayed text would not hand over an address.
    // Asserting the button count, not just its presence, catches a button rendered once outside
    // the row loop.
    renderAt();
    expect(screen.getAllByRole("button", { name: /copy address/i })).toHaveLength(entries.length);
  });

  it("prints shares to two decimals, never one", () => {
    // A single decimal would collapse distinct bands onto the same printed figure.
    renderAt();
    expect(screen.getAllByText(/^\d+\.\d{2}%$/).length).toBeGreaterThan(0);
    expect(screen.queryAllByText(/^\d+\.\d%$/)).toHaveLength(0);
  });

  it("orders the distribution largest band first", () => {
    // The risk in reversing a list whose label comes from its INDEX is labelling each row with a
    // neighbour's range, so this asserts the label and the figure moved together: the top band's
    // row must carry the top band's own address count.
    renderAt();
    const top = summary.bands[summary.bands.length - 1]!;
    const topRow = screen
      .getAllByRole("row")
      .find((r) => (r.textContent ?? "").includes("100K+ ZEC"));
    expect(topRow).toBeTruthy();
    expect(within(topRow!).getByText(top.addresses.toLocaleString("en-US"))).toBeTruthy();

    // And it must precede the smallest band in document order.
    const text = document.body.textContent ?? "";
    expect(text.indexOf("100K+ ZEC")).toBeGreaterThan(-1);
    expect(text.indexOf("100K+ ZEC")).toBeLessThan(text.indexOf("under 1 ZEC"));
  });
});
