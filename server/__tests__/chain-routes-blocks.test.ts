import { describe, expect, it, vi } from "vitest";
import { blockSummaryOf } from "@/domain";
import { blocks } from "@/fixtures/blocks";
import type { BlockRowsReader } from "../block-list";
import type { NodeChainSource } from "../chain-source";
import { chainRoutes } from "../chain-routes";

/**
 * `/chain/blocks` and `/chain/blocks/latest`, the site's two block lists, at the HTTP boundary:
 * what each asks the shared list (`block-list.ts`, tested there) and what it sends. The rows are
 * list rows, and nothing but the page travels: `feesStated` is the public API's business.
 */
const rows = blocks.slice(0, 3).map(blockSummaryOf);

function app() {
  const blockRows = vi.fn<BlockRowsReader>(async () => ({
    items: rows,
    nextCursor: "next",
    prevCursor: null,
    feesStated: true,
  }));
  return { blockRows, routes: chainRoutes({} as NodeChainSource, { blockRows }) };
}

describe("/chain/blocks", () => {
  it("forwards the cursor and a bounded size, and sends the page alone", async () => {
    const { blockRows, routes } = app();
    const res = await routes.request("/chain/blocks?before=abc&limit=5000");

    expect(blockRows).toHaveBeenCalledExactlyOnceWith({
      before: "abc",
      after: undefined,
      limit: 100,
    });
    expect(await res.json()).toEqual({ items: rows, nextCursor: "next", prevCursor: null });
  });

  it("sends the newest rows as a bare list for the homepage", async () => {
    const { blockRows, routes } = app();
    const res = await routes.request("/chain/blocks/latest?count=3");

    expect(blockRows).toHaveBeenCalledExactlyOnceWith({ limit: 3 });
    expect(await res.json()).toEqual(rows);
  });
});
