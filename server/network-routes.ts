import { Hono } from "hono";
import { Pool } from "pg";
import {
  ADDRESS_LABELS,
  BAND_BOUNDARIES_ZEC,
  BLOSSOM_HEIGHT,
  PAST_HALVING_HEIGHTS,
  nextHalvingHeight,
  subsidyTail,
  type DistributionBand,
  type HalvingEvent,
  type HalvingSchedule,
  type LabelledBalances,
  type RichListEntry,
  type RichListSummary,
  type SubsidySplit,
} from "@/domain";
import { addressValueExtremes } from "./address-extremes";
import { addressActivityWindow } from "./address-activity";
import { parseUtcDayStart } from "@/domain/list";
import { encodeCursor, INT8_SORT_KEY_MAX, seekFromCursors } from "@/data/cursor";
import type { CursorPage } from "@/data/source";
import { createPool } from "./pg-pool";
import { clampPageSize } from "./page-size";
import "./pg-types";

/**
 * `GET /chain/network/halving`: the whole halving schedule, past and next, as a domain
 * `HalvingSchedule`. Not a reuse of `/v1/network/halving`, which serves only the next halving and
 * is not served on testnet.
 *
 * Every subsidy figure comes from the node's `getblocksubsidy`, never from arithmetic here; the
 * node answers for arbitrary past and future heights. The split between miner, funding streams and
 * lockbox changes by consensus rule (at the next halving the ZIP 214 funding stream and the NU6
 * lockbox both expire, so the miner's share falls 37.5% while the total falls 50%), which a locally
 * computed schedule could easily get wrong.
 *
 * The block interval is measured rather than assumed, because it feeds every date the page
 * prints: the observed mean runs slightly above the 75 s target, which over years adds up to days.
 */

/**
 * How many recent blocks the observed interval is averaged over: about 30 days. Long enough that a
 * single slow block cannot move it, short enough to describe the chain as it runs now.
 */
const INTERVAL_SAMPLE_BLOCKS = 34_560;

/**
 * Future halvings listed beyond the next one: only how many of `subsidyTail`'s steps (in
 * `domain/`) the node is asked to confirm.
 */
const UPCOMING_COUNT = 4;

/** An hour. The schedule is immutable; only the tip and the observed interval move. */
const CACHE_MS = 60 * 60_000;

interface NodeSubsidy {
  miner: number;
  founders: number;
  fundingstreamstotal: number;
  lockboxtotal: number;
  totalblocksubsidy: number;
}

export interface HalvingChainSource {
  getChainFacts(): Promise<{ height: number }>;
  getBlockSubsidy(height: number): Promise<NodeSubsidy>;
}

/**
 * The node reports ZEC floats; the domain speaks zatoshi. Rounded per field: the node's figures
 * are exact multiples of 1e-8, so this only undoes float representation. Mirrors
 * `toSubsidyBreakdown` in `v1/map.ts`.
 */
function toSplit(s: NodeSubsidy): SubsidySplit {
  const zat = (zec: number) => Math.round(zec * 100_000_000);
  return {
    totalZat: zat(s.totalblocksubsidy),
    minerZat: zat(s.miner),
    // Pre-Canopy the miner's counterpart was the Founders' Reward, which the node reports under its
    // own key. Folding it in gives one "everything that is not the miner" column across funding
    // regimes.
    fundingStreamsZat: zat(s.fundingstreamstotal) + zat(s.founders),
    lockboxZat: zat(s.lockboxtotal),
  };
}

/**
 * Mean seconds per block over the recent chain, or 0 when it cannot be measured.
 *
 * Exported because both halving surfaces need it (this route and `/v1/network/halving`), so the
 * site cannot publish two estimated dates for one event. Absurd gaps are excluded rather than
 * clamped, so a bad timestamp leaves the average alone.
 *
 * 0 rather than a substituted target, so the caller decides: `estimateHalvingSeconds` falls back
 * to the consensus target, and the page can say which it used.
 */
