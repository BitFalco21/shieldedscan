/**
 * The surface under test, shared by every spec.
 *
 * The route inventory lives in one place: a page added to this list is immediately covered by
 * the link crawl, the overflow sweep, the asset check and the other whole-site sweeps.
 */

import type { Page } from "@playwright/test";

/** Fully shielded Orchard z->z transaction, from src/fixtures/transactions.ts. */
export const SHIELDED_TXID = "a3f29c4e".padEnd(64, "0");
/**
 * Sprout unshielding (z->t), modelled on real mainnet `750b0dc0...` in block 460,495, a shape
 * that exercises the Sprout fee term. Seeded with the real txid's own prefix so the fixture and
 * its source are greppable together.
 */
export const SPROUT_TXID = "750b0dc0".padEnd(64, "0");
/** Fully shielded Orchard z->z transaction still in the mempool, from src/fixtures/mempool.ts. */
export const MEMPOOL_TXID = "dead01".padEnd(64, "0");
export const TRANSPARENT_ADDR = "t1XWk29dAliceFixtureAddr000001";
export const SHIELDED_ADDR = "zs1exampleshieldedsaplingaddressfixture0000000000000001";
/**
 * The site's own donation address (src/lib/donation.ts) — a REAL unified address, so
 * the receivers panel decodes on it (Sapling + Orchard). It renders with no chain data,
 * which is what lets a fixture build serve it.
 */
export const UNIFIED_ADDR =
  "u1a4w9rqrv2knrp58qa5cwak545ul30rq4txh0nfs7hytjxlpcpswhzpattjx9w7c6tcvdw4n5rk92qqln7wc7yfzsdf9g84wf4fr7dyd7p7hup0rc4rj5sxydj98wk750q97dymkgddqs3qlfw2pkrpunle725ldf8aznfmg98g88gu5n";
export const TIP_HEIGHT = 2_481_032;

/** Every page a visitor can reach, with a seed that exists in the fixture chain. */
export const ROUTES: readonly string[] = [
  "/",
  "/blocks",
  `/block/${TIP_HEIGHT}`,
  "/txs",
  `/tx/${SHIELDED_TXID}`,
  `/tx/${SPROUT_TXID}`,
  `/tx/${MEMPOOL_TXID}`,
  `/address/${TRANSPARENT_ADDR}`,
  `/address/${SHIELDED_ADDR}`,
  `/address/${UNIFIED_ADDR}`,
  "/shielded",
  "/cross-chain",
  "/cross-chain/flows",
  "/cross-chain/protocols",
  "/cross-chain/thor-8842",
  "/analytics",
  // The landing view only. Every `?vs=` selection renders the same components against a
  // different row of the same snapshot, so a second entry would pay for every whole-site
  // sweep twice and cover nothing new; `compare.spec.ts` walks the picker's states itself.
  "/compare",
  // The table is a genuinely different tree from the landing view's two cards — a wide
  // `DataTable` — so it earns its own entry: the overflow, contrast and value sweeps have
  // something here they cannot see on `/compare`.
  "/compare/all",
  // Prerendered and warmed rather than dynamic — the sweep covers it like any other page;
  // `halving.spec.ts` covers the parts only a ticking clock can have.
  "/halving",
  // The slot machine. `satoshi.spec.ts` covers what only a pull can show; the sweeps here
  // cover the page at rest.
  "/satoshi",
  // Static sourced answers plus a few live rows; `fact-check.spec.ts` covers the anchors and
  // the outbound-link rules.
  "/fact-check",
  // The mining-cost map at rest; `mining-cost.spec.ts` covers the zoom, the band toggle and
  // the no-egress claim that only interaction can show.
  "/mining-cost",
  // Prerendered reference page; zips.spec.ts covers the href-shape invariant.
  "/zips",
  // A Zcash Name System name with a full history (listed, updated, claimed), so the table and
  // the marketplace line are swept; `zns.spec.ts` covers search, the miss and the stale states.
  "/name/abraham",
  // The ecosystem map: static editorial data, every icon self-hosted, every project a link out.
  "/ecosystem",
  // The learning page at rest (practice mode); `learn.spec.ts` covers the simulator, the guided
  // run and the real checks that only interaction can show.
  "/learn",
  // The live stage at rest: frame 0 is a real render of the boxes, the ribbons, the ledger
  // rows and the newest block's movements, so every sweep here covers it exactly as it covers
  // any other page. `pulse.spec.ts` covers what only a mounted transport can show.
  "/pulse",
  // The node map's six tabs at rest; `network.spec.ts` covers the lens, the ghost toggle,
  // the zoom, the sky after mount, the chip surviving a page turn and the no-address sweep.
  "/network",
  "/network/map",
  "/network/software",
  "/network/upgrade",
  "/network/health",
  "/network/nodes",
  "/rich-list",
  "/charts",
  "/charts/median-fee",
  // One entry: `filters.spec.ts` discovers the window chips from the DOM and exercises them, and
  // every route here is walked sequentially by several sweeps.
  "/mining",
  "/mempool",
  "/reorgs",
  "/donate",
  "/api-docs",
  "/mcp",
  "/about",
  "/brand",
  "/privacy",
  "/terms",
  "/search?q=hello%20world",
  // `/ai-agent` joins the sweeps only where the build serves it: the route `notFound()`s when
  // the flag is off, so listing it unconditionally would fail the link crawl for the correct
  // reason.
  ...(process.env.NEXT_PUBLIC_AGENT_ENABLED === "1" ? ["/ai-agent"] : []),
];

/** The two viewports every visual and layout assertion runs at. */
export const VIEWPORTS = {
  mobile: { width: 375, height: 812 },
  desktop: { width: 1440, height: 900 },
} as const;

export type ViewportName = keyof typeof VIEWPORTS;

/**
 * Collect console errors and uncaught exceptions for the life of the page, so a page that
 * looks fine but throws still fails.
 */
export function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(`${error.name}: ${error.message}`));
  return errors;
}

/** Ignore console noise that is not ours — favicon 404s in dev, extension chatter. */
export function isOurError(text: string): boolean {
  return !/favicon|chrome-extension|Download the React DevTools/i.test(text);
}

/**
 * Settle the page before measuring geometry.
 *
 * `networkidle` alone is not enough: under parallel workers, measuring while the web font is
 * still swapping in compares text laid out in a fallback face against containers sized for
 * JetBrains Mono, and reports phantom overflows.
 *
 * `document.fonts.ready` is the actual signal, plus one frame so any resulting reflow has been
 * applied. Anything still failing after this is a layout bug, not a timing one.
 */
export async function settleLayout(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle");
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  });
}
