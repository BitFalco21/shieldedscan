import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
// A test may read the fixture module directly; app code never does.
import { getZipIndex } from "@/fixtures/zips";
import { ZipsPage } from "../ZipsPage";

const index = getZipIndex();

describe("ZipsPage", () => {
  it("renders all four sections in order, and the retired one collapsed", () => {
    render(<ZipsPage index={index} />);
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings.join(" ")).toMatch(/in force.*proposed.*draft.*withdrawn/i);
    const retired = document.querySelector("details");
    expect(retired).not.toBeNull();
    expect(retired!.open).toBe(false);
  });

  it("links every row to its canonical zips.z.cash page, derived from the number", () => {
    render(<ZipsPage index={index} />);
    const links = Array.from(document.querySelectorAll("a[href^='https://']"));
    expect(links.length).toBeGreaterThan(0);
    for (const a of links) {
      expect(a.getAttribute("href")).toMatch(/^https:\/\/zips\.z\.cash\/zip-\d{4}$/);
      expect(a.getAttribute("rel")).toContain("noreferrer");
    }
    // ZIP 213 specifically: zero-padded.
    expect(links.some((a) => a.getAttribute("href") === "https://zips.z.cash/zip-0213")).toBe(true);
  });

  it("renders the multi-revision status WHOLE, and an unrecognised status verbatim", () => {
    render(<ZipsPage index={index} />);
    expect(
      screen.getByText(
        /\[Revision 0: Canopy, Revision 1: NU6\] Final, \[Revision 2: NU6\.1\] Proposed/,
      ),
    ).toBeDefined();
    expect(screen.getByText("Percolating")).toBeDefined();
  });

  it("states its source and the instant the index was read", () => {
    render(<ZipsPage index={index} />);
    const foot = screen.getByText(/github\.com\/zcash\/zips/);
    expect(foot.textContent).toMatch(/index read .*UTC/i);
  });

  it("says the list is numbered ZIPs only", () => {
    render(<ZipsPage index={index} />);
    expect(screen.getByText(/numbered ZIPs only/i)).toBeDefined();
  });

  it("shows each ZIP's proposal date, and an empty cell where the header has none", () => {
    render(<ZipsPage index={index} />);
    // Every table carries the CREATED column.
    const createdHeaders = screen.getAllByRole("columnheader", { name: /created/i });
    expect(createdHeaders.length).toBeGreaterThan(0);
    // ZIP 213's real Created date renders in its row.
    const row213 = screen.getByText("Shielded Coinbase").closest("tr")!;
    expect(within(row213).getByText("2019-03-30")).toBeDefined();
    // Reserved zip-0002 has no Created in its real header — empty cell, never a dash.
    const row2 = screen.getByText("Design Considerations for Network Upgrades").closest("tr")!;
    for (const cell of within(row2).getAllByRole("cell")) {
      expect(cell.textContent).not.toBe("—");
    }
  });

  it("marks every title as an outbound link that opens a new tab, in the site's own arrow", () => {
    render(<ZipsPage index={index} />);
    const link = screen.getByText("Shielded Coinbase").closest("a")!;
    expect(link.getAttribute("target")).toBe("_blank");
    // The same ↗ the footer and cross-chain pages already ship — a glyph this font is
    // known to carry — decorative to a screen reader, which gets the words instead.
    const arrow = link.querySelector("[aria-hidden]");
    expect(arrow?.textContent).toBe("↗");
    expect(link.textContent).toMatch(/opens (in )?a new tab/i);
    // The visible title is still the TITLE: nothing an eye reads is the arrow's words.
    expect(link.querySelector(".sr-only")?.textContent).toMatch(/new tab/i);
  });

  it("renders an empty category as an empty cell, never a dash", () => {
    render(<ZipsPage index={index} />);
    const row = screen.getByText("A future protocol idea").closest("tr")!;
    const cells = within(row).getAllByRole("cell");
    // No em dash standing in for nothing.
    for (const cell of cells) expect(cell.textContent).not.toBe("—");
  });
});

describe("ZipsPage sort toggle", () => {
  // First data row of the FIRST (in force) table, identified by its canonical href.
  const firstRowHref = () => document.querySelector("table tbody tr a")?.getAttribute("href") ?? "";

  it("defaults to number order — ZIP 0 leads the in-force section", () => {
    render(<ZipsPage index={index} />);
    expect(firstRowHref()).toBe("https://zips.z.cash/zip-0000");
  });

  it("NEWEST reorders by Created date within each section", () => {
    render(<ZipsPage index={index} />);
    fireEvent.click(screen.getByRole("button", { name: /newest/i }));
    // In-force fixture dates: 214=2020-02-28 is the most recent.
    expect(firstRowHref()).toBe("https://zips.z.cash/zip-0214");
    // The buttons announce their state, never colour alone.
    expect(screen.getByRole("button", { name: /newest/i }).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("OLDEST puts the earliest first, and an undated row never pretends an age", () => {
    render(<ZipsPage index={index} />);
    fireEvent.click(screen.getByRole("button", { name: /oldest/i }));
    expect(firstRowHref()).toBe("https://zips.z.cash/zip-0200");
    // Draft section holds undated zip-0002 (Reserved) — it must be the LAST row of its
    // table under a date order, not the first of "oldest".
    const draftTable = screen.getByText("25-second Block Target Spacing").closest("table")!;
    const hrefs = Array.from(draftTable.querySelectorAll("tbody a")).map((a) =>
      a.getAttribute("href"),
    );
    expect(hrefs.indexOf("https://zips.z.cash/zip-0002")).toBeGreaterThan(0);
    expect(hrefs.at(-1)).not.toBe("https://zips.z.cash/zip-0218");
  });
});

describe("ZipsPage section menu", () => {
  it("lists every rendered section as an anchor link, and each anchor resolves to a section id", () => {
    render(<ZipsPage index={index} />);
    // The desktop sidebar and the mobile disclosure both render the nav; take the first.
    const nav = screen.getAllByRole("navigation", { name: /zip sections/i })[0]!;
    const links = Array.from(nav.querySelectorAll("a[href^='#']"));
    expect(links.length).toBe(4);
    for (const a of links) {
      const id = a.getAttribute("href")!.slice(1);
      expect(document.getElementById(id), `#${id} has a target`).not.toBeNull();
    }
    // Labels carry the section's name and its count, so the menu is a table of contents,
    // not a bare list of words.
    expect(links.map((a) => a.textContent)).toEqual(
      expect.arrayContaining([expect.stringMatching(/in force/i), expect.stringMatching(/draft/i)]),
    );
    expect(nav.textContent).toMatch(/\d/);
  });
});
