import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { blockSummaryOf, type BlockSummary } from "@/domain";
import { blocks as fixtureBlocks } from "@/fixtures/blocks";
import { HomeLivePanels } from "../HomeLivePanels";

/**
 * The rendered order of the homepage panels, which no unit test of the reducer can see.
 * Arrivals must land at the top: a list of block heights that is not descending is
 * self-evidently wrong, and worse than not updating at all.
 */

/** Newest-first, like every list on the site. */
const newestFirst = [...fixtureBlocks].sort((a, b) => b.height - a.height).map(blockSummaryOf);

function payloadWith(blocks: BlockSummary[]) {
  return {
    kind: "all",
    direction: "all",
    tip: {
      height: blocks[0]!.height,
      hash: blocks[0]!.hash,
      lastBlockTimestamp: blocks[0]!.timestamp,
    },
    blocks,
    transactions: [],
    transfers: [],
  };
}

/** Every block height the panel rendered, in DOM order. */
function renderedHeights(): number[] {
  return screen
    .getAllByRole("link")
    .map((a) => a.getAttribute("href") ?? "")
    .filter((h) => h.startsWith("/block/"))
    .map((h) => Number(h.replace("/block/", "")));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("HomeLivePanels block ordering", () => {
  it("renders newest first before any poll lands", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => new Promise(() => {})),
    );
    const server = newestFirst.slice(2, 10);

    render(
      <HomeLivePanels
        latestBlocks={server}
        latestTxs={[]}
        latestTransfers={[]}
        now={server[0]!.timestamp}
      />,
    );

    expect(renderedHeights()).toEqual(server.map((b) => b.height));
  });

  it("stays descending when the poll's window reaches BELOW the panel", async () => {
    // The panel shows eight blocks and the poll returns ten, so two polled rows are older than
    // anything on screen. Absent from the panel is not the same as new: treating them as
    // arrivals would prepend the two oldest blocks above the chain tip.
    const server = newestFirst.slice(0, 8);
    const polled = newestFirst.slice(0, 10);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => payloadWith(polled) } as Response),
    );

    render(
      <HomeLivePanels
        latestBlocks={server}
        latestTxs={[]}
        latestTransfers={[]}
        now={server[0]!.timestamp}
      />,
    );

    // Give the poll time to land and be merged.
    await new Promise((resolve) => setTimeout(resolve, 120));

    const heights = renderedHeights();
    expect(heights, `rendered order was ${heights.join(", ")}`).toEqual(
      [...heights].sort((a, b) => b - a),
    );
    expect(heights[0], "the tip must stay at the top").toBe(newestFirst[0]!.height);
  });

  it("keeps the list strictly descending once newer blocks arrive", async () => {
    const server = newestFirst.slice(2, 10);
    const polled = newestFirst.slice(0, 10);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => payloadWith(polled) } as Response),
    );

    render(
      <HomeLivePanels
        latestBlocks={server}
        latestTxs={[]}
        latestTransfers={[]}
        now={server[0]!.timestamp}
      />,
    );

    await waitFor(() => expect(renderedHeights()[0]).toBe(newestFirst[0]!.height));

    const heights = renderedHeights();
    const descending = [...heights].sort((a, b) => b - a);
    expect(heights, `rendered order was ${heights.join(", ")}`).toEqual(descending);
  });

  it("never grows past the number of rows the server rendered", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => new Promise(() => {})),
    );
    const server = newestFirst.slice(2, 10);

    render(
      <HomeLivePanels
        latestBlocks={server}
        latestTxs={[]}
        latestTransfers={[]}
        now={server[0]!.timestamp}
      />,
    );

    expect(renderedHeights()).toHaveLength(server.length);
  });
});
