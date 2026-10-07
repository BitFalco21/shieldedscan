import { describe, expect, it } from "vitest";
import type { CrossChainTransfer } from "@/domain";
import { crosschainRoutes } from "../crosschain-routes";
import { MemoryStorePort } from "../crosschain-store";

const LEG = "ab".repeat(32);

function transfer(id: string, over: Partial<CrossChainTransfer> = {}): CrossChainTransfer {
  return {
    id,
    direction: "in",
    protocol: "near-intents",
    counterpartChain: "BTC",
    counterpartAsset: "BTC",
    counterpartAmount: 0.01,
    counterpartTxHash: null,
    counterpartIsSynthetic: false,
    counterpartAddress: null,
    zcashTxid: LEG,
    zcashAddress: null,
    zecAmountZat: 100_000_000,
    usdValueAtSwap: null,
    counterpartUsdAtSwap: null,
    venueDepositAddress: null,
    status: "completed",
    timestamp: 1_785_000_000,
    ...over,
  };
}

async function app(rows: CrossChainTransfer[]) {
  const store = new MemoryStorePort();
  await store.upsert(rows);
  return crosschainRoutes(store);
}

describe("GET /crosschain/transfers/by-zcash-tx/:txid", () => {
  it("answers with the crossings and echoes the txid it answered about", async () => {
    const res = await (
      await app([transfer("near-1")])
    ).request(`/crosschain/transfers/by-zcash-tx/${LEG.toUpperCase()}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      zcashTxid: string;
      total: number;
      transfers: CrossChainTransfer[];
    };
    expect(body.zcashTxid).toBe(LEG);
    expect(body.total).toBe(1);
    expect(body.transfers.map((t) => t.id)).toEqual(["near-1"]);
  });

  it("answers 200 with [] for a transaction that crossed nothing", async () => {
    const res = await (await app([])).request(`/crosschain/transfers/by-zcash-tx/${LEG}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ zcashTxid: LEG, total: 0, transfers: [] });
  });

  it("is a 400 for a malformed txid — a typo is not a transaction that crossed nothing", async () => {
    const res = await (await app([])).request("/crosschain/transfers/by-zcash-tx/not-a-txid");
    expect(res.status).toBe(400);
  });

  it("returns a twenty-crossing batch whole, with its total", async () => {
    // Mainnet's widest: one NEAR Intents transaction settled 20 crossings.
    const batch = Array.from({ length: 20 }, (_, i) =>
      transfer(`near-batch-${i}`, { timestamp: 1_785_000_000 + i }),
    );
    const res = await (await app(batch)).request(`/crosschain/transfers/by-zcash-tx/${LEG}`);
    const body = (await res.json()) as { total: number; transfers: CrossChainTransfer[] };
    expect(body.total).toBe(20);
    expect(body.transfers).toHaveLength(20);
  });

  it("does not shadow the single-transfer route", async () => {
    const res = await (await app([transfer("near-1")])).request("/crosschain/transfers/near-1");
    expect(res.status).toBe(200);
    expect(((await res.json()) as CrossChainTransfer).id).toBe("near-1");
  });
});
