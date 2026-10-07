/**
 * The deployment's Zcash network, in exactly one place.
 *
 * Testnet is a second deployment of this codebase (its own site, API and database), never a
 * runtime parameter threaded through the data port: the mainnet deployment holds no credentials
 * for and no route to the testnet API, so rendering testnet figures as mainnet is structurally
 * impossible. Nothing else in `src/` reads NEXT_PUBLIC_NETWORK directly; `next.config.ts` does,
 * because it loads before the `@/` alias resolves.
 */

export type ZcashNetwork = "mainnet" | "testnet";

/**
 * Strict: an unrecognised value fails the build instead of defaulting, so a typo cannot render
 * testnet data under mainnet chrome. Absent or empty means mainnet.
 */
export function parseNetwork(raw: string | undefined): ZcashNetwork {
  if (raw === undefined || raw === "" || raw === "mainnet") return "mainnet";
  if (raw === "testnet") return "testnet";
  throw new Error(
    `NEXT_PUBLIC_NETWORK must be "mainnet" or "testnet" (or unset), got ${JSON.stringify(raw)}`,
  );
}

export const network: ZcashNetwork = parseNetwork(process.env.NEXT_PUBLIC_NETWORK);

export const isTestnet = network === "testnet";

/**
 * Both canonical origins, pinned in code: the shared `netlify.toml` sets the mainnet origin for
 * the production context and file config outranks the dashboard, so the testnet site cannot
 * override NEXT_PUBLIC_SITE_URL.
 */
export const MAINNET_SITE_URL = "https://shieldedscan.xyz";
export const TESTNET_SITE_URL = "https://testnet.shieldedscan.xyz";

/** The human name of the network the toggle leads to. */
export const siblingNetworkName: ZcashNetwork = isTestnet ? "mainnet" : "testnet";

/** Canonical origin per network, so a switcher can address either one by name. */
export const SITE_URL: Record<ZcashNetwork, string> = {
  mainnet: MAINNET_SITE_URL,
  testnet: TESTNET_SITE_URL,
};

/**
 * Routes that exist on the mainnet deployment only (testnet `notFound()`s them), so the network
 * toggle never offers a testnet twin of a missing page. Each depends on a price, a market, a
 * venue or a mainnet-only service; `/ai-agent` is mainnet-only per `isAgentEnabled` in `agent.ts`.
 */
const MAINNET_ONLY_PREFIXES = [
  "/donate",
  "/cross-chain",
  "/ai-agent",
  "/stats",
  "/satoshi",
  // Live rows read mainnet's pools and the claims are about mainnet.
  "/fact-check",
  // A break-even tariff needs a price, and TAZ has none.
  "/mining-cost",
  // Mainnet value pools and cross-chain crossings; no venue bridges testnet ZEC.
  "/pulse",
  // The crawler and the peers tile cover mainnet only; the testnet API mounts neither.
  "/network",
  // TAZ has no market. The prefix covers `/compare/all` too.
  "/compare",
  // The halving heights on the page are mainnet consensus constants.
  "/halving",
  // The Zcash Name System registry is mainnet-only; the testnet API mounts no ZNS route.
  "/name",
  // Teaches buying and moving real ZEC; testnet coins have no exchange, price or beginner wallet.
  "/learn",
] as const;

/**
 * The URL for `target`'s deployment showing the same page, where that page exists there. One
 * function so every switcher agrees on where "the same page" is.
 *
 * The query string is dropped: cursors and filters encode positions in one chain's data. A path
 * the target lacks resolves to its homepage rather than a 404.
 */
export function siblingUrl(pathname: string, target: ZcashNetwork): string {
  // Next reports an internal pathname (`/_not-found`) on a not-found render. Any `/_` path is
  // Next's, never a route on either deployment, so it resolves to the homepage.
  const isInternal = pathname.startsWith("/_");
  const targetHasRoute =
    target === "mainnet" || !MAINNET_ONLY_PREFIXES.some((p) => pathname.startsWith(p));
  const path = targetHasRoute && !isInternal && pathname !== "/" ? pathname : "";
  return `${SITE_URL[target]}${path}`;
}

/**
 * The coin's ticker on this deployment's network: testnet coins are TAZ, not ZEC, by the
 * ecosystem's convention. `lib/format.ts` reads this for every amount suffix.
 */
export const coinTicker = isTestnet ? "TAZ" : "ZEC";