export async function observedBlockIntervalSeconds(pool: Pool): Promise<number> {
  const { rows } = await pool.query<{ mean: number | null }>(
    `SELECT avg(gap) AS mean FROM (
       SELECT timestamp - lag(timestamp) OVER (ORDER BY height) AS gap
         FROM block WHERE height > (SELECT max(height) - $1 FROM block)
     ) g WHERE gap IS NOT NULL AND gap BETWEEN 0 AND 3600`,
    [INTERVAL_SAMPLE_BLOCKS],
  );
  const mean = rows[0]?.mean;
  return typeof mean === "number" && Number.isFinite(mean) && mean > 0 ? mean : 0;
}

interface RichListRow {
  address: string;
  balance_zat: number;
  received_zat: number;
  first_height: number;
  last_height: number;
  rank: number;
  /** NULL on any row the transaction-count backfill has not reached yet. Never coerced. */
  tx_count: string | null;
}

const toEntry = (r: RichListRow): RichListEntry => ({
  rank: r.rank,
  address: r.address,
  balanceZat: r.balance_zat,
  receivedZat: r.received_zat,
  firstHeight: r.first_height,
  lastHeight: r.last_height,
  // A NULL is refused here, while it is still a NULL: `Number(null)` is 0, which would pass every
  // downstream type check as a measurement. An address in this table has at least one transaction,
  // so 0 is not a possible true value.
  txCount: r.tx_count === null ? null : Number(r.tx_count),
  // No name here and none on the wire: a label is editorial, not chain data. It lives in
  // `ADDRESS_LABELS`, which the frontend holds and resolves from the address, so one fact never
  // depends on two deployments being in step.
});

/** What a rich-list page request carries. Cursors are opaque strings, decoded here. */
export interface RichListQuery {
  limit?: number;
  before?: string;
  after?: string;
  /**
   * Start the page at this absolute rank, 1-based.
   *
   * Not an OFFSET: `rank` is a stored column numbered in this list's order, so `rank >= 500` names
   * one holder rather than counting into a list that may have shifted. It is the only way to answer
   * "who is the 500th largest holder" without paging by cursor.
   *
   * Mutually exclusive with the cursors: two ways to name a position with a silent winner would
   * page somewhere the caller did not ask for.
   */
  fromRank?: number;
}

/**
 * One page of the rich list, keyset over `(balance_zat, address)`.
 *
 * Exported because both rich-list surfaces call it (the private `/chain/rich-list` and the public
 * `/v1/rich-list`), so the tie-aware predicate below has one implementation.
 *
 * A composite cursor because `balance_zat` is not unique (round balances repeat), so a
 * single-column seek would return an arbitrary slice past the first page. The address is the
 * tiebreak and both columns are in the cursor.
 */
