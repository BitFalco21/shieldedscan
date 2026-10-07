import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The nav's network switcher.
 *
 * It lists BOTH networks and marks the current one, rather than offering only the other:
 * on this site "which chain am I looking at" is the question that matters most, and a
 * control showing a single option makes the reader infer the answer. `aria-current` carries
 * it for screen readers too, so the state is not conveyed by weight and colour alone.
 */

const pathname = vi.hoisted(() => ({ current: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => pathname.current }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  pathname.current = "/";
});

async function renderAt(path: string, network?: string) {
  pathname.current = path;
  if (network) vi.stubEnv("NEXT_PUBLIC_NETWORK", network);
  vi.resetModules();
  const { NetworkSwitch } = await import("../NetworkSwitch");
  render(<NetworkSwitch />);
}

describe("NetworkSwitch", () => {
  it("lists both networks and marks the current one", async () => {
    await renderAt("/");
    const mainnet = screen.getByRole("link", { name: /mainnet/i });
    const testnet = screen.getByRole("link", { name: /testnet/i });
    expect(mainnet.getAttribute("aria-current")).toBe("true");
    expect(testnet.getAttribute("aria-current")).toBeNull();
  });

  it("marks testnet as current on the testnet deployment", async () => {
    await renderAt("/", "testnet");
    expect(screen.getByRole("link", { name: /testnet/i }).getAttribute("aria-current")).toBe(
      "true",
    );
    expect(screen.getByRole("link", { name: /mainnet/i }).getAttribute("aria-current")).toBeNull();
  });

  it("carries the current path to the other network", async () => {
    await renderAt("/blocks");
    expect(screen.getByRole("link", { name: /testnet/i }).getAttribute("href")).toBe(
      "https://testnet.shieldedscan.xyz/blocks",
    );
  });

  it("drops to the homepage for a route the target lacks, never a 404", async () => {
    // /donate and /cross-chain are mainnet-only by design; linking a reader into a known
    // 404 would be a worse control than landing them on the testnet homepage.
    await renderAt("/donate");
    expect(screen.getByRole("link", { name: /testnet/i }).getAttribute("href")).toBe(
      "https://testnet.shieldedscan.xyz",
    );
  });

  it("has an accessible name that states the current network", async () => {
    await renderAt("/", "testnet");
    expect(screen.getByLabelText(/network: testnet/i)).toBeDefined();
  });
});
