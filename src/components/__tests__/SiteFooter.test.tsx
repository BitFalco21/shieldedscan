import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The footer's network toggle, pinned in both directions. A missing toggle is invisible on the
 * page that lacks it, so the mainnet direction must not quietly disappear.
 */

vi.mock("next/navigation", () => ({ usePathname: () => "/blocks" }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function renderFooter(network?: string) {
  if (network) vi.stubEnv("NEXT_PUBLIC_NETWORK", network);
  vi.resetModules();
  const { SiteFooter } = await import("../SiteFooter");
  render(<SiteFooter />);
}

describe("SiteFooter network toggle", () => {
  it("mainnet offers a link TO testnet, carrying the current path", async () => {
    await renderFooter();
    const link = screen.getByRole("link", { name: /testnet/i });
    expect(link.getAttribute("href")).toBe("https://testnet.shieldedscan.xyz/blocks");
  });

  it("testnet offers a link BACK to mainnet", async () => {
    await renderFooter("testnet");
    const link = screen.getByRole("link", { name: /mainnet/i });
    expect(link.getAttribute("href")).toBe("https://shieldedscan.xyz/blocks");
  });

  // Separate tests, not two renders in one: Testing Library's cleanup runs BETWEEN tests,
  // so rendering both footers in a single test leaves the first one in the DOM and the
  // absence assertion finds the other network's link.
  it("mainnet shows donate", async () => {
    await renderFooter();
    expect(screen.queryByRole("link", { name: /donate/i })).not.toBeNull();
  });

  it("testnet hides donate — TAZ is worthless and the address is a mainnet one", async () => {
    // The route 404s there too, so the footer matches reality rather than hiding a live page.
    await renderFooter("testnet");
    expect(screen.queryByRole("link", { name: /donate/i })).toBeNull();
  });
});
