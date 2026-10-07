import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAINNET_SITE_URL,
  TESTNET_SITE_URL,
  isTestnet,
  network,
  parseNetwork,
  siblingUrl,
} from "../network";

/**
 * The network flag must never be guessed: a testnet deployment whose chrome believes it is
 * mainnet publishes worthless figures as real ones. The parser is strict (an unrecognised
 * value fails the build rather than defaulting), and the default build is pinned as mainnet
 * so the flag is inert wherever it is not set.
 */

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("parseNetwork", () => {
  it("defaults to mainnet when the variable is absent or empty", () => {
    expect(parseNetwork(undefined)).toBe("mainnet");
    expect(parseNetwork("")).toBe("mainnet");
  });

  it("accepts exactly the two lowercase network names", () => {
    expect(parseNetwork("mainnet")).toBe("mainnet");
    expect(parseNetwork("testnet")).toBe("testnet");
  });

  it("fails the build on anything else — a typo must never silently mean mainnet", () => {
    // "Testnet" misspelled or miscased on the testnet site would render testnet data under
    // mainnet chrome, which is the exact failure the two-deployment design exists to prevent.
    for (const bad of ["Testnet", "TESTNET", "tesnet", "main", "regtest", " testnet"]) {
      expect(() => parseNetwork(bad), bad).toThrow(/NEXT_PUBLIC_NETWORK/);
    }
  });
});

describe("network module (this build)", () => {
  it("is mainnet by default, so the flag is inert until a deployment sets it", () => {
    expect(network).toBe("mainnet");
    expect(isTestnet).toBe(false);
  });

  it("pins both canonical origins: https, no trailing slash", () => {
    for (const url of [MAINNET_SITE_URL, TESTNET_SITE_URL]) {
      expect(url).toMatch(/^https:\/\//);
      expect(url).not.toMatch(/\/$/);
    }
    expect(TESTNET_SITE_URL).toContain("testnet.");
  });

  /**
   * A path the target lacks lands on its homepage. That covers routes the sibling
   * deliberately does not have and paths that are not ours at all: on a 404 render Next
   * reports its internal `/_not-found`, which must not be carried across as a second 404.
   */
  it("sends internal Next paths to the sibling's homepage, not to a second 404", () => {
    expect(siblingUrl("/_not-found", "testnet")).toBe(TESTNET_SITE_URL);
    expect(siblingUrl("/_not-found", "mainnet")).toBe(MAINNET_SITE_URL);
    expect(siblingUrl("/_next/static/whatever", "testnet")).toBe(TESTNET_SITE_URL);
  });

  it("still carries a real shared path across, and drops mainnet-only ones", () => {
    expect(siblingUrl("/blocks", "testnet")).toBe(`${TESTNET_SITE_URL}/blocks`);
    expect(siblingUrl("/block/3428150", "testnet")).toBe(`${TESTNET_SITE_URL}/block/3428150`);
    // testnet has no /cross-chain or /donate, so those resolve to its homepage
    expect(siblingUrl("/cross-chain/flows", "testnet")).toBe(TESTNET_SITE_URL);
    expect(siblingUrl("/donate", "testnet")).toBe(TESTNET_SITE_URL);
    expect(siblingUrl("/satoshi", "testnet")).toBe(TESTNET_SITE_URL);
    expect(siblingUrl("/fact-check", "testnet")).toBe(TESTNET_SITE_URL);
    expect(siblingUrl("/pulse", "testnet")).toBe(TESTNET_SITE_URL);
    expect(siblingUrl("/halving", "testnet")).toBe(TESTNET_SITE_URL);
    // ...but they exist on mainnet, so going the other way keeps the path
    expect(siblingUrl("/cross-chain/flows", "mainnet")).toBe(
      `${MAINNET_SITE_URL}/cross-chain/flows`,
    );
    expect(siblingUrl("/pulse", "mainnet")).toBe(`${MAINNET_SITE_URL}/pulse`);
  });
});

describe("network module (testnet build)", () => {
  it("flips isTestnet and the canonical site URL together", async () => {
    vi.stubEnv("NEXT_PUBLIC_NETWORK", "testnet");
    vi.resetModules();
    const net = await import("../network");
    const site = await import("../site");
    expect(net.isTestnet).toBe(true);
    // On testnet siteUrl is derived from the network flag: the shared netlify.toml hardcodes
    // the mainnet origin for production, and file config outranks the dashboard.
    expect(site.siteUrl).toBe(net.TESTNET_SITE_URL);
  });
});
