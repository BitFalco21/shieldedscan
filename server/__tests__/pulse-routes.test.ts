import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { readFileSync } from "node:fs";
import type { Hono } from "hono";
import type { CrossChainTransfer, PulseEvent, PulseFrame, PulseWindowFrame } from "@/domain";
import { ChainIndexStore } from "../chain-index-store";
import type { NodeChainSource } from "../chain-source";
import {
  PULSE_EVENTS_PER_BLOCK,
  PULSE_FRAME_BLOCKS,
  PULSE_FRAME_SWAPS,
  pulseRoutes,
} from "../pulse-routes";
import type { PulseRibbonsPayload } from "../pulse-ribbons";
import { MemoryStorePort } from "../crosschain-store";

/**
 * The four `/chain/pulse` routes, against a real database. A fake store would reimplement the SQL
 * these routes are made of (the half-open window, the per-block cap, the two-step ledger read), so
 * this runs the real `ChainIndexStore` and matviews over a fixture chain; the cross-chain side
 * runs the real `MemoryStorePort`.
 *
 * Skips without TEST_DATABASE_URL and creates its own database:
 *
 *   TEST_DATABASE_URL=postgres://test:test@127.0.0.1:55433/test \
 *     npx vitest run server/__tests__/pulse-routes.test.ts
 */
const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

const TEST_DB = "explorer_pulse_routes_test";