export async function loadRichListPage(
  pool: Pool,
  query: RichListQuery = {},
): Promise<CursorPage<RichListEntry>> {
  const limit = clampPageSize(query.limit || undefined, 50);
  const seekAt = seekFromCursors(query, INT8_SORT_KEY_MAX);
  const seek = seekAt?.seek ?? null;
  const after = seekAt?.direction === "after";
  // Ascending when paging backwards, then reversed, as in every keyset here.
  const order = after ? "ASC" : "DESC";
  // A rank seek only makes sense forwards, and a cursor already names a position, so the two are
  // never combined (the caller rejects that pairing).
  const fromRank =
    seek || query.fromRank === undefined ? null : Math.max(1, Math.floor(query.fromRank));

  const params: unknown[] = [limit + 1];
  let where = "";
  if (fromRank !== null) {
    // `rank > 0` is required: the column defaults to 0 until the first ranking pass, and an
    // unranked row in a rank window would present an address of unknown standing as holding a
    // place.
    where = "WHERE rank >= $2::bigint AND rank > 0";
    params.push(fromRank);
  } else if (seek) {
    // Written out rather than as `(balance_zat, address) < ($2, $3)`. A row-value comparison
    // descends both columns, while this list descends the balance and ascends the address (the
    // tiebreak the keyset index stores and `rank` is numbered by). On a tie the row form would
    // re-serve addresses above the boundary and skip the ones below it, so some holders would
    // appear on no page.
    //
    // The leading bound on `balance_zat` alone keeps this one indexed seek: the index starts from
    // that range and the tiebreak applies inside it.
    where = after
      ? "WHERE balance_zat >= $2::bigint AND (balance_zat > $2::bigint OR address < $3)"
      : "WHERE balance_zat <= $2::bigint AND (balance_zat < $2::bigint OR address > $3)";
    params.push(seek.sortKey, seek.id);
  }

  /*
   * A rank seek orders by rank. `rank` is written by an hourly pass while balances are current, so
   * an address that grew since the last pass keeps its old rank, and ordering a rank window by
   * balance would hoist it to the front. `rich-list-keyset.test.ts` stales a rank to cover this.
   *
   * `rank` is a dense unique `row_number`, so ASC on it alone is total and needs no tiebreak.
   */
  const orderBy =
    fromRank !== null
      ? "rank ASC"
      : `balance_zat ${order}, address ${order === "ASC" ? "DESC" : "ASC"}`;

  const { rows } = await pool.query<RichListRow>(
    `SELECT address, balance_zat, received_zat, first_height, last_height, rank, tx_count
       FROM chain_address_balance
       ${where}
      ORDER BY ${orderBy}
      LIMIT $1`,
    params,
  );

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  if (after) page.reverse();
  const first = page[0];
  const last = page[page.length - 1];

  /*
   * A rank window carries no cursor. The cursors encode `(balance_zat, address)` and resume the
   * balance keyset, so returning one from a rank-ordered page would switch the ordering mid-list,
   * silently and exactly where the two disagree. A caller continuing a rank window asks for the
   * next rank.
   */
  return {
    items: page.map(toEntry),
    nextCursor:
      fromRank === null && last && (after || hasMore)
        ? encodeCursor(last.balance_zat, last.address)
        : null,
    prevCursor:
      fromRank === null && first && seek ? encodeCursor(first.balance_zat, first.address) : null,
  };
}

/**
 * The height the balances cover, captured at refresh time, never the live tip. Separate so the
 * list surface can state what height its figures are as of; the refresh runs hourly, so the tip is
 * a different number.
 */
export async function richListComputedHeight(pool: Pool): Promise<number> {
  const { rows } = await pool.query<{ computed_height: number }>(
    "SELECT computed_height FROM chain_rich_list_meta",
  );
  return rows[0]?.computed_height ?? 0;
}

/**
 * The current balance and rank of each given address, in the order given: one indexed read.
 *
 * An address with no row holds nothing, and says so as zero with no rank. The index keeps a row
 * only while the balance is positive, so the absence is a measurement, as in `RichListStanding`.
 * A rank of 0 is the column's default before the first ranking pass, and reads as no rank.
 */
export async function loadLabelledBalances(
  pool: Pool,
  addresses: readonly string[],
): Promise<LabelledBalances> {
  const [balances, rankAsOfHeight] = await Promise.all([
    pool.query<{ address: string; balance_zat: number; rank: number }>(
      "SELECT address, balance_zat, rank FROM chain_address_balance WHERE address = ANY($1::text[])",
      [addresses],
    ),
    richListComputedHeight(pool),
  ]);
  const byAddress = new Map(balances.rows.map((row) => [row.address, row]));
  return {
    rankAsOfHeight,
    items: addresses.map((address) => {
      const row = byAddress.get(address);
      return {
        address,
        balanceZat: row?.balance_zat ?? 0,
        rank: row && row.rank > 0 ? row.rank : null,
      };
    }),
  };
}

/** Where one address stands on the transparent rich list, at the height that list covers. */
export interface RichListStanding {
  /**
   * Whether the address has a rich-list row at all, i.e. holds a positive balance.
   *
   * Carried separately from a null rank because the two nulls mean opposite things: no row is a
   * measurement ("it holds nothing, so it is on no rich list"), while a row with no rank yet is our
   * own gap (`nonexistent` versus `unmeasured`).
   */
  onList: boolean;
  /** Rank by balance. Null when `onList` is false, or when ranking has not run yet. */
  rank: number | null;
  /** Transactions the address appears in. Null means not yet computed, never none. */
  txCount: number | null;
  /** The height the rich list covers, never the tip. 0 when it has never been refreshed. */
  computedHeight: number;
}

