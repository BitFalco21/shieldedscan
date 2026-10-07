import { describe, expect, it } from "vitest";
import type { NodeChainSource } from "../chain-source";
import { chainRoutes } from "../chain-routes";

/**
 * `/chain/blocks/:id/transactions` must cap `limit` through `sizeParam`: an uncapped value, or a
 * negative one reaching `slice(0, -5)` on the no-index path, must not get through.
 */
function sourceStub(): NodeChainSource {
  return {
    getBlock: async () => ({ height: 7 }),
    getBlockTransactions: async () => Array.from({ length: 300 }, (_, i) => ({ txid: `t${i}` })),
  } as unknown as NodeChainSource;
}

describe("/chain/blocks/:id/transactions page size", () => {
  it("caps the page at MAX_PAGE_SIZE", async () => {
    const res = await chainRoutes(sourceStub()).request("/chain/blocks/7/transactions?limit=5000");
    expect((await res.json()).items).toHaveLength(100);
  });

  it("floors a negative or malformed size at one instead of slicing from the end", async () => {
    for (const raw of ["-5", "abc", "0"]) {
      const res = await chainRoutes(sourceStub()).request(
        `/chain/blocks/7/transactions?limit=${raw}`,
      );
      const items = (await res.json()).items;
      expect(items.length, raw).toBeGreaterThanOrEqual(1);
      expect(items.length, raw).toBeLessThanOrEqual(25);
    }
  });
});
