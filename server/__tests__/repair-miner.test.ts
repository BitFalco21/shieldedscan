import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import block3426950 from "@/data/chain/__fixtures__/block-3426950.json";
import block3426970 from "@/data/chain/__fixtures__/block-3426970.json";
import block3426987 from "@/data/chain/__fixtures__/block-3426987.json";
import block3426998 from "@/data/chain/__fixtures__/block-3426998.json";
import block3428150 from "@/data/chain/__fixtures__/block-3428150.json";
import shieldedCoinbase from "@/data/chain/__fixtures__/block-3437300-coinbase.json";
import block460495 from "@/data/chain/__fixtures__/block-460495.json";
import { parseBlock } from "@/data/chain/parse";
import type { RpcBlock, RpcBlockSummary, RpcTransaction } from "@/data/chain/rpc-types";
import { minerRewardZat } from "@/domain";
import type { Pacer } from "../job-pacer";
import { minerFieldsFor, repairMiner, type MinerRpc } from "../repair-miner";

/**
 * The miner repair hands `parseBlock` a verbosity-1 header with the coinbase as its only
 * transaction. That is only safe if the four fields it writes depend on nothing else in the
 * block, and the way to know is to run real blocks through both paths: every captured mainnet
 * block, across the founders'-reward era (460,495, inside the repair's range), the NU6 lockbox
 * era, a pool migration block, and a ZIP-213 shielded coinbase.
 */

const FIXTURES = [
  block460495,
  block3426950,
  block3426970,
  block3426987,
  block3426998,
  block3428150,
  shieldedCoinbase,
] as unknown as RpcBlock[];

const summaryOf = (b: RpcBlock): RpcBlockSummary => ({ ...b, tx: b.tx.map((t) => t.txid) });

describe("minerFieldsFor", () => {
  it("matches the follower's full-block parse on every captured block", () => {
    for (const b of FIXTURES) {
      const full = parseBlock(b).block;
      const derived = minerFieldsFor({ height: b.height, hash: b.hash }, summaryOf(b), b.tx[0]!);
      expect(derived, String(b.height)).toEqual({
        kind: full.miner.kind,
        address: full.miner.kind === "transparent" ? full.miner.address : null,
        coinbaseTag: full.coinbaseTag,
        minerRewardZat: minerRewardZat(full),
      });
    }
  });

  it("covers both kinds, so the equality above is not vacuous", () => {
    const kinds = FIXTURES.map(
      (b) => minerFieldsFor({ height: b.height, hash: b.hash }, summaryOf(b), b.tx[0]!)?.kind,
    );
    expect(kinds).toContain("transparent");
    expect(kinds).toContain("shielded");
    // A shielded coinbase pays a pool, so the miner's reward is not public.
    const shielded = shieldedCoinbase as unknown as RpcBlock;
    expect(
      minerFieldsFor(
        { height: shielded.height, hash: shielded.hash },
        summaryOf(shielded),
        shielded.tx[0]!,
      ),
    ).toMatchObject({ kind: "shielded", address: null, minerRewardZat: null });
  });

  it("refuses an answer about another block, another first transaction, or a non-coinbase", () => {
    const b = block3428150 as unknown as RpcBlock;
    const row = { height: b.height, hash: b.hash };
    expect(minerFieldsFor({ ...row, hash: "f".repeat(64) }, summaryOf(b), b.tx[0]!)).toBeNull();
    expect(minerFieldsFor({ ...row, height: row.height + 1 }, summaryOf(b), b.tx[0]!)).toBeNull();
    expect(minerFieldsFor(row, summaryOf(b), b.tx[1]!)).toBeNull();
    // The first txid names a non-coinbase transaction: refused, never parsed as a miner.
    const swapped = { ...summaryOf(b), tx: [b.tx[1]!.txid, ...summaryOf(b).tx.slice(1)] };
    expect(minerFieldsFor(row, swapped, b.tx[1]!)).toBeNull();
  });
});