/**
 * One address's standing on the rich list: its rank and transaction count.
 *
 * A LEFT JOIN from the meta row, so a missing balance row still returns the height. The two facts
 * must be read together: `computed_height` qualifies the rank, and a second query could let an
 * hourly refresh land between them.
 *
 * A null rank with no row is a fact, not a gap: `chain_address_balance` holds only positive
 * balances (a spent-out address is deleted by `#applyBalanceDeltaAt`), so an absent row means the
 * address holds nothing. The caller reports that as `nonexistent`.
 *
 * No denominator: a rank is an ordinal and reads correctly alone, and counting every holder on
 * each lookup would add a full count to a public endpoint for nothing.
 */
export async function richListStanding(pool: Pool, address: string): Promise<RichListStanding> {
  const { rows } = await pool.query<{
    matched: string | null;
    rank: string | null;
    tx_count: string | null;
    computed_height: number;
  }>(
    // `b.address` rather than `b.rank` as the join witness: rank defaults to 0 for a row that
    // exists, so testing it would conflate "no row" with "not ranked yet".
    `SELECT b.address AS matched, b.rank, b.tx_count, m.computed_height
       FROM chain_rich_list_meta m
       LEFT JOIN chain_address_balance b ON b.address = $1`,
    [address],
  );
  const row = rows[0];
  // No meta row: the rich list has never been built here. Everything is unknown, and
  // `onList: false` would claim the address holds nothing, which is not established.
  if (!row) return { onList: false, rank: null, txCount: null, computedHeight: 0 };
  return {
    onList: row.matched !== null,
    // BIGINT arrives from pg as a string. `rank` is 0 until the first ranking pass ("not ranked
    // yet", never "ranked first"), so a 0 becomes null with the `unmeasured` reason.
    rank: row.rank === null || Number(row.rank) <= 0 ? null : Number(row.rank),
    txCount: row.tx_count === null ? null : Number(row.tx_count),
    computedHeight: row.computed_height,
  };
}

/**
 * The totals and the distribution: everything the page states above the list.
 *
 * Bands are computed here rather than materialised: one pass over the view is milliseconds, and a
 * second materialised thing could disagree with the first. Shared with
 * `/v1/rich-list/distribution`, like `loadRichListPage`.
 */
export async function loadRichListSummary(pool: Pool): Promise<RichListSummary> {
  const bounds = BAND_BOUNDARIES_ZEC.map((z) => z * 100_000_000);
  const [totals, bands, tops, meta] = await Promise.all([
    pool.query<{ addresses: number; total_zat: number }>(
      "SELECT count(*)::int AS addresses, COALESCE(sum(balance_zat), 0)::bigint AS total_zat FROM chain_address_balance",
    ),
    pool.query<{ band: number; addresses: number; total_zat: number }>(
      `SELECT width_bucket(balance_zat, $1::bigint[]) - 1 AS band,
              count(*)::int AS addresses,
              sum(balance_zat)::bigint AS total_zat
         FROM chain_address_balance GROUP BY 1 ORDER BY 1`,
      [bounds],
    ),
    pool.query<{ count: number; total_zat: number }>(
      `SELECT n AS count, (SELECT COALESCE(sum(balance_zat), 0)::bigint
                             FROM chain_address_balance WHERE rank <= n) AS total_zat
         FROM unnest(ARRAY[10, 100, 1000]) AS n`,
    ),
    // The height the balances cover, not the live tip: the refresh runs hourly, so the current tip
    // would misstate when they were computed.
    pool.query<{ unattributed_zat: number; computed_height: number }>(
      "SELECT unattributed_zat, computed_height FROM chain_rich_list_meta",
    ),
  ]);

  const byBand = new Map(bands.rows.map((r) => [r.band, r]));
  return {
    height: meta.rows[0]?.computed_height ?? 0,
    addressCount: totals.rows[0]?.addresses ?? 0,
    totalZat: totals.rows[0]?.total_zat ?? 0,
    unattributedZat: meta.rows[0]?.unattributed_zat ?? 0,
    bands: bounds.map<DistributionBand>((fromZat, i) => ({
      fromZat,
      addresses: byBand.get(i)?.addresses ?? 0,
      totalZat: byBand.get(i)?.total_zat ?? 0,
    })),
    topShares: tops.rows.map((r) => ({ count: r.count, totalZat: r.total_zat })),
    asOf: Math.floor(Date.now() / 1000),
  };
}

