import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MINER_SIGNATURES, selfDeclaredMiner, ZEBRA_COINBASE_MARK } from "@/domain";
import { computeMiningDay, loadMinerWindow, miningDaysToCompute } from "../mining-daily";
import { blockHeightRange, windowHeightRange } from "../chain-window";
import { loadMiningOverview } from "../mining-overview";
import { miningRoutes, NODE_SOLPS_MAX_BLOCKS } from "../mining-routes";
import { PoolUsageTracker } from "../pool-usage";
import type { Pacer } from "../job-pacer";

/**
 * Who mined what, on a real Postgres with the real schemas: the `/mining` overview read straight
 * from `block` (names matched in the domain's first-match order, fees null unless whole, the
 * address-less kinds kept out of the groups but in the denominator), and the per-day table behind
 * `/v1/analytics/miners` (a day replaced whole, a window summed with competition ranks, a day with
 * unrecorded blocks recomputed until it is whole, UTC dates whatever the session's zone).
 *
 *   TEST_DATABASE_URL=postgres://postgres:test@localhost:55432/explorer \
 *     npx vitest run server/__tests__/mining-db.test.ts
 */
const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;
const TEST_DB = "explorer_mining_test";

function withDatabase(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

const DAY = 86_400;
const D0 = Date.UTC(2026, 9, 1) / 1000;
const D1 = D0 + DAY;
const D3 = D0 + 3 * DAY;
const D4 = D0 + 4 * DAY;
/** Noon of D4, the fixture's "today". */
const NOW = D4 + 12 * 3600;

interface Fx {
  height: number;
  ts: number;
  kind: "transparent" | "shielded" | "unknown" | null;
  address?: string;
  reward?: number | null;
  fee: number | null;
  tag: string | null;
  difficulty?: number | null;
  txCount?: number;
}

const A = "t1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const B = "t1BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const C = "t1CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";
const D = "t1DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD";

const BLOCKS: Fx[] = [
  // D0: two Foundry blocks (one lower-case), one NiceHash, one shielded coinbase.
  {
    height: 100,
    ts: D0 + 100,
    kind: "transparent",
    address: A,
    reward: 125_001_000,
    fee: 1_000,
    tag: `Foundry Zcash Pool ${ZEBRA_COINBASE_MARK}`,
    txCount: 3,
  },
  {
    height: 101,
    ts: D0 + 200,
    kind: "transparent",
    address: A,
    reward: 125_002_000,
    fee: 2_000,
    tag: "foundry zcash pool",
    txCount: 1,
  },
  {
    height: 102,
    ts: D0 + 300,
    kind: "transparent",
    address: B,
    reward: 125_000_500,
    fee: 500,
    tag: "/NiceHash/",
    txCount: 2,
  },
  {
    height: 103,
    ts: D0 + 400,
    kind: "shielded",
    reward: null,
    fee: 0,
    tag: ZEBRA_COINBASE_MARK,
    txCount: 1,
  },
  // D1: both needles in one tag (the first signature wins), a block with no fee total, a
  // worker-named tag that is no signature, and a miner paid to a bare public key.
  {
    height: 104,
    ts: D1 + 100,
    kind: "transparent",
    address: A,
    reward: 125_003_000,
    fee: 3_000,
    tag: "Foundry Zcash Pool /NiceHash/",
    txCount: 4,
  },
  {
    height: 105,
    ts: D1 + 200,
    kind: "transparent",
    address: B,
    reward: 125_000_000,
    fee: null,
    tag: "/NiceHash/",
    txCount: 1,
  },
  {
    height: 106,
    ts: D1 + 300,
    kind: "transparent",
    address: C,
    reward: 125_000_000,
    fee: 0,
    tag: `${ZEBRA_COINBASE_MARK}Mined by duan8626aTpn%`,
    txCount: 1,
  },
  {
    height: 107,
    ts: D1 + 400,
    kind: "unknown",
    reward: null,
    fee: 0,
    tag: "X/nodeStratum/",
    txCount: 1,
  },
  // D3: two tags carrying both needles and one carrying NiceHash alone. First match gives
  // Foundry 2 against NiceHash 1; counting every needle would give NiceHash 3 against Foundry 2.
  {
    height: 108,
    ts: D3 + 100,
    kind: "transparent",
    address: D,
    reward: 125_000_000,
    fee: 0,
    tag: "Foundry Zcash Pool /NiceHash/",
    txCount: 1,
  },
  {
    height: 109,
    ts: D3 + 200,
    kind: "transparent",
    address: D,
    reward: 125_000_000,
    fee: 0,
    tag: "Foundry Zcash Pool /NiceHash/",
    txCount: 1,
  },
  {
    height: 110,
    ts: D3 + 300,
    kind: "transparent",
    address: D,
    reward: 125_000_000,
    fee: 0,
    tag: "/NiceHash/",
    txCount: 1,
  },
  // D4, "today": inside the 24-hour window, one with no difficulty and one not recorded yet.
  {
    height: 111,
    ts: NOW - 3_600,
    kind: "transparent",
    address: B,
    reward: 125_000_000,
    fee: 0,
    tag: ZEBRA_COINBASE_MARK,
    txCount: 2,
  },
  {
    height: 112,
    ts: NOW - 1_800,
    kind: "transparent",
    address: A,
    reward: 125_000_100,
    fee: 100,
    tag: "Foundry Zcash Pool",
    difficulty: null,
    txCount: 1,
  },
  { height: 113, ts: NOW - 600, kind: null, reward: null, fee: null, tag: null, txCount: 1 },
];

async function insertBlock(pool: Pool, b: Fx): Promise<void> {
  await pool.query(
    `INSERT INTO block (height, hash, prev_hash, timestamp, size_bytes, tx_count, total_fee_zat,
                        miner_kind, miner_address, coinbase_tag, difficulty, miner_reward_zat)
     VALUES ($1, $2, $3, $4, 1000, $5, $6, $7, $8, $9, $10, $11)`,
    [
      b.height,
      `h${b.height}`.padEnd(64, "0"),
      `p${b.height}`.padEnd(64, "0"),
      b.ts,
      b.txCount ?? 1,
      b.fee,
      b.kind,
      b.kind === "transparent" ? b.address : null,
      b.tag,
      b.difficulty === undefined ? 100 + b.height : b.difficulty,
      b.reward ?? null,
    ],
  );
}

describeDb("mining", () => {
  let pool: Pool;

  beforeAll(async () => {
    const admin = new Pool({ connectionString: withDatabase(DATABASE_URL!, "postgres"), max: 1 });
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${TEST_DB}`);
    await admin.end();
    pool = new Pool({ connectionString: withDatabase(DATABASE_URL!, TEST_DB) });
    await pool.query(readFileSync("server/schema-chain.sql", "utf8"));
    await pool.query(readFileSync("server/schema.sql", "utf8"));
    for (const b of BLOCKS) await insertBlock(pool, b);
  });

  afterAll(async () => {
    await pool?.end();
  });

  describe("the /mining overview", () => {
    const inWindow = (span: number) => BLOCKS.filter((b) => b.ts >= NOW - span && b.ts <= NOW);

    it("names a group by the domain's own first-match rule, never by a second copy of it", async () => {
      const o = (await loadMiningOverview(pool, "7d", NOW))!;
      const transparent = o.groups.filter((g) => g.address !== null);
      expect(transparent.map((g) => g.address).sort()).toEqual([A, B, C, D]);
      for (const g of transparent) {
        const tags = BLOCKS.filter((b) => b.kind === "transparent" && b.address === g.address);
        // What `selfDeclaredMiner` says block by block, folded the way the SQL folds it.
        const counts = MINER_SIGNATURES.map(
          (s) => tags.filter((b) => selfDeclaredMiner(b.tag) === s.name).length,
        );
        const best = counts.indexOf(Math.max(...counts));
        const name = counts[best]! > 0 ? MINER_SIGNATURES[best]!.name : null;
        expect({ address: g.address, name: g.name, declared: g.selfDeclaredBlocks }).toEqual({
          address: g.address,
          name,
          declared: name === null ? 0 : counts[best],
        });
        expect(g.basis).toBe(name === null ? "unattributed" : "self-declared");
      }
      // A tag carrying both needles counts for the FIRST signature only.
      expect(transparent.find((g) => g.address === A)).toMatchObject({
        name: "Foundry USA",
        selfDeclaredBlocks: 4,
      });
      expect(transparent.find((g) => g.address === D)).toMatchObject({
        name: "Foundry USA",
        selfDeclaredBlocks: 2,
      });
    });

    it("sums rewards, keeps a fee total null unless every block has one, and counts every block", async () => {
      const o = (await loadMiningOverview(pool, "7d", NOW))!;
      const rows = inWindow(7 * DAY);
      const of = (address: string) => o.groups.find((g) => g.address === address)!;
      const sum = (xs: Fx[], f: (b: Fx) => number) => xs.reduce((s, b) => s + f(b), 0);
      const mined = (address: string) => rows.filter((b) => b.address === address);
      expect(of(A).rewardZat).toBe(sum(mined(A), (b) => b.reward!));
      expect(of(A).feeZat).toBe(sum(mined(A), (b) => b.fee!));
      // One of B's blocks has no fee total: the group's is unknown, never the partial sum.
      expect(of(B).feeZat).toBeNull();
      expect(of(C).avgIntervalSeconds).toBeNull();
      // The shielded coinbase is a group with no address; the bare-key and unrecorded blocks are
      // no group at all, yet every block is in the denominator.
      expect(o.groups.filter((g) => g.address === null)).toHaveLength(1);
      expect(o.window.blocks).toBe(rows.length);
      expect(o.window.avgFeeZat).toBeNull();
      expect(o.window.spanSeconds).toBe(
        Math.max(...rows.map((b) => b.ts)) - Math.min(...rows.map((b) => b.ts)),
      );
      expect(o.window.avgTxCount).toBeCloseTo(sum(rows, (b) => (b.txCount ?? 1) - 1) / rows.length);
      expect(o.software.zebra).toBe(
        rows.filter((b) => b.tag?.includes(ZEBRA_COINBASE_MARK)).length,
      );
      expect(o.software.zebra + o.software.unidentified).toBe(rows.length);
      // Exact header values only: a block with no recorded difficulty is not a trend point.
      expect(o.trend.map((t) => t.height)).not.toContain(112);
      expect(o.trend.every((t) => t.difficulty === 100 + t.height)).toBe(true);
    });

    it("a rolling window reaches back exactly its length", async () => {
      const o = (await loadMiningOverview(pool, "24h", NOW))!;
      const rows = inWindow(DAY);
      expect(o.window.blocks).toBe(rows.length);
      expect([o.window.fromHeight, o.window.toHeight]).toEqual([111, 113]);
      expect(o.groups.map((g) => g.address).sort()).toEqual([A, B]);
      // An average fee over a window with a block whose fee is unknown is unknown.
      expect(o.window.avgFeeZat).toBeNull();
    });

    it("asks the node for the solution rate only over a short span, and drops a non-answer", async () => {
      const asked: [number, number][] = [];
      const o = (await loadMiningOverview(pool, "7d", NOW, async (n, h) => {
        asked.push([n, h]);
        return 5e9;
      }))!;
      expect(asked).toEqual([[o.window.blocks, 113]]);
      expect(o.window.solutionsPerSecond).toBe(5e9);
      const zero = (await loadMiningOverview(pool, "7d", NOW, async () => 0))!;
      expect(zero.window.solutionsPerSecond).toBeNull();
      const broken = (await loadMiningOverview(pool, "7d", NOW, async () => {
        throw new Error("node down");
      }))!;
      expect(broken.window.solutionsPerSecond).toBeNull();
    });
  });

  describe("the per-day table", () => {
    it("files a day's miners under its UTC date, whatever the session's time zone", async () => {
      const honolulu = new Pool({
        connectionString: withDatabase(DATABASE_URL!, TEST_DB),
        options: "-c TimeZone=Pacific/Honolulu",
      });
      try {
        expect(await computeMiningDay(honolulu, D0, NOW)).toEqual({ blocks: 4, unrecorded: 0 });
      } finally {
        await honolulu.end();
      }
      const { rows } = await pool.query<{
        day: string;
        kind: string;
        address: string;
        blocks: number;
        reward: string | null;
        fee: string;
        fee_blocks: number;
      }>(
        `SELECT EXTRACT(EPOCH FROM day)::bigint::text AS day, kind, address, blocks,
                reward_zat::text AS reward, fee_zat::text AS fee, fee_blocks
           FROM mining_day_payout ORDER BY kind, address`,
      );
      expect(rows).toEqual([
        {
          day: String(D0),
          kind: "shielded",
          address: "",
          blocks: 1,
          reward: null,
          fee: "0",
          fee_blocks: 1,
        },
        {
          day: String(D0),
          kind: "transparent",
          address: A,
          blocks: 2,
          reward: "250003000",
          fee: "3000",
          fee_blocks: 2,
        },
        {
          day: String(D0),
          kind: "transparent",
          address: B,
          blocks: 1,
          reward: "125000500",
          fee: "500",
          fee_blocks: 1,
        },
      ]);
    });

    it("replaces a day whole: a recompute drops an address the day no longer has", async () => {
      await pool.query(
        "UPDATE block SET miner_kind = NULL, miner_address = NULL WHERE height = 102",
      );
      try {
        expect(await computeMiningDay(pool, D0, NOW)).toEqual({ blocks: 4, unrecorded: 1 });
        const { rows } = await pool.query<{ address: string }>(
          "SELECT address FROM mining_day_payout WHERE kind = 'transparent' ORDER BY address",
        );
        expect(rows.map((r) => r.address)).toEqual([A]);
      } finally {
        await pool.query(
          "UPDATE block SET miner_kind = 'transparent', miner_address = $1 WHERE height = 102",
          [B],
        );
      }
      expect(await computeMiningDay(pool, D0, NOW)).toEqual({ blocks: 4, unrecorded: 0 });
    });

    it("recomputes a day with unrecorded blocks hourly at most, until it is whole", async () => {
      // D1 computed long ago with an unrecorded block: due. D0 complete: settled. D2 and D3 (no
      // blocks) never computed: due. The newest three, whatever their state: due.
      await computeMiningDay(pool, D1, NOW);
      await pool.query(
        "UPDATE mining_day SET unrecorded_blocks = 1, computed_at = $1 WHERE day = '2026-10-02'",
        [NOW - 2 * 3600],
      );
      const due = await miningDaysToCompute(pool, D0, D4 + 6 * DAY, NOW);
      expect(due).toContain(D1);
      expect(due).not.toContain(D0);
      // Recomputed half an hour ago: not due again yet.
      await pool.query("UPDATE mining_day SET computed_at = $1 WHERE day = '2026-10-02'", [
        NOW - 1800,
      ]);
      expect(await miningDaysToCompute(pool, D0, D4 + 6 * DAY, NOW)).not.toContain(D1);
      // Put D1 back as it really is: whole.
      expect(await computeMiningDay(pool, D1, NOW)).toEqual({ blocks: 4, unrecorded: 0 });
    });

    it("the tracker fills every day of the chain, beside pool usage", async () => {
      const pacer = (): Pacer => ({
        preflight: async () => {},
        afterUnit: async () => "continue",
        stats: { sleptMs: 0, stallSamples: 0, maxBlocksBehind: 0 },
      });
      const tracker = new PoolUsageTracker({
        pool,
        trees: async () => ({ sapling: 0, orchard: 0, ironwood: 0 }),
        pacer,
        log: () => {},
        now: () => NOW * 1000,
      });
      const pass = await tracker.refresh();
      expect(pass.aborted).toBe(false);
      const { rows } = await pool.query<{ day: string; blocks: number; unrecorded: number }>(
        `SELECT EXTRACT(EPOCH FROM day)::bigint::text AS day, blocks,
                unrecorded_blocks AS unrecorded FROM mining_day ORDER BY day`,
      );
      expect(rows.map((r) => [Number(r.day), r.blocks, r.unrecorded])).toEqual([
        [D0, 4, 0],
        [D1, 4, 0],
        [D0 + 2 * DAY, 0, 0],
        [D3, 3, 0],
        [D4, 3, 1],
      ]);
    });

    it("sums a window with competition ranks, address-less kinds apart, the newest tag beside each", async () => {
      const w = await loadMinerWindow(pool, D0, D0 + 2 * DAY, 25);
      expect(w).toMatchObject({
        daysComputed: 2,
        blocks: 8,
        unrecordedBlocks: 0,
        fromHeight: 100,
        toHeight: 107,
        transparent: { blocks: 6, addresses: 3 },
        shieldedBlocks: 1,
        noAddressBlocks: 1,
        topBlocks: { top1: 3, top3: 6, top10: 6 },
      });
      expect(w.top.map((r) => [r.rank, r.address, r.blocks])).toEqual([
        [1, A, 3],
        [2, B, 2],
        [3, C, 1],
      ]);
      expect(w.top[0]).toMatchObject({
        rewardZat: 125_001_000 + 125_002_000 + 125_003_000,
        feeZat: 6_000,
        lastHeight: 104,
        newestCoinbaseTag: "Foundry Zcash Pool /NiceHash/",
      });
      // One of B's blocks has no fee total.
      expect(w.top[1]!.feeZat).toBeNull();
      // Ties share a rank.
      const d1 = await loadMinerWindow(pool, D1, D1 + DAY, 25);
      expect(d1.top.map((r) => [r.rank, r.address])).toEqual([
        [1, A],
        [1, B],
        [1, C],
      ]);
      // A short list still carries the top-ten sum, and the unrecorded block of today shows.
      const all = await loadMinerWindow(pool, 0, D4 + DAY, 1);
      expect(all.top).toHaveLength(1);
      expect(all.topBlocks.top10).toBe(all.transparent.blocks);
      expect(all.unrecordedBlocks).toBe(1);
      expect(all.chainFirstDay).toBe(D0);
      expect(all.daysComputed).toBe(5);
    });
  });

  describe("a window's height range from the per-day bounds", () => {
    // Runs after the tracker test, so every fixture day is computed WITH its bounds.
    const FAR = NOW + 365 * DAY;
    const windows: [number, number][] = [
      [D0, D0 + DAY],
      [D0, D4 + DAY],
      [D1, D3],
      [0, D4 + DAY],
      [D4, D4 + DAY],
      [D0 - 30 * DAY, D0],
    ];

    it("equals the exact scan for every window, whatever is still live", async () => {
      for (const [from, to] of windows) {
        const exact = await blockHeightRange(pool, from, to);
        for (const now of [NOW, FAR]) {
          expect(await windowHeightRange(pool, from, to, now), `${from}..${to} @${now}`).toEqual(
            exact,
          );
        }
      }
    });

    it("reads the stored bounds for a settled day — and falls back when one is missing", async () => {
      // Proof the fast path reads the table: a different stored bound shows through.
      await pool.query("UPDATE mining_day SET last_height = 999 WHERE day = '2026-10-02'");
      try {
        expect(await windowHeightRange(pool, D0, D0 + 2 * DAY, FAR)).toEqual({ lo: 100, hi: 999 });
        // A day computed before the bounds existed sends the window to the exact scan.
        await pool.query("UPDATE mining_day SET first_height = NULL WHERE day = '2026-10-01'");
        expect(await windowHeightRange(pool, D0, D0 + 2 * DAY, FAR)).toEqual(
          await blockHeightRange(pool, D0, D0 + 2 * DAY),
        );
      } finally {
        await computeMiningDay(pool, D0, NOW);
        await computeMiningDay(pool, D1, NOW);
      }
      // A window that is not whole days never takes the fast path.
      expect(await windowHeightRange(pool, D0 + 150, D1 + 250, FAR)).toEqual(
        await blockHeightRange(pool, D0 + 150, D1 + 250),
      );
    });

    it("reads today and yesterday live, and falls back over a day the table lacks", async () => {
      // A block that lands after the tracker's pass: the stored bound for today is one behind.
      await insertBlock(pool, {
        height: 114,
        ts: NOW - 60,
        kind: "transparent",
        address: A,
        reward: 1,
        fee: 0,
        tag: null,
      });
      try {
        expect((await windowHeightRange(pool, D0, D4 + DAY, NOW)).hi).toBe(114);
        // No row at all for a settled day: the exact scan, so a tampered neighbour stays hidden.
        await pool.query("UPDATE mining_day SET last_height = 999 WHERE day = '2026-10-01'");
        await pool.query("DELETE FROM mining_day WHERE day = '2026-10-02'");
        expect(await windowHeightRange(pool, D0, D3, FAR)).toEqual(
          await blockHeightRange(pool, D0, D3),
        );
      } finally {
        await pool.query("DELETE FROM block WHERE height = 114");
        await computeMiningDay(pool, D0, NOW);
        await computeMiningDay(pool, D1, NOW);
      }
    });

    it("recomputes a day that has blocks but no bounds", async () => {
      await pool.query("UPDATE mining_day SET first_height = NULL WHERE day = '2026-10-02'");
      try {
        expect(await miningDaysToCompute(pool, D0, D4, FAR)).toContain(D1);
      } finally {
        await computeMiningDay(pool, D1, NOW);
      }
      expect(await miningDaysToCompute(pool, D0, D4 + 6 * DAY, FAR)).not.toContain(D1);
    });
  });

  describe("/chain/mining", () => {
    it("asks the node only up to the bound, and answers 503 for a window with no blocks", async () => {
      // A year of filler, older than 90 days, takes the 1y window past the bound.
      await pool.query(
        `INSERT INTO block (height, hash, prev_hash, timestamp, size_bytes, tx_count, miner_kind,
                            miner_address, miner_reward_zat, difficulty)
         SELECT g, 'f' || lpad(g::text, 63, '0'), 'q' || lpad(g::text, 63, '0'),
                $1::bigint + g, 1000, 1, 'transparent', 't1old', 1, 1
           FROM generate_series(1000, $2::int) AS g`,
        [NOW - 200 * DAY - 1000, 1000 + NODE_SOLPS_MAX_BLOCKS],
      );
      const asked: number[] = [];
      const app = miningRoutes({
        pool,
        solpsOver: async (n) => {
          asked.push(n);
          return 7e9;
        },
        now: () => NOW * 1000,
      });
      const year = await (await app.request("/chain/mining?window=1y")).json();
      expect(year.window.key).toBe("1y");
      expect(year.window.blocks).toBeGreaterThan(NODE_SOLPS_MAX_BLOCKS);
      expect(year.window.solutionsPerSecond).toBeNull();
      expect(asked).toEqual([]);
      const week = await (await app.request("/chain/mining?window=7d")).json();
      expect(week.window.solutionsPerSecond).toBe(7e9);
      expect(asked).toEqual([BLOCKS.length]);
      const later = miningRoutes({
        pool,
        solpsOver: async () => null,
        now: () => (NOW + 30 * DAY) * 1000,
      });
      expect((await later.request("/chain/mining?window=24h")).status).toBe(503);
    });
  });
});
