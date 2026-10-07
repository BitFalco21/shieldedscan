import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
// A test may read the fixture modules directly; app code never does.
import { getChainInfo, getSupplyBreakdown } from "@/fixtures";
import { formatZecWhole } from "@/lib/format";
import { CLAIMS } from "../claims";
import { FactCheckPage } from "../FactCheckPage";
import { VerdictTag } from "../VerdictTag";

const supply = getSupplyBreakdown();
const chain = getChainInfo();

describe("FactCheckPage", () => {
  it("renders one h1, a heading per group and an anchored article per claim", () => {
    render(<FactCheckPage supply={supply} chain={chain} />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    // Direct selectors, not role queries: twelve role lookups over a page this size ran past
    // the 5 s timeout under the full suite's parallel load.
    expect(document.querySelectorAll("h3")).toHaveLength(CLAIMS.length);
    for (const claim of CLAIMS) {
      const article = document.getElementById(claim.id);
      expect(article, claim.id).not.toBeNull();
      const anchor = article!.querySelector(`h3 a[href="#${claim.id}"]`);
      expect(anchor, claim.id).not.toBeNull();
      expect(anchor!.textContent).toContain(claim.claim.slice(0, 20));
    }
  });

  it("outlines every claim, in page order, as a plain anchor link", () => {
    render(<FactCheckPage supply={supply} chain={chain} />);
    // Two outlines (desktop sidebar, mobile disclosure), each a working menu with scripting off.
    const outlines = document.querySelectorAll('nav[aria-label="Claims on this page"]');
    expect(outlines).toHaveLength(2);
    for (const outline of outlines) {
      const hrefs = Array.from(outline.querySelectorAll("a")).map((a) => a.getAttribute("href"));
      expect(hrefs).toEqual(CLAIMS.map((c) => `#${c.id}`));
    }
    // The outline adds no headings: the page's h3s are the claims and nothing else.
    expect(document.querySelectorAll("nav h1, nav h2, nav h3")).toHaveLength(0);
  });

  it("keeps every claim's sources closed until the reader opens them", () => {
    render(<FactCheckPage supply={supply} chain={chain} />);
    for (const claim of CLAIMS) {
      const sources = document.getElementById(claim.id)!.querySelector("details");
      expect(sources, claim.id).not.toBeNull();
      expect(sources!.open, claim.id).toBe(false);
      // A content disclosure, not a menu: DismissPopovers must not close it on an outside click.
      expect(sources!.hasAttribute("data-popover")).toBe(false);
      expect(sources!.querySelector("summary")!.textContent).toContain(
        `SOURCES · ${claim.sources.length}`,
      );
    }
  });

  it("opens every outbound source in a new tab without a referrer", () => {
    render(<FactCheckPage supply={supply} chain={chain} />);
    const external = Array.from(document.querySelectorAll("a[href^='https://']"));
    expect(external.length).toBeGreaterThan(0);
    for (const a of external) {
      expect(a.getAttribute("rel")).toContain("noreferrer");
      expect(a.getAttribute("target")).toBe("_blank");
    }
  });

  it("states the live figures from the one supply read, with the block they were read at", () => {
    render(<FactCheckPage supply={supply} chain={chain} />);
    const lockbox = supply.pools.find((p) => p.pool === "lockbox")!.balanceZat;
    const entry = document.getElementById("insiders-forever")!;
    // getByText throws when the figure is absent, which is the assertion.
    within(entry).getByText(formatZecWhole(lockbox));
    expect(entry.textContent).toContain(`at block ${supply.height.toLocaleString("en-US")}`);
    // The 24-hour share names its denominator and the coinbase exclusion.
    const usage = document.getElementById("nobody-shields")!;
    expect(usage.textContent).toContain(
      `of ${chain.txCount24h!.toLocaleString("en-US")} transactions`,
    );
    expect(usage.textContent).toContain("coinbase excluded");
  });

  it("keeps every answer when the reads fail, and says unavailable rather than inventing a figure", () => {
    render(<FactCheckPage supply={null} chain={null} />);
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(CLAIMS.length);
    const liveRows = CLAIMS.filter((c) => c.live?.length).length;
    expect(screen.getAllByText("unavailable").length).toBeGreaterThanOrEqual(liveRows);
    // Never a zero standing in for an unread balance, and never the Veil for our outage.
    expect(document.body.textContent).not.toMatch(/\b0 ZEC\b/);
    expect(document.querySelector(".redact")).toBeNull();
  });
});

describe("VerdictTag", () => {
  it("keeps the stamp's two weights: FALSE loud, PARTLY TRUE quiet — and neither green", () => {
    const loud = render(<VerdictTag verdict="false" />).container.firstElementChild!;
    expect(loud.firstElementChild!.className).toContain("text-ink-bright");
    const quiet = render(<VerdictTag verdict="partly-true" />).container.firstElementChild!;
    expect(quiet.firstElementChild!.className).toContain("text-ink-dim");
    for (const el of [loud, quiet]) expect(el.innerHTML).not.toMatch(/text-green/);
  });
});
