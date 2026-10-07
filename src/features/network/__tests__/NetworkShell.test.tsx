import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fixtureDataSource } from "@/data/fixture-source";
import { NetworkShell } from "../NetworkShell";

/**
 * The shell above the tabs, rendered from the fixtures. What is pinned is the page's honesty
 * grammar rather than its figures: the h1 is the crawl's floor, the ours tile is marked and
 * never folded into a crawl count, an unread node is "not read" and never 0, the maturity
 * strip states the unsettled state on a young index, the tabs are links with the current one
 * marked, and no element anywhere carries an inline style.
 */

const summary = await fixtureDataSource.getNetworkSummary();
const crawls = await fixtureDataSource.getNetworkCrawls();
const peers = await fixtureDataSource.getNetworkPeers();

function renderShell(peersArg = peers) {
  return render(
    <NetworkShell summary={summary} crawls={crawls} peers={peersArg} tab="software">
      <p>tab body</p>
    </NetworkShell>,
  );
}

describe("NetworkShell", () => {
  it("states the answering count as the h1 and the known set in the lede", () => {
    renderShell();
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.textContent).toContain(`${summary.reachable} nodes answered our handshake`);
    expect(h1.textContent).toContain("24 hours");
    expect(screen.getByText(/addresses the network has ever advertised/).textContent).toContain(
      summary.known.toLocaleString("en-US"),
    );
  });

  it("marks our node's peers as OURS and never lets them read as a crawl figure", () => {
    const { container } = renderShell();
    const ours = container.querySelector('[data-basis="ours"]')!;
    expect(ours).not.toBeNull();
    expect(ours.textContent).toContain("peers on our node");
    expect(ours.textContent).toContain("ours");
    expect(ours.textContent).toContain(`${peers!.count}`);
    expect(ours.textContent).toContain("not the crawl");
    const floors = container.querySelectorAll('[data-basis="floor"]');
    expect(floors).toHaveLength(4);
    for (const tile of floors) expect(tile.textContent).not.toContain(`${peers!.count}`);
  });

  it("prints 'not read' for an unread node — never a count of zero", () => {
    const { container } = renderShell(null);
    const ours = container.querySelector('[data-basis="ours"]')!;
    expect(ours.textContent).toContain("not read");
    expect(ours.textContent).not.toMatch(/\b0\b/);
  });

  it("reads the young fixture index as maturing, on a track towards day seven", () => {
    renderShell();
    const strip = screen.getByRole("status", { name: "" });
    expect(strip.getAttribute("data-settled")).toBe("false");
    expect(strip.textContent).toContain("index maturing");
    expect(strip.textContent).toMatch(/day 1 of 7/);
    expect(strip.textContent).toMatch(/still finding/);
  });

  it("renders the six tabs as links and marks the current one", () => {
    renderShell();
    const nav = screen.getByRole("navigation", { name: "Network" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual([
      "/network",
      "/network/map",
      "/network/software",
      "/network/upgrade",
      "/network/health",
      "/network/nodes",
    ]);
    expect(links.find((l) => l.getAttribute("aria-current") === "page")?.textContent).toBe(
      "software",
    );
  });

  it("captions the sparkline with the true crawl count and says the drawing is capped", () => {
    const { container } = renderShell();
    const caption = container.querySelector(".net-sparkline-box")!.textContent!;
    expect(caption).toContain(`${crawls.total} crawls`);
    expect(caption).toContain("newest 61 drawn");
    expect(container.querySelector(".net-sparkline")?.getAttribute("aria-label")).toContain(
      `${crawls.crawls[crawls.crawls.length - 1]!.reachable} answered`,
    );
  });

  it("carries no inline style and no address-shaped string", () => {
    const { container } = renderShell();
    expect(container.innerHTML).not.toMatch(/\sstyle=/);
    expect(container.innerHTML).not.toMatch(/\b\d{1,3}(\.\d{1,3}){3}\b/);
  });
});