/** Block timestamps for heights we already hold. Missing heights simply come back null. */
async function timestampsAt(
  pool: Pick<Pool, "query"> | undefined,
  heights: readonly number[],
): Promise<Map<number, number>> {
  if (pool === undefined || heights.length === 0) return new Map();
  const { rows } = await pool.query<{ height: number; timestamp: number }>(
    `SELECT height, timestamp FROM block WHERE height = ANY($1::int[])`,
    [heights],
  );
  return new Map(rows.map((r) => [r.height, r.timestamp]));
}

/**
 * Every subsidy change so far plus the next halving, oldest first: one implementation shared by
 * `/chain/network/halving` (the page) and `/v1/network/halving` (the public API and the agent).
 *
 * Blossom leads the list. It is not a halving and is labelled as such, but it is where the
 * per-block subsidy last changed before the first halving; without it the history would begin at
 * 6.25 ZEC with nothing to explain it. Without a Postgres pool the events still come back, with
 * `at` null: the subsidies come from the node.
 */
export async function loadHalvingEvents(
  chain: HalvingChainSource,
  pool: Pick<Pool, "query"> | undefined,
  height: number,
): Promise<HalvingEvent[]> {
  const next = nextHalvingHeight(height);
  const past = [BLOSSOM_HEIGHT, ...PAST_HALVING_HEIGHTS].filter((h) => h <= height);
  const heights = [...past, next];
  const [stamps, splits] = await Promise.all([
    timestampsAt(pool, past),
    // Two node calls per halving (the block before and the block at), because what changed is the
    // subject.
    Promise.all(heights.flatMap((h) => [chain.getBlockSubsidy(h - 1), chain.getBlockSubsidy(h)])),
  ]);
  return heights.map((h, i) => ({
    kind: h === BLOSSOM_HEIGHT ? "block-time-change" : "halving",
    height: h,
    at: stamps.get(h) ?? null,
    before: toSplit(splits[i * 2]!),
    after: toSplit(splits[i * 2 + 1]!),
  }));
}

