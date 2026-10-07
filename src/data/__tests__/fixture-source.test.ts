import { describe, expect, it } from "vitest";
import { fixtureDataSource } from "../fixture-source";
import { ADDR_ALICE, ADDR_SAPLING, TIP_HEIGHT, hex64 } from "@/fixtures/ids";
import { addressLabel } from "@/domain";

describe("fixtureDataSource", () => {
  // Cursor semantics for listBlocks/listTransactions/listCrossChainTransfers are
  // covered exhaustively in ./cursor.test.ts. These checks just confirm the shape
  // and known-item presence a cursor.test.ts round-trip wouldn't otherwise exercise.
  describe("listBlocks", () => {
    it("returns a non-empty first page shaped as { items, nextCursor, prevCursor }", async () => {
      const { items, prevCursor } = await fixtureDataSource.listBlocks({ limit: 3 });
      expect(items.length).toBeGreaterThan(0);
      expect(prevCursor).toBeNull();
    });

    it("a known block is present", async () => {
      const { items } = await fixtureDataSource.listBlocks({ limit: 20 });
      expect(items.some((b) => b.height === TIP_HEIGHT)).toBe(true);
    });
  });

  describe("listTransactions", () => {
    it("returns a non-empty first page shaped as { items, nextCursor, prevCursor }", async () => {
      const { items, prevCursor } = await fixtureDataSource.listTransactions({ limit: 5 }, "all");
      expect(items.length).toBeGreaterThan(0);
      expect(prevCursor).toBeNull();
    });

    it("the fully-shielded fixture tx is present", async () => {
      const { items } = await fixtureDataSource.listTransactions({ limit: 50 }, "all");
      expect(items.some((t) => t.txid === hex64("a3f29c4e"))).toBe(true);
    });
  });

  describe("listCrossChainTransfers", () => {
    it("returns a non-empty first page shaped as { items, nextCursor, prevCursor }", async () => {
      const { items, prevCursor } = await fixtureDataSource.listCrossChainTransfers({ limit: 5 });
      expect(items.length).toBeGreaterThan(0);
      expect(prevCursor).toBeNull();
    });

    it("a known transfer id is present", async () => {
      const { items } = await fixtureDataSource.listCrossChainTransfers({ limit: 50 });
      expect(items.some((t) => t.id === "thor-8842")).toBe(true);
    });
  });

  describe("getAddressTransactions", () => {
    it("returns the known transparent address's transactions", async () => {
      const { items } = await fixtureDataSource.getAddressTransactions(ADDR_ALICE, { limit: 10 });
      expect(items.length).toBeGreaterThan(0);
      expect(items.some((t) => t.txid === hex64("77d10b12"))).toBe(true);
    });

    it("pages by keyset with no duplicated or skipped rows", async () => {
      // Walking forward through 1-row pages reassembles the full list exactly, and paging back
      // returns to the same first row.
      const all = await fixtureDataSource.getAddressTransactions(ADDR_ALICE, { limit: 100 });
      const walked: string[] = [];
      let cursor: string | undefined;
      for (;;) {
        const page = await fixtureDataSource.getAddressTransactions(ADDR_ALICE, {
          before: cursor,
          limit: 1,
        });
        if (page.items.length === 0) break;
        walked.push(...page.items.map((t) => t.txid));
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
      }
      expect(walked).toEqual(all.items.map((t) => t.txid));
    });

    it("returns an empty page for an unknown address without throwing", async () => {
      await expect(
        fixtureDataSource.getAddressTransactions("t1TotallyUnknownAddress00000001", { limit: 10 }),
      ).resolves.toEqual({ items: [], nextCursor: null, prevCursor: null });
    });

    it("returns an empty page for a shielded address without throwing", async () => {
      await expect(
        fixtureDataSource.getAddressTransactions(ADDR_SAPLING, { limit: 10 }),
      ).resolves.toEqual({ items: [], nextCursor: null, prevCursor: null });
    });
  });

  describe("undefined for unknown ids (the documented does-not-exist contract)", () => {
    it("getBlock resolves to undefined, not a rejection", async () => {
      await expect(fixtureDataSource.getBlock("9999999")).resolves.toBeUndefined();
      await expect(fixtureDataSource.getBlock(hex64("deadbeef"))).resolves.toBeUndefined();
    });

    it("getTransaction resolves to undefined, not a rejection", async () => {
      await expect(fixtureDataSource.getTransaction(hex64("deadbeef"))).resolves.toBeUndefined();
    });

    it("getCrossChainTransfer resolves to undefined, not a rejection", async () => {
      await expect(fixtureDataSource.getCrossChainTransfer("nope-0000")).resolves.toBeUndefined();
    });
  });
});

describe("the fixture chain exercises named addresses", () => {
  /**
   * The fixture chain carries a transaction with a labelled address, so the name-for-address
   * rendering on `/tx` is exercised in previews and e2e.
   */
  it("has a transaction whose transparent side carries a labelled address", async () => {
    const { items } = await fixtureDataSource.listTransactions({ limit: 100 }, "all");
    const named = items.filter((tx) =>
      [...tx.transparentInputs, ...tx.transparentOutputs].some((e) => addressLabel(e.address)),
    );
    expect(named.length).toBeGreaterThan(0);
  });

  it("keeps that address resolvable, so the name is not a dead link", async () => {
    const { items } = await fixtureDataSource.listTransactions({ limit: 100 }, "all");
    const entries = items.flatMap((tx) => [...tx.transparentInputs, ...tx.transparentOutputs]);
    for (const address of new Set(entries.map((e) => e.address).filter(addressLabel))) {
      expect(await fixtureDataSource.getAddress(address), address).not.toBeNull();
    }
  });
});

describe("listCrossChainTransfersForZcashTx (fixtures)", () => {
  it("finds the crossing a fixture transaction is the Zcash leg of", async () => {
    const legs = await fixtureDataSource.listCrossChainTransfersForZcashTx(
      "77d10b12".padEnd(64, "0").toUpperCase(),
    );
    expect(legs.transfers.map((t) => t.id)).toEqual(["thor-8842"]);
    expect(legs.total).toBe(1);
  });

  it("returns [] for a transaction that crossed nothing", async () => {
    await expect(
      fixtureDataSource.listCrossChainTransfersForZcashTx("ff".repeat(32)),
    ).resolves.toEqual({ transfers: [], total: 0 });
  });
});
