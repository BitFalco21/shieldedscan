import { describe, expect, it, vi } from "vitest";
import type { ChainIndexStore } from "../chain-index-store";
import type { NodeChainSource } from "../chain-source";
import { chainRoutes } from "../chain-routes";

/**
 * `/chain/transactions?pool=`: the same parsing, validation and store query as
 * `/v1/transactions`, and the applied pool echoed so the site can refuse a page that was not
 * narrowed. Exercised through the router, so the 400 is the router's answer and not the parser's.
 */

const EMPTY_PAGE = { items: [], nextCursor: null, prevCursor: null };

function indexStub() {
  const listChainTransactions = vi.fn<ChainIndexStore["listChainTransactions"]>(
    async () => EMPTY_PAGE,
  );
  return { index: { listChainTransactions } as unknown as ChainIndexStore, listChainTransactions };
}

function nodeStub() {
  const listTransactions = vi.fn<NodeChainSource["listTransactions"]>(async () => EMPTY_PAGE);
  return { source: { listTransactions } as unknown as NodeChainSource, listTransactions };
}

async function get(app: ReturnType<typeof chainRoutes>, path: string) {
  const res = await app.request(path);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe("/chain/transactions pool filter", () => {
  it("narrows the store query by the pool and echoes it", async () => {
    const { index, listChainTransactions } = indexStub();
    const app = chainRoutes(nodeStub().source, { chainIndex: index });
    const { status, body } = await get(app, "/chain/transactions?pool=sprout&limit=10");
    expect(status).toBe(200);
    expect(listChainTransactions).toHaveBeenCalledWith(
      "all",
      { before: undefined, after: undefined, limit: 10 },
      { pool: "sprout" },
    );
    expect(body.applied).toEqual({ kind: "all", pool: "sprout" });
  });

  it("reads the pool as /v1 does: case-insensitive, combined with a kind", async () => {
    const { index, listChainTransactions } = indexStub();
    const app = chainRoutes(nodeStub().source, { chainIndex: index });
    const { body } = await get(app, "/chain/transactions?pool=Orchard&kind=shielded");
    expect(listChainTransactions.mock.calls[0]?.[2]).toEqual({ pool: "orchard" });
    expect(body.applied).toEqual({ kind: "shielded", pool: "orchard" });
  });

  it("echoes a null pool when none was asked, so an old API is told apart by the missing key", async () => {
    const { index, listChainTransactions } = indexStub();
    const app = chainRoutes(nodeStub().source, { chainIndex: index });
    for (const path of ["/chain/transactions", "/chain/transactions?pool="]) {
      const { body } = await get(app, path);
      expect(body.applied, path).toEqual({ kind: "all", pool: null });
    }
    for (const call of listChainTransactions.mock.calls) expect(call[2]).toEqual({});
  });

  it("answers 400, never 500 and never an unfiltered list, for a pool it cannot read", async () => {
    const { index, listChainTransactions } = indexStub();
    const app = chainRoutes(nodeStub().source, { chainIndex: index });
    for (const raw of ["transparent", "lockbox", "banana"]) {
      const { status, body } = await get(app, `/chain/transactions?pool=${raw}`);
      expect(status, raw).toBe(400);
      expect(String(body.error), raw).toMatch(/ironwood/);
    }
    expect(listChainTransactions).not.toHaveBeenCalled();
  });

  it("answers 400 for a transparent kind with a pool, as /v1 does", async () => {
    const { index, listChainTransactions } = indexStub();
    const app = chainRoutes(nodeStub().source, { chainIndex: index });
    const { status, body } = await get(app, "/chain/transactions?kind=transparent&pool=sapling");
    expect(status).toBe(400);
    expect(String(body.error)).toMatch(/no shielded pool/);
    expect(listChainTransactions).not.toHaveBeenCalled();
  });

  it("refuses a pool without the index rather than answering from the unfiltered node walk", async () => {
    const { source, listTransactions } = nodeStub();
    const app = chainRoutes(source);
    const { status } = await get(app, "/chain/transactions?pool=ironwood");
    expect(status).toBe(503);
    expect(listTransactions).not.toHaveBeenCalled();
  });

  it("still answers from the node walk without the index when no pool is asked", async () => {
    const { source, listTransactions } = nodeStub();
    const app = chainRoutes(source);
    const { status, body } = await get(app, "/chain/transactions?kind=shielded");
    expect(status).toBe(200);
    expect(listTransactions).toHaveBeenCalledTimes(1);
    expect(body.applied).toEqual({ kind: "shielded", pool: null });
  });
});
