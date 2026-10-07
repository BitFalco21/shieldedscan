import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The toggle is a plain link that swaps the hostname — never a client-side network switch,
 * which is how testnet figures would end up rendered by a mainnet page. What it preserves
 * is the PATH, and only where the sibling has the route: /donate and /cross-chain do not
 * exist on testnet, so from those pages the link lands on the testnet homepage rather than
 * a 404. The query string is dropped deliberately — cursors and filters encode positions
 * in ONE chain's data and are meaningless in the sibling's.
 */

const pathname = vi.hoisted(() => ({ current: "/" }));

vi.mock("next/navigation", () => ({
  usePathname: () => pathname.current,
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  pathname.current = "/";
});

async function renderAt(path: string, env?: string) {
  cleanup(); // several renders per test: the global afterEach cleanup only runs between tests
  pathname.current = path;
  if (env) vi.stubEnv("NEXT_PUBLIC_NETWORK", env);
  vi.resetModules();
  const { NetworkSwitchLink } = await import("../NetworkSwitchLink");
  render(<NetworkSwitchLink>switch</NetworkSwitchLink>);
  return screen.getByRole("link").getAttribute("href");
}

describe("NetworkSwitchLink", () => {
  it("preserves a shared path when pointing at testnet", async () => {
    expect(await renderAt("/blocks")).toBe("https://testnet.shieldedscan.xyz/blocks");
  });

  it("links the homepage without a trailing slash", async () => {
    expect(await renderAt("/")).toBe("https://testnet.shieldedscan.xyz");
  });

  it("drops to the testnet homepage from mainnet-only routes", async () => {
    expect(await renderAt("/donate")).toBe("https://testnet.shieldedscan.xyz");
    expect(await renderAt("/cross-chain/flows")).toBe("https://testnet.shieldedscan.xyz");
  });

  it("preserves every path when pointing back at mainnet, which has every route", async () => {
    expect(await renderAt("/blocks", "testnet")).toBe("https://shieldedscan.xyz/blocks");
  });
});
