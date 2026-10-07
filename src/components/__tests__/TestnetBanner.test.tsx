import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The banner is the load-bearing half of the two-deployment design's human side: the
 * machine side guarantees testnet data cannot reach the mainnet site, and the banner
 * guarantees a visitor cannot mistake which site they are on. So the tests pin both
 * directions: unmissable on testnet, entirely absent — not hidden, absent — on mainnet.
 */

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("TestnetBanner", () => {
  it("renders nothing at all on the mainnet deployment", async () => {
    const { TestnetBanner } = await import("../TestnetBanner");
    const { container } = render(<TestnetBanner />);
    expect(container.innerHTML).toBe("");
  });

  it("on testnet: names the network, states that coins are worthless, links to mainnet", async () => {
    vi.stubEnv("NEXT_PUBLIC_NETWORK", "testnet");
    vi.resetModules();
    const { TestnetBanner } = await import("../TestnetBanner");
    render(<TestnetBanner />);

    expect(screen.getByText(/testnet/i)).toBeDefined();
    // "No value" is the sentence that matters: a figure quoted off this site must not be
    // mistakable for real ZEC.
    expect(screen.getByText(/no value/i)).toBeDefined();

    const link = screen.getByRole("link", { name: /mainnet/i });
    expect(link.getAttribute("href")).toMatch(/^https:\/\/shieldedscan\.xyz/);
  });
});
