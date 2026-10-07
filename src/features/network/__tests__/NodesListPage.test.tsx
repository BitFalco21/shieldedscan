import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fixtureDataSource } from "@/data/fixture-source";
import { networkNodesHref } from "../nodes/networkNodesHref";
import { NodesListPage } from "../nodes/NodesListPage";
import { timeAgo } from "@/lib/format";

/**
 * The node list. Pinned: the sentence prints the page's echoed filter and its denominator, one
 * row per item, every chip and menu link carries the other filter, paging hrefs are built from
 * the same builder, and nothing on the page is an address or an inline style.
 */

const summary = await fixtureDataSource.getNetworkSummary();
const health = await fixtureDataSource.getNetworkHealth();
const hosting = health.concentration.topAsns.map((a) => ({
  asn: a.asn,
  org: a.org,
  count: a.numerator,
}));

async function renderPage(filters: { client: string | null; asn: number | null }) {
  const page = await fixtureDataSource.listNetworkNodes({ limit: 25 }, filters);
  const utils = render(
    <NodesListPage
      page={page}
      clients={summary.clients}
      hostingNetworks={hosting}
      now={summary.asOf}
      windowSeconds={summary.windowSeconds}
      newerHref={
        page.prevCursor
          ? networkNodesHref(page.applied, { name: "after", value: page.prevCursor })
          : null
      }
      olderHref={
        page.nextCursor
          ? networkNodesHref(page.applied, { name: "before", value: page.nextCursor })
          : null
      }
      newestHref={null}
      oldestHref={null}
    />,
  );
  return { page, ...utils };
}

describe("networkNodesHref", () => {
  it("omits null filters, carries set ones, and appends a cursor", () => {
    expect(networkNodesHref({ client: null, asn: null })).toBe("/network/nodes");
    expect(networkNodesHref({ client: "Zebra", asn: null })).toBe("/network/nodes?client=Zebra");
    expect(networkNodesHref({ client: "Zebra", asn: 14061 }, { name: "before", value: "c1" })).toBe(
      "/network/nodes?client=Zebra&asn=14061&before=c1",
    );
  });
});

describe("NodesListPage", () => {
  it("states the total and one row per item on the unfiltered page", async () => {
    const { page, container } = await renderPage({ client: null, asn: null });
    const found = container.querySelector(".net-found")!;
    expect(found.textContent).toContain(`A total of ${page.total} nodes found`);
    expect(found.textContent).not.toContain("· of");
    expect(container.querySelectorAll("tbody tr")).toHaveLength(page.items.length);
    expect(page.items).toHaveLength(25);
  });

  it("dates each row by when it LAST answered, never by when our crawler first saw it", async () => {
    // Rows are dated by when the node last answered, not "first seen", which would mostly
    // reflect when our crawler started.
    const { page, container } = await renderPage({ client: null, asn: null });
    const headers = [...container.querySelectorAll("thead th")].map((th) => th.textContent);
    expect(headers).toContain("last seen");
    expect(headers).not.toContain("first seen");
    const row = page.items.find((r) => r.lastReachable !== r.firstSeen)!;
    const cells = container.querySelectorAll(
      `tbody tr:nth-child(${page.items.indexOf(row) + 1}) td`,
    );
    expect(cells[cells.length - 1]!.textContent).toBe(timeAgo(row.lastReachable, summary.asOf));
  });

  it("prints the echoed filter with its denominator, and the rows match it", async () => {
    const { page, container } = await renderPage({ client: "Zakura", asn: null });
    const found = container.querySelector(".net-found")!;
    expect(found.textContent).toContain(`A total of ${page.total} Zakura nodes found`);
    expect(found.textContent).toContain(`· of ${page.denominator}`);
    for (const tr of container.querySelectorAll("tbody tr")) {
      expect(tr.textContent).toContain("Zakura");
    }
  });

  it("names the hosting network in the sentence and lists it as current in the menu", async () => {
    const { container } = await renderPage({ client: null, asn: 14061 });
    expect(container.querySelector(".net-found")!.textContent).toContain("hosted on DigitalOcean");
    const menu = screen.getByRole("navigation", { name: "Filter by hosting network" });
    const current = within(menu)
      .getAllByRole("link")
      .find((l) => l.getAttribute("aria-current") === "page");
    expect(current?.textContent).toContain("DigitalOcean");
  });

  it("every chip carries the hosting filter and every menu link carries the software filter", async () => {
    await renderPage({ client: "Zebra", asn: 14061 });
    const chips = screen.getByRole("navigation", { name: "Filter by software" });
    for (const link of within(chips).getAllByRole("link")) {
      expect(link.getAttribute("href")).toContain("asn=14061");
    }
    const menu = screen.getByRole("navigation", { name: "Filter by hosting network" });
    for (const link of within(menu).getAllByRole("link")) {
      expect(link.getAttribute("href")).toContain("client=Zebra");
    }
    const all = within(chips).getByRole("link", { name: "all" });
    expect(all.getAttribute("href")).toBe("/network/nodes?asn=14061");
  });

  it("paging hrefs carry the filter, so a page turn never widens the list", async () => {
    const { page } = await renderPage({ client: "Zebra", asn: null });
    expect(page.nextCursor).toBeNull(); // 21 Zebra rows fit one page
    const { page: all } = await renderPage({ client: null, asn: null });
    expect(all.nextCursor).not.toBeNull();
    const older = screen.getAllByRole("link", { name: /Older page/ }).pop()!;
    expect(older.getAttribute("href")).toContain("before=");
  });

  it("an honest empty page for a well-formed client nobody runs", async () => {
    const { container } = await renderPage({ client: "Zippy", asn: null });
    expect(container.querySelector(".net-found")!.textContent).toContain(
      "A total of 0 Zippy nodes found",
    );
    expect(container.querySelectorAll("tbody tr")).toHaveLength(0);
    expect(container.textContent).toContain("No answering node matches this filter");
  });

  it("carries no inline style and no address-shaped string", async () => {
    const { container } = await renderPage({ client: null, asn: null });
    expect(container.innerHTML).not.toMatch(/\sstyle=/);
    expect(container.innerHTML).not.toMatch(/\b\d{1,3}(\.\d{1,3}){3}\b/);
  });
});
