import { describe, expect, it, vi } from "vitest";
import { blocks } from "@/fixtures/blocks";
import { transactions } from "@/fixtures/transactions";

/**
 * `/api/live` withholds transactions ahead of its own blocks list. `consistentTransactions`
 * is tested in `live-feed.test.ts`; this proves the route calls it. The fixture source is
 * internally consistent, so the data source is mocked with blocks coalesced 20 s behind the
 * transaction read.
 */

const newest = [...blocks].sort((a, b) => b.height - a.height)[0]!;
const staleBlocks = [...blocks].sort((a, b) => b.height - a.height).slice(1, 4);
const txAhead = { ...transactions[0]!, txid: "ff".repeat(32), blockHeight: newest.height };
const txCarried = { ...transactions[0]!, blockHeight: staleBlocks[0]!.height };

vi.mock("@/data", () => ({
  getDataSource: () => ({
    getChainInfo: async () => ({
      height: newest.height,
      bestBlockHash: newest.hash,
      lastBlockTimestamp: newest.timestamp,
    }),
    // The production shape: the tip and transactions know about a block the coalesced
    // blocks list does not carry yet.
    listBlocks: async () => ({ items: staleBlocks, nextCursor: null, prevCursor: null }),
    listTransactions: async () => ({
      items: [txAhead, txCarried],
      nextCursor: null,
      prevCursor: null,
    }),
    listCrossChainTransfers: async () => ({ items: [], nextCursor: null, prevCursor: null }),
  }),
}));

describe("GET /api/live under a stale blocks list", () => {
  it("withholds the transaction whose block the payload does not carry", async () => {
    const { GET } = await import("../api/live/route");

    const body = await (
      await GET(new Request("http://localhost/api/live?kind=all&direction=all"))
    ).json();

    const txids = body.transactions.map((t: { txid: string }) => t.txid);
    expect(txids).not.toContain(txAhead.txid);
    expect(txids).toContain(txCarried.txid);
  });
});