/** An in-memory `block` table that answers the repair's SELECT and UPDATE. */
function fakeChain(blocks: RpcBlock[], extra: { height: number; hash: string }[] = []) {
  const table = [...blocks.map((b) => ({ height: b.height, hash: b.hash })), ...extra].map((r) => ({
    ...r,
    miner_kind: null as string | null,
    miner_address: null as string | null,
  }));
  table.sort((a, b) => a.height - b.height);
  const pool = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes("SELECT height, hash FROM block")) {
        const [from, limit, end] = params as number[];
        const rows = table
          .filter(
            (r) =>
              r.miner_kind === null && r.height >= from! && (end === undefined || r.height < end),
          )
          .slice(0, limit)
          .map(({ height, hash }) => ({ height, hash }));
        return { rows, rowCount: rows.length };
      }
      if (sql.startsWith("UPDATE block")) {
        const [heights, hashes, kinds, addresses] = params as [
          number[],
          string[],
          string[],
          (string | null)[],
        ];
        let n = 0;
        heights.forEach((h, i) => {
          const r = table.find(
            (x) => x.height === h && x.hash === hashes[i] && x.miner_kind === null,
          );
          if (r) {
            r.miner_kind = kinds[i]!;
            r.miner_address = addresses[i]!;
            n++;
          }
        });
        return { rows: [], rowCount: n };
      }
      throw new Error(`unexpected SQL: ${sql}`);
    }),
  } as unknown as Pool;
  const byHash = new Map(blocks.map((b) => [b.hash, b]));
  const txs = new Map(blocks.flatMap((b) => b.tx.map((t) => [t.txid, t] as const)));
  const rpc: MinerRpc = {
    getBlockSummaryByHash: vi.fn(async (hash: string) => {
      const b = byHash.get(hash);
      if (!b) throw new Error("-5 block not found");
      return summaryOf(b);
    }),
    getRawTransaction: vi.fn(async (txid: string) => {
      const t = txs.get(txid);
      if (!t) throw new Error("-5 no such transaction");
      return t as RpcTransaction;
    }),
  };
  return { pool, rpc, table };
}

const pacer = (verdicts: ("continue" | "abort")[] = []): Pacer => ({
  preflight: vi.fn(async () => {}),
  afterUnit: vi.fn(async () => verdicts.shift() ?? "continue"),
  stats: { sleptMs: 0, stallSamples: 0, maxBlocksBehind: 0 },
});

describe("repairMiner", () => {
  it("fills every row it can, by hash, and terminates past one it cannot", async () => {
    // An orphan the node no longer serves sits between two real blocks.
    const { pool, rpc, table } = fakeChain(FIXTURES, [{ height: 500_000, hash: "e".repeat(64) }]);
    const result = await repairMiner({ pool, rpc, pacer: pacer(), log: () => {}, batch: 3 });
    expect(result).toMatchObject({
      written: FIXTURES.length,
      failed: 1,
      refused: 0,
      aborted: false,
    });
    expect(table.find((r) => r.height === 500_000)?.miner_kind).toBeNull();
    expect(table.find((r) => r.height === 3_437_300)?.miner_kind).toBe("shielded");
    expect(table.find((r) => r.height === 460_495)?.miner_address).toMatch(/^t1/);
  });

  it("stops when the pacer says ingestion fell behind, leaving the rest for the next run", async () => {
    const { pool, rpc, table } = fakeChain(FIXTURES);
    const result = await repairMiner({
      pool,
      rpc,
      pacer: pacer(["abort"]),
      log: () => {},
      batch: 2,
    });
    expect(result).toMatchObject({ written: 2, aborted: true });
    expect(table.filter((r) => r.miner_kind === null)).toHaveLength(FIXTURES.length - 2);
  });

  it("stops on a batch the node mostly failed rather than skipping past it", async () => {
    const { pool, rpc } = fakeChain(FIXTURES);
    vi.mocked(rpc.getBlockSummaryByHash).mockRejectedValue(new Error("fetch failed"));
    const result = await repairMiner({ pool, rpc, pacer: pacer(), log: () => {}, batch: 4 });
    expect(result).toMatchObject({ written: 0, failed: 4, aborted: true });
  });

  it("respects the end height, so a first run can be bounded", async () => {
    const { pool, rpc, table } = fakeChain(FIXTURES);
    await repairMiner({ pool, rpc, pacer: pacer(), log: () => {}, end: 3_000_000 });
    expect(table.filter((r) => r.miner_kind !== null).map((r) => r.height)).toEqual([460_495]);
  });
});