export function networkRoutes(chain: HalvingChainSource, connection?: string): Hono {
  const POOL = { max: 2, statement_timeout: 30_000 } as const;
  const pool = createPool(connection, POOL);
  const app = new Hono();
  let cached: { at: number; data: HalvingSchedule } | null = null;
  let inflight: Promise<HalvingSchedule> | null = null;

  async function build(): Promise<HalvingSchedule> {
    const { height } = await chain.getChainFacts();
    const next = nextHalvingHeight(height);
    const [interval, events] = await Promise.all([
      observedBlockIntervalSeconds(pool),
      loadHalvingEvents(chain, pool, height),
    ]);

    const nextAfter = events[events.length - 1]!.after;
    const tail = subsidyTail(next, nextAfter.totalZat).steps.slice(0, UPCOMING_COUNT);
    // Confirmed against the node rather than served as our own arithmetic, like the events above.
    const confirmed = await Promise.all(tail.map((t) => chain.getBlockSubsidy(t.height)));

    return {
      height,
      observedIntervalSeconds: interval,
      events,
      upcoming: tail.map((t, i) => ({
        height: t.height,
        totalZat: toSplit(confirmed[i]!).totalZat,
      })),
      asOf: Math.floor(Date.now() / 1000),
    };
  }

  app.get("/chain/network/halving", async (c) => {
    if (cached && Date.now() - cached.at < CACHE_MS) {
      // The tip moves faster than the cache and the countdown is measured from it, so the height is
      // refreshed on every request while the expensive part is reused.
      const { height } = await chain.getChainFacts();
      const target = cached.data.events[cached.data.events.length - 1]?.height;
      // ...unless the tip has crossed the halving this cache was built around, in which case
      // reusing it would count down to a block already mined.
      if (target !== undefined && nextHalvingHeight(height) === target) {
        return c.json({ ...cached.data, height, asOf: Math.floor(Date.now() / 1000) });
      }
      cached = null;
    }
    inflight ??= build()
      .then((data) => {
        cached = { at: Date.now(), data };
        return data;
      })
      .finally(() => {
        inflight = null;
      });
    return c.json(await inflight);
  });

  /** The rich list. The keyset lives in `loadRichListPage`. */
  app.get("/chain/rich-list", async (c) => {
    const rawRank = c.req.query("fromRank");
    const before = c.req.query("before");
    const after = c.req.query("after");
    // A cursor and a rank both name a position; accepting both and picking one would page somewhere
    // the caller did not ask for (as `/v1` rejects `cursor` alongside `before`).
    if (rawRank !== undefined && (before !== undefined || after !== undefined)) {
      return c.json({ error: "fromRank names a position and so does a cursor — send one" }, 400);
    }
    // A malformed rank has no honest reading, so it is refused rather than coerced (as for
    // `parseMinUsdFilter`): an open set can keep a well-formed unknown, a number cannot.
    let fromRank: number | undefined;
    if (rawRank !== undefined) {
      const parsed = Number(rawRank);
      if (!Number.isFinite(parsed) || parsed < 1) {
        return c.json({ error: `fromRank must be a positive whole number: ${rawRank}` }, 400);
      }
      fromRank = Math.floor(parsed);
    }
    const body: CursorPage<RichListEntry> = await loadRichListPage(pool, {
      limit: Number(c.req.query("limit") ?? 50) || 50,
      before,
      after,
      ...(fromRank === undefined ? {} : { fromRank }),
    });
    return c.json(body);
  });

  /** The totals and the distribution: everything the page states above the list. */
  app.get("/chain/rich-list/summary", async (c) => {
    const body: RichListSummary = await loadRichListSummary(pool);
    return c.json(body);
  });

  /**
   * Every labelled address's balance and rank, for the agent's label guide. No parameters: the
   * address set is `ADDRESS_LABELS`, so a caller cannot widen the query.
   */
  app.get("/chain/labels/balances", async (c) =>
    c.json(await loadLabelledBalances(pool, Object.keys(ADDRESS_LABELS))),
  );

  /**
   * One address's value extrema, the agent's per-address "biggest transaction" read. Bounded by
   * construction (see `address-extremes.ts`); token-gated like every /chain path.
   */
  app.get("/chain/addresses/:address/value-extremes", async (c) =>
    c.json(await addressValueExtremes(pool, c.req.param("address"))),
  );

  /**
   * One address's activity over a period: the windowed counterpart of the lifetime totals.
   *
   * Both ends are required, as a cost bound: the height range is resolved with
   * `MIN(height)`/`MAX(height)` over `block`'s timestamp index (exact, since miner timestamps are
   * only loosely ordered), and an open-ended aggregate would scan the chain rather than the window.
   *
   * The response echoes the heights it resolved to, so a caller can check the translation; the
   * agent refuses a payload whose echo is missing, so an older API cannot answer about all of
   * history under a heading naming a month.
   */
  app.get("/chain/addresses/:address/activity", async (c) => {
    const from = parseUtcDayStart(c.req.query("from"));
    const to = parseUtcDayStart(c.req.query("to"));
    if (from === null || to === null || to <= from) {
      return c.json(
        { error: "from and to are required UTC days (YYYY-MM-DD), and to must be after from" },
        400,
      );
    }
    return c.json({
      ...(await addressActivityWindow(pool, c.req.param("address"), from, to)),
      // The window as asked for, beside the heights it resolved to: the echo shows the request was
      // understood, the heights show what was counted.
      applied: { fromTimestamp: from, toTimestamp: to },
    });
  });

  return app;
}