function withDatabase(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

async function createTestDatabase(url: string): Promise<string> {
  const admin = new Pool({ connectionString: withDatabase(url, "postgres"), max: 1 });
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${TEST_DB}`);
  } finally {
    await admin.end();
  }
  return withDatabase(url, TEST_DB);
}

/**
 * The fixture chain sits inside ONE aligned hour, with a block on each of its edges.
 *
 * `HOUR` is a real UTC hour boundary. A block exactly at `HOUR` must be in the window and a
 * block exactly at `HOUR + 3600` must not — half-open, so no block is drawn by two adjacent
 * windows and none falls between them.
 */
const HOUR = Math.floor(Date.UTC(2026, 2, 4, 12) / 1000);
const NOW = HOUR + 3 * 3600;
const hash = (h: number): string => `h${h}`.padEnd(64, "0");
const txid = (label: string): string => label.padEnd(64, "0");

/** A transparent output belonging to the block at `height`, so the ledger has real rows. */
interface Fixture {
  height: number;
  timestamp: number;
  /** Our follower's arrival clock. Null exercises the heartbeat's gap. */
  receivedAt: number | null;
  lockbox: number | null;
  /** Deliberately breaks the chain when set, so a lockbox delta must refuse. */
  prevHash?: string;
  txs: TxFixture[];
}

interface TxFixture {
  txid: string;
  kind: "transparent" | "mixed" | "shielded" | "coinbase";
  direction?: "shielding" | "unshielding" | "indeterminate";
  ins?: number[];
  outs?: number[];
  /** RPC sign, exactly as the column stores it: positive means value LEFT Sprout. */
  sproutVpubNet?: number;
  sapling?: number;
  orchard?: number;
}

/**
 * Blocks below the interesting ones, so the chain is longer than a frame and `/frame`'s
 * extra-row path (one block beyond what it draws, used as the oldest block's predecessor) runs.
 * They carry no transactions and repeat the same pool closes.
 */
const FILLERS: Fixture[] = Array.from({ length: PULSE_FRAME_BLOCKS }, (_, i) => ({
  height: 987 + i,
  timestamp: HOUR - 60 - (PULSE_FRAME_BLOCKS - i) * 75,
  receivedAt: HOUR - 55 - (PULSE_FRAME_BLOCKS - i) * 75,
  lockbox: 1_000_000_000,
  txs: [],
}));

const FIXTURES: Fixture[] = [
  // The hour BEFORE the window: the predecessor every first block needs for its interval and
  // its lockbox delta, and a block the window itself must not return.
  {
    height: 999,
    timestamp: HOUR - 60,
    receivedAt: HOUR - 55,
    lockbox: 1_000_000_000,
    txs: [{ txid: txid("cb999"), kind: "coinbase", outs: [312_500_000] }],
  },
  {
    height: 1000,
    timestamp: HOUR, // exactly the window's lower edge — INCLUDED
    receivedAt: HOUR + 5,
    lockbox: 1_100_000_000, // +1 ZEC on a chained predecessor: a lockbox pulse
    txs: [
      { txid: txid("cb1000"), kind: "coinbase", outs: [312_500_000] },
      {
        txid: txid("shield"),
        kind: "mixed",
        direction: "shielding",
        ins: [600_000_000],
        sapling: 500_000_000,
      },
    ],
  },
  {
    height: 1001,
    timestamp: HOUR + 600,
    // BOTH arrivals recorded and the lockbox GREW — so every other reason to refuse is absent
    // and only the broken chain is left. Without a `received_at` on both sides the interval
    // would be null anyway and the guard could not be falsified.
    receivedAt: HOUR + 610,
    lockbox: 1_500_000_000,
    prevHash: hash(9999),
    txs: [
      {
        txid: txid("sprout"),
        kind: "mixed",
        direction: "unshielding",
        outs: [500_000_000],
        sproutVpubNet: 500_000_000,
      },
      {
        txid: txid("sprouthub"),
        kind: "mixed",
        direction: "indeterminate",
        ins: [100_000_000],
        outs: [50_000_000],
        sproutVpubNet: 500_000_000,
        orchard: 400_000_000,
        // Orchard gained while Sapling FELL, so no direction is settled and the stored column
        // says `indeterminate` — which is what the domain's own `txDirection` returns here.
        sapling: -100_000_000,
      },
    ],
  },
  {
    height: 1002,
    timestamp: HOUR + 1200,
    receivedAt: null, // the heartbeat has no interval to state here, and must say so
    lockbox: null, // and no lockbox delta either — never a zero
    txs: [{ txid: txid("swapleg"), kind: "transparent", ins: [200_000_000], outs: [199_990_000] }],
  },
  // The next hour's first block: exactly the window's upper edge — EXCLUDED.
  {
    height: 1003,
    timestamp: HOUR + 3600,
    receivedAt: HOUR + 3605,
    lockbox: 1_600_000_000,
    txs: [{ txid: txid("cb1003"), kind: "coinbase", outs: [312_500_000] }],
  },
];

/**
 * A real-SHAPED transparent address, which is load-bearing: `classifyZcashAddress` reads the
 * string, so a made-up `t1Somebody` classifies as null and its crossing correctly ends at the
 * hub. A fixture that cannot express a transparent delivery would leave that end untested.
 */
const T_ADDRESS = "t1KsPQGBHNbSpMhBmzL9wjXQMYyxYUcvHAo";

const transfer = (over: Partial<CrossChainTransfer>): CrossChainTransfer => ({
  id: "near-intents:1",
  direction: "in",
  protocol: "near-intents",
  counterpartChain: "BTC",
  counterpartAsset: "BTC",
  counterpartAmount: 1,
  counterpartIsSynthetic: false,
  counterpartTxHash: null,
  counterpartAddress: null,
  zcashTxid: null,
  zcashAddress: T_ADDRESS,
  zecAmountZat: 100_000_000,
  usdValueAtSwap: null,
  counterpartUsdAtSwap: null,
  venueDepositAddress: null,
  status: "completed",
  timestamp: HOUR + 1200,
  ...over,
});

const TRANSFERS: CrossChainTransfer[] = [
  // Its Zcash leg IS in the frame, so it folds into that transaction's own pulse.
  transfer({ id: "near-intents:paired", zcashTxid: txid("swapleg") }),
  // Delivered to a unified address: it ends at the boundary hub, never the transparent box.
  transfer({
    id: "near-intents:unified",
    zcashAddress: `u1${"q".repeat(60)}`,
    counterpartChain: "ETH",
    zecAmountZat: 50_000_000,
  }),
  // Never happened: a pending crossing must not be drawn as an arrival.
  transfer({ id: "near-intents:pending", status: "pending", zecAmountZat: 900_000_000 }),
  // Undone: same rule.
  transfer({ id: "near-intents:refunded", status: "refunded", zecAmountZat: 800_000_000 }),
];

const legsOf = (event: PulseEvent | undefined): unknown =>
  event?.legs.map((l) => [l.from, l.to, l.amountZat]);

describeDb("the /chain/pulse routes", () => {
  let pool: Pool;
  let app: Hono;
  let store: MemoryStorePort;

  const get = async (path: string): Promise<Response> => app.request(`http://x${path}`);

  beforeAll(async () => {
    const url = await createTestDatabase(DATABASE_URL as string);
    pool = new Pool({ connectionString: url });
    await pool.query(readFileSync("server/schema-chain.sql", "utf8"));

    for (const f of [...FILLERS, ...FIXTURES]) {
      await pool.query(
        `INSERT INTO block (height, hash, prev_hash, timestamp, received_at, size_bytes,
                            tx_count, total_fee_zat,
                            transparent_pool_zat, sprout_pool_zat, sapling_pool_zat,
                            orchard_pool_zat, ironwood_pool_zat, lockbox_pool_zat)
         VALUES ($1, $2, $3, $4, $5, 1000, $6, 10000, 1000000, 20, 30, 40, 50, $7)`,
        [
          f.height,
          hash(f.height),
          f.prevHash ?? hash(f.height - 1),
          f.timestamp,
          f.receivedAt,
          f.txs.length,
          f.lockbox,
        ],
      );
      for (const t of f.txs) {
        await pool.query(
          `INSERT INTO tx (txid, block_height, timestamp, is_coinbase, kind, direction,
                           version, size_bytes, fee_zat, sprout_joinsplits, sprout_vpub_net_zat,
                           sapling_spends, sapling_outputs, sapling_value_balance_zat,
                           orchard_actions, orchard_value_balance_zat)
           VALUES ($1, $2, $3, $4, $5, $6, 5, 200, 10000, $7, $8, $9, $10, $11, $12, $13)`,
          [
            t.txid,
            f.height,
            f.timestamp,
            t.kind === "coinbase",
            t.kind,
            t.direction ?? null,
            t.sproutVpubNet === undefined ? null : 2,
            t.sproutVpubNet ?? null,
            t.sapling === undefined ? null : 1,
            t.sapling === undefined ? null : 1,
            t.sapling ?? null,
            t.orchard === undefined ? null : 2,
            t.orchard ?? null,
          ],
        );
        let ordinal = 0;
        for (const value of t.outs ?? []) {
          await pool.query(
            `INSERT INTO tx_transparent_io (txid, io, ordinal, address, value_zat, block_height)
             VALUES ($1, 'out', $2, $3, $4, $5)`,
            [t.txid, ordinal, `t1out${ordinal}`, value, f.height],
          );
          ordinal += 1;
        }
        ordinal = 0;
        for (const value of t.ins ?? []) {
          await pool.query(
            `INSERT INTO tx_transparent_io (txid, io, ordinal, address, value_zat, block_height)
             VALUES ($1, 'in', $2, $3, $4, $5)`,
            [t.txid, ordinal, `t1in${ordinal}`, value, f.height],
          );
          ordinal += 1;
        }
      }
    }

    store = new MemoryStorePort();
    await store.upsert(TRANSFERS);

    app = pulseRoutes({
      index: new ChainIndexStore(pool),
      pool,
      store,
      // Only the tip is read from the node here; everything else comes from the index.
      source: { getTipHeight: async () => 1003 } as unknown as NodeChainSource,
      mempool: null,
      now: () => NOW * 1000,
    });
  });

  afterAll(async () => {
    await pool?.end();
  });

  describe("the window", () => {
    const window = async (from: number, to: number): Promise<Response> =>
      get(`/chain/pulse/window?from=${from}&to=${to}`);

    it("refuses anything that is not exactly one aligned hour", async () => {
      // Each of these is a well-formed request for a window this endpoint does not serve, and
      // a silent widening would answer a different question under the caller's own label.
      for (const [from, to] of [
        [HOUR + 60, HOUR + 60 + 3600], // not aligned to the hour
        [HOUR, HOUR + 1800], // half an hour
        [HOUR, HOUR + 7200], // two hours
        [HOUR, HOUR], // no span at all
        [NOW + 7200, NOW + 7200 + 3600], // further ahead than a clock skew explains
      ] as const) {
        expect((await window(from, to)).status).toBe(400);
      }
      expect((await get("/chain/pulse/window")).status).toBe(400);
      // An empty parameter is not a zero: `Number("")` is 0, which would answer for the first
      // hour of 1970 under the caller's own label.
      expect((await get("/chain/pulse/window?from=&to=3600")).status).toBe(400);
      expect((await get("/chain/pulse/window?from=abc&to=def")).status).toBe(400);
      expect((await get(`/chain/pulse/window?from=${HOUR}.5&to=${HOUR + 3600}.5`)).status).toBe(
        400,
      );
    });

    it("echoes the window it cut, so a caller can refuse an answer to another question", async () => {
      const body = (await (await window(HOUR, HOUR + 3600)).json()) as PulseWindowFrame;
      expect(body.applied).toEqual({ fromSeconds: HOUR, toSeconds: HOUR + 3600 });
    });

    it("is half-open: the lower edge is in and the upper edge is out", async () => {
      const body = (await (await window(HOUR, HOUR + 3600)).json()) as PulseWindowFrame;
      expect(body.blocks.map((b) => b.pools.height)).toEqual([1000, 1001, 1002]);
      // And the excluded block is the FIRST block of the next window, drawn exactly once.
      const next = (await (await window(HOUR + 3600, HOUR + 7200)).json()) as PulseWindowFrame;
      expect(next.blocks.map((b) => b.pools.height)).toEqual([1003]);
    });

    it("does not remember an hour the INDEX has not yet moved past, whatever our clock says", async () => {
      // Settled is a fact about the CHAIN: an hour is safe to remember once the tip has moved
      // past reorg reach of it. Gated on the wall clock instead, a stalled follower would have
      // this hour cached — hours old by our clock, and still the tip.
      const stale = pulseRoutes({
        index: new ChainIndexStore(pool),
        pool,
        store,
        source: { getTipHeight: async () => 1003 } as unknown as NodeChainSource,
        mempool: null,
        // A full day past the window, while the index's newest block sits at its upper edge.
        now: () => (HOUR + 86_400) * 1000,
      });
      const ask = async (): Promise<PulseWindowFrame> =>
        (await (
          await stale.request(`http://x/chain/pulse/window?from=${HOUR}&to=${HOUR + 3600}`)
        ).json()) as PulseWindowFrame;

      expect((await ask()).blocks).toHaveLength(3);
      await pool.query(
        `INSERT INTO block (height, hash, prev_hash, timestamp, received_at, size_bytes,
                            tx_count, total_fee_zat, lockbox_pool_zat)
         VALUES (1005, $1, $2, $3, $4, 1000, 0, 10000, NULL)`,
        [hash(1005), hash(1004), HOUR + 1800, HOUR + 1805],
      );
      try {
        expect((await ask()).blocks).toHaveLength(4);
      } finally {
        await pool.query("DELETE FROM block WHERE height = 1005");
      }
    });

    it("measures the first block's interval against the block BEFORE the window", async () => {
      const body = (await (await window(HOUR, HOUR + 3600)).json()) as PulseWindowFrame;
      // 999 arrived at HOUR-55 and 1000 at HOUR+5; without the predecessor fetch the oldest
      // block of every hour would silently lose its interval.
      expect(body.blocks[0]?.intervalSeconds).toBe(60);
    });

    it("states a gap rather than an interval when either arrival was not recorded", async () => {
      const body = (await (await window(HOUR, HOUR + 3600)).json()) as PulseWindowFrame;
      // 1002 recorded no arrival, so it has no interval to state.
      expect(body.blocks[2]?.intervalSeconds).toBeNull();
    });

    it("carries THIS hour's transparent outputs, never the chain's newest", async () => {
      // The live endpoint lists the newest outputs on the chain; drawing those under a clock set in
      // the past would place true rows at the wrong time.
      const body = (await (await window(HOUR, HOUR + 3600)).json()) as PulseWindowFrame;
      const rows = body.ledger ?? [];
      // Every output the hour's three blocks carried, and nothing from 999 or 1003.
      expect(rows.map((r) => [r.height, r.valueZat])).toEqual([
        [1002, 199_990_000],
        [1001, 500_000_000],
        [1001, 50_000_000],
        [1000, 312_500_000],
      ]);
      for (const row of rows) {
        expect(row.blockHash).toBe(hash(row.height));
        expect(row.address).toMatch(/^t1/);
      }
      // Nothing was cut, so the hour says nothing about a cap.
      expect(body.ledgerTruncated).toBeUndefined();
    });

    it("keeps the hour's own rows out of the adjacent one", async () => {
      const next = (await (await window(HOUR + 3600, HOUR + 7200)).json()) as PulseWindowFrame;
      expect((next.ledger ?? []).map((r) => r.height)).toEqual([1003]);
    });

    it("spreads a cap ACROSS the hour rather than taking it off the newest end", async () => {
      // Asked of the store directly, since the route's cap is 200 and this hour holds four rows.
      // Three of four: a cap taken off the newest end would leave the hour's first block with
      // nothing, and a replay would show nothing for most of the hour.
      const index = new ChainIndexStore(pool);
      const page = await index.listLedgerRowsForHeights([1000, 1001, 1002], 3);
      expect(page.rows.map((r) => r.height)).toEqual([1002, 1001, 1000]);
      // EXACT rather than a guess: the read asks for one row more than it carries.
      expect(page.truncated).toBe(true);

      const whole = await index.listLedgerRowsForHeights([1000, 1001, 1002], 200);
      expect(whole.rows).toHaveLength(4);
      expect(whole.truncated).toBe(false);
    });

    it("asks nothing of the database for an hour with no blocks", async () => {
      const index = new ChainIndexStore(pool);
      expect(await index.listLedgerRowsForHeights([], 200)).toEqual({ rows: [], truncated: false });
    });

    it("refuses an interval across rows that do not chain, even with both arrivals", async () => {
      const body = (await (await window(HOUR, HOUR + 3600)).json()) as PulseWindowFrame;
      const broken = body.blocks[1]!;
      // 1001 names a parent we do not hold, so `previous` is not its parent — and blocks reach
      // a window by header timestamp, which is loosely monotonic, so this is reachable whenever
      // the index has a hole. Both arrivals ARE recorded, so a missing `received_at` cannot be
      // what makes this null.
      expect(broken.pools.receivedAt).not.toBeNull();
      expect(body.blocks[0]!.pools.receivedAt).not.toBeNull();
      expect(broken.intervalSeconds).toBeNull();
    });
  });

  describe("the movements", () => {
    let blocks: PulseWindowFrame["blocks"];

    beforeAll(async () => {
      const body = (await (
        await get(`/chain/pulse/window?from=${HOUR}&to=${HOUR + 3600}`)
      ).json()) as PulseWindowFrame;
      blocks = body.blocks;
    });

    it("draws the lockbox delta between two chained blocks", async () => {
      const lockbox = blocks[0]!.events.find((e) => e.kind === "lockbox");
      expect(legsOf(lockbox)).toEqual([["mined", "lockbox", 100_000_000]]);
    });

    it("draws no lockbox pulse where a close is missing or the rows do not chain", () => {
      // 1001 grew by 0.4 ZEC on a prev_hash that names no parent we hold, so the delta could
      // span a gap or a reorged sibling; 1002 has no close at all. Neither is a zero.
      expect(blocks[1]!.events.some((e) => e.kind === "lockbox")).toBe(false);
      expect(blocks[2]!.events.some((e) => e.kind === "lockbox")).toBe(false);
    });

    it("reads Sprout's stored RPC sign as value LEAVING the pool", () => {
      // `sprout_vpub_net_zat = +5e8` means 5 ZEC LEFT Sprout. The store negates it once, so
      // the leg is an unshielding of 5 ZEC — not a 5 ZEC shielding, which is what an unflipped
      // sign would have drawn.
      const event = blocks[1]!.events.find((e) => e.id === txid("sprout"));
      expect(legsOf(event)).toEqual([["sprout", "transparent", 500_000_000]]);
    });

    it("carries the SIGN into a hub leg, where the direction is the whole of the claim", () => {
      // A hub leg is signed: negative means value left that node. This is the one place a
      // flipped Sprout sign would state the opposite movement rather than the same magnitude.
      const event = blocks[1]!.events.find((e) => e.id === txid("sprouthub"));
      expect(event?.shape).toBe("hub");
      expect(legsOf(event)).toEqual([
        ["hub", "transparent", -50_000_000],
        ["hub", "orchard", 400_000_000],
        ["hub", "sapling", -100_000_000],
        ["hub", "sprout", -500_000_000],
      ]);
    });

    it("sizes a coinbase on the subsidy, its outputs less the fees it collected", () => {
      const coinbase = blocks[0]!.events.find((e) => e.kind === "coinbase");
      expect(coinbase?.subsidyZat).toBe(312_500_000 - 10_000);
      expect(coinbase?.subsidyIncludesFees).toBeUndefined();
    });

    it("folds a crossing into its own Zcash leg rather than drawing it twice", () => {
      const event = blocks[2]!.events.find((e) => e.id === txid("swapleg"));
      expect(event?.venue).toBe("near-intents");
      expect(event?.legs.some((l) => l.from === "chain:BTC")).toBe(true);
      // One movement, one mark: it is not also standing alone in `swaps`.
      expect(blocks[2]!.events.filter((e) => e.venue !== undefined)).toHaveLength(1);
    });

    it("ends a crossing delivered to a unified address at the hub, never the transparent box", async () => {
      const body = (await (
        await get(`/chain/pulse/window?from=${HOUR}&to=${HOUR + 3600}`)
      ).json()) as PulseWindowFrame;
      const unified = body.swaps.find((e) => e.id === "swap:near-intents:unified");
      expect(legsOf(unified)).toEqual([["chain:ETH", "hub", 50_000_000]]);
      // Placed at venue time and lighting no box: no block has recorded it.
      expect(unified?.height).toBeNull();
      expect(unified?.blockHash).toBeNull();
    });

    it("draws neither a pending crossing nor a refunded one", async () => {
      const body = (await (
        await get(`/chain/pulse/window?from=${HOUR}&to=${HOUR + 3600}`)
      ).json()) as PulseWindowFrame;
      const ids = [...body.swaps, ...body.blocks.flatMap((b) => b.events)].map((e) => e.id);
      expect(ids).not.toContain("swap:near-intents:pending");
      expect(ids).not.toContain("swap:near-intents:refunded");
    });
  });

  describe("the frame", () => {
    it("carries the tip, the newest closes, and the ledger rows", async () => {
      const body = (await (await get("/chain/pulse/frame")).json()) as PulseFrame;
      expect(body.tip).toBe(1003);
      // The boxes read the newest INDEXED block's own row — a balance and the height it was
      // measured at come from one row, never two calls.
      expect(body.stocks.height).toBe(1003);
      expect(body.stocks.pools.lockbox).toBe(1_600_000_000);
      // The newest twelve, and NOT the thirteenth block it also read: that one exists only to
      // be the oldest drawn block's predecessor.
      expect(body.blocks).toHaveLength(PULSE_FRAME_BLOCKS);
      expect(body.blocks.map((b) => b.pools.height)).toEqual([
        992, 993, 994, 995, 996, 997, 998, 999, 1000, 1001, 1002, 1003,
      ]);
      // The oldest drawn block HAS an interval, which is only possible if the thirteenth row
      // was fetched and used — the frame's own first block has no predecessor inside it.
      expect(body.blocks[0]!.intervalSeconds).toBe(75);
      expect(body.ledger.length).toBeGreaterThan(0);
      for (const row of body.ledger) {
        expect(row.address).toMatch(/^t1/);
        expect(row.valueZat).toBeGreaterThan(0);
        expect(row.blockHash).toBe(hash(row.height));
      }
    });

    it("says nothing about the mempool or the ribbons, rather than saying they are empty", async () => {
      const body = (await (await get("/chain/pulse/frame")).json()) as PulseFrame;
      // Absent means "this endpoint did not ask", where `{count: 0}` would be a measurement.
      expect(body.pending).toBeUndefined();
      expect(body.ribbons).toBeUndefined();
    });
  });

  describe("completeness", () => {
    it("caps a block at the figure rule 15 fixed, so raising it is a deliberate edit", () => {
      // The test below derives its fixture from this constant, so it proves the MECHANISM at
      // whatever the cap is; this line is what pins the cap itself. Consensus allows ~2,450
      // transactions in a block, and 300 is the point past which a block is a slice.
      expect(PULSE_EVENTS_PER_BLOCK).toBe(300);
    });

    it("marks a block truncated and keeps its true count, never a silent slice", async () => {
      // A block larger than the drawing cap. Consensus allows ~2,450 transactions in one.
      const big = HOUR + 7200;
      await pool.query(
        `INSERT INTO block (height, hash, prev_hash, timestamp, received_at, size_bytes,
                            tx_count, total_fee_zat, lockbox_pool_zat)
         VALUES (1004, $1, $2, $3, $4, 1000, $5, 10000, 1600000000)`,
        [hash(1004), hash(1003), big, big + 5, PULSE_EVENTS_PER_BLOCK + 1],
      );
      await pool.query(
        `INSERT INTO tx (txid, block_height, timestamp, is_coinbase, kind, version, size_bytes)
         SELECT lpad(to_hex(g), 64, '0'), 1004, $1, false, 'transparent', 5, 200
           FROM generate_series(1, $2) AS g`,
        [big, PULSE_EVENTS_PER_BLOCK + 1],
      );

      const body = (await (
        await get(`/chain/pulse/window?from=${big}&to=${big + 3600}`)
      ).json()) as PulseWindowFrame;
      const block = body.blocks[0]!;
      expect(block.events).toHaveLength(PULSE_EVENTS_PER_BLOCK);
      expect(block.eventCount).toBe(PULSE_EVENTS_PER_BLOCK + 1);
      expect(block.truncated).toBe(true);
      expect(body.truncated).toBe(true);

      await pool.query("DELETE FROM block WHERE height = 1004");
    });

    it("says when the FRAME's crossings are a slice, rather than drawing N as all of them", async () => {
      const base = (await (await get("/chain/pulse/frame")).json()) as PulseFrame;
      // The ordinary frame carries four crossings and cuts nothing, so the flag is ABSENT —
      // never `false`, which an older API could not send and a reader would take as a claim.
      expect(base.swapsTruncated).toBeUndefined();

      // Its own store rather than more rows in the shared one: this asserts a property of a
      // CROWDED span, and leaving the extra crossings behind would make every other test in
      // this file depend on the order it ran in.
      const crowded = new MemoryStorePort();
      await crowded.upsert(
        Array.from({ length: PULSE_FRAME_SWAPS + 3 }, (_, i) =>
          transfer({
            id: `near-intents:crowd-${i}`,
            // Inside the frame's own span, which is what the route narrows the store read to.
            timestamp: base.window.fromSeconds + 1 + i,
          }),
        ),
      );
      const crowdedApp = pulseRoutes({
        index: new ChainIndexStore(pool),
        pool,
        store: crowded,
        source: { getTipHeight: async () => 1003 } as unknown as NodeChainSource,
        mempool: null,
        now: () => NOW * 1000,
      });

      const body = (await (
        await crowdedApp.request("http://x/chain/pulse/frame")
      ).json()) as PulseFrame;
      expect(body.swaps.length).toBeLessThanOrEqual(PULSE_FRAME_SWAPS);
      // The count is the fact and the crossings are a window onto it.
      expect(body.swapsTruncated).toBe(true);
    });
  });

  describe("the ribbons", () => {
    it("refuses while a view has not been populated, rather than reporting no flow", async () => {
      // `edges: []` would state that nothing has ever crossed the boundary in Zcash's history.
      const response = await get("/chain/pulse/ribbons");
      expect(response.status).toBe(503);
    });

    it("states each edge as its own total once the views are filled", async () => {
      await pool.query("REFRESH MATERIALIZED VIEW chain_day_pool_boundary");
      await pool.query("REFRESH MATERIALIZED VIEW chain_day_pool_migration");
      await pool.query("REFRESH MATERIALIZED VIEW chain_day_supply_close");
      // The SAME router as the 503 above, deliberately: a refusal built from an unpopulated
      // view must not be held for the cache's ten minutes, or the endpoint goes on refusing
      // for minutes after the fill it was reporting has finished.
      const body = (await (await get("/chain/pulse/ribbons")).json()) as PulseRibbonsPayload;

      const all = body.windows.all;
      const edge = (from: string, to: string) =>
        all.edges.find((e) => e.from === from && e.to === to);

      expect(body.height).toBe(1003);
      // The boundary, per pool and per direction — gross, so the two directions are two rows.
      expect(edge("transparent", "sapling")).toMatchObject({ totalZat: 500_000_000, events: 1 });
      expect(edge("sprout", "transparent")).toMatchObject({
        totalZat: 500_000_000,
        events: 1,
        // Sprout's public JoinSplit value is a different accounting from a bundle balance.
        vpubDerived: true,
      });
      // Cross-chain ribbons are FLOORS: public swap venues only.
      expect(edge("chain:BTC", "transparent")).toMatchObject({
        totalZat: 100_000_000,
        events: 1,
        floor: true,
      });
      expect(edge("chain:ETH", "hub")).toMatchObject({ totalZat: 50_000_000, floor: true });
      // The pending and refunded crossings are in neither ribbon.
      expect(all.edges.filter((e) => e.floor).length).toBe(2);
      // The unsettled transaction has no ribbon and IS reported: 4 + 1 + 5 ZEC of pool
      // movement whose direction the chain did not settle, counted once.
      expect(all.unpaired).toMatchObject({ hubTxs: 1, hubZat: 1_000_000_000 });
      // Issuance is the six-pool difference, and what it did not defer or shield went to the
      // transparent box. Never a coinbase's outputs, which carry the fees it collected.
      expect(edge("mined", "lockbox")?.totalZat).toBe(1_600_000_000);
      expect(edge("mined", "transparent")).toBeDefined();
    });

    it("carries a narrower window with its own start", async () => {
      const body = (await (await get("/chain/pulse/ribbons")).json()) as PulseRibbonsPayload;
      // Both starts are UTC midnights, because the day is the grain the rows have.
      expect(body.windows["30d"].window.fromSeconds % 86_400).toBe(0);
      expect(body.windows.all.window.fromSeconds % 86_400).toBe(0);
      // 30 days back INCLUDING today, from the turn's own clock.
      expect(body.windows["30d"].window.fromSeconds).toBe(Math.floor(Date.UTC(2026, 1, 3) / 1000));
      // All-time starts at the earliest day the index HOLDS — on this fixture chain that is
      // later than the 30-day start, which is the honest answer rather than a padded one.
      expect(body.windows.all.window.fromSeconds).toBe(Math.floor(Date.UTC(2026, 2, 4) / 1000));
      expect(body.windows["30d"].window.toSeconds).toBe(NOW);
    });
  });

  describe("the mempool", () => {
    it("refuses when there is no tracker, rather than reporting an empty mempool", async () => {
      const response = await get("/chain/pulse/pending");
      expect(response.status).toBe(503);
    });
  });
});
