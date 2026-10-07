import type { ValuePoolName } from "./pool";
import type { PulseEnd, PulseEvent } from "./pulse";
import { DAY_SECONDS } from "./time";

/**
 * The wire shapes `/pulse` reads, in raw zatoshi and unix seconds throughout. Nothing here is
 * formatted: the client owns formatting, so no ledger amount is pre-rounded on the wire.
 */

/**
 * The six value-pool closes at one height, with the two hashes a delta needs to prove the rows
 * chain. A balance is `null` when the node reported none, never 0: zero is a measurement, null
 * is a gap, and the page draws it as an outlined `unavailable` box.
 */
export interface PulseBlockPools {
  height: number;
  hash: string;
  /** The parent's hash. A delta across two rows is only honest when this chains to `hash`. */
  prevHash: string;
  /** The miner's own header time, unix seconds. */
  timestamp: number;
  /**
   * When our follower first stored this block, unix seconds: an observation of ours, not chain
   * data. Null for blocks stored before recording began; the heartbeat draws a gap there.
   */
  receivedAt: number | null;
  /** Every value pool's closing balance at this height. */
  pools: Readonly<Record<ValuePoolName, number | null>>;
}

/**
 * One block's worth of the frame: what the boxes should read, what moved, and how long the
 * block took to arrive.
 */
export interface PulseBlock {
  pools: PulseBlockPools;
  /** The movements drawn for this block, in the order they should be played. */
  events: PulseEvent[];
  /**
   * How many events this block actually produced. Equal to `events.length` unless `truncated`
   * is set, so a capped block never presents itself as whole.
   */
  eventCount: number;
  /** Set when `events` is a slice of `eventCount`. Absent means the block is complete. */
  truncated?: true;
  /**
   * `receivedAt` here less `receivedAt` at the previous height, both on our clock. Null when
   * either side did not record an arrival.
   */
  intervalSeconds: number | null;
  /**
   * The block was stored long after it was mined (a follower catching up), so its arrival
   * time measures our backfill rather than propagation. Absent when the two clocks agree.
   */
  indexedLate?: true;
}

/** How far apart `received_at` and the header may sit before an arrival is our backfill. */
export const PULSE_INDEXED_LATE_SECONDS = 600;

/**
 * The mempool layer: pulses that hover at an edge's start and never travel. `count` is what
 * the mempool held and `events.length` what is drawn.
 */
export interface PulsePending {
  events: PulseEvent[];
  count: number;
  truncated?: true;
}

/**
 * What `/chain/pulse/pending` answers. `asOf` is when the mempool was read, not when the
 * response was built.
 */
export interface PulsePendingFrame extends PulsePending {
  asOf: number;
}

/** The span a frame covers, unix seconds, half-open `[from, to)` so no instant is counted twice. */
export interface PulseWindow {
  fromSeconds: number;
  toSeconds: number;
}

/**
 * Cumulative gross flow along one edge over the window: what a ribbon's width states. Gross,
 * not net, so two directions between the same pair are two rows.
 */
export interface PulseEdgeTotal {
  from: PulseEnd;
  to: PulseEnd;
  /** Gross zatoshi over the window. */
  totalZat: number;
  /** How many movements the total covers, so a ruler can be checked against it. */
  events: number;
  /** The amounts derive from Sprout's public JoinSplit values rather than a bundle balance. */
  vpubDerived?: true;
  /**
   * The total covers public swap venues only, so it is a lower bound. Custodial routes
   * publish no per-transfer API and aggregators would double-count.
   */
  floor?: true;
}

/** Every ribbon in one frame, with the window they were summed over. */
export interface PulseRibbons {
  window: PulseWindow;
  edges: PulseEdgeTotal[];
}

/**
 * One confirmed transparent output, for the ledger box's rows. Outputs only, never an
 * input→output pairing: which output was payment and which was change is not knowable.
 */
export interface PulseLedgerRow {
  txid: string;
  height: number;
  blockHash: string;
  /** The full address string. The row elides it for display and keeps this in `title`. */
  address: string;
  valueZat: number;
}

/**
 * Everything `/chain/pulse/frame` returns: the tip, what the boxes read, and the confirmed
 * movements behind them.
 *
 * The mempool layer and the ribbons have their own endpoints on their own cadences, so both
 * fields are optional here and absent means "not served by this endpoint", never "empty".
 */
export interface PulseFrame {
  window: PulseWindow;
  /**
   * The node's own tip height when the frame was built. Read from the node while everything
   * else comes from the index, so it may lead by a block. The frame is cached keyed on it, so a
   * new block invalidates the entry immediately.
   */
  tip: number;
  /**
   * The six closes at the newest indexed block: what the boxes read and the height printed
   * beside them. Same row as `blocks[blocks.length - 1].pools`; never paired with `tip`, since
   * a balance and its height must come from one row.
   */
  stocks: PulseBlockPools;
  /** Oldest first, so a replay plays the array forward. */
  blocks: PulseBlock[];
  /** Absent on this endpoint — see the note above. `/chain/pulse/pending` serves it. */
  pending?: PulsePending;
  /**
   * Crossings no Zcash block in this frame has recorded. They have `height` and `blockHash`
   * null, are placed at venue time, and light no box. A crossing whose transaction is in the
   * frame is folded into that transaction's event by `pairSwapsWithTxs` instead.
   */
  swaps: PulseEvent[];
  /**
   * Set when `swaps` is a slice: the span held more unpaired crossings than one response
   * carries. Absent, never `false`. `/chain/pulse/window` reports the same as `truncated`.
   */
  swapsTruncated?: true;
  /** Absent on this endpoint — see the note above. `/chain/pulse/ribbons` serves it. */
  ribbons?: PulseRibbons;
  ledger: PulseLedgerRow[];
}

/**
 * What `/chain/pulse/window` returns: one hour of history, for the replay transport.
 *
 * `applied` echoes the window the server cut. A caller must refuse a payload whose echo does
 * not match the hour it asked for: an API that ignored the parameters would answer some other
 * hour. No `pending` or `ribbons`, since neither is a fact about a past hour.
 */
export interface PulseWindowFrame {
  applied: PulseWindow;
  /** Oldest first, so a replay plays the array forward. */
  blocks: PulseBlock[];
  /** Crossings inside the window that no block in it recorded. See `PulseFrame.swaps`. */
  swaps: PulseEvent[];
  /**
   * Set when the hour held more movements than one response carries: a capped block (marked on
   * the block itself) or more crossings than the swap page holds.
   */
  truncated?: true;
  /**
   * The transparent outputs of this hour's blocks, newest first, for the ledger box during
   * replay. Optional because an older API omits it: absent means "not carried", never "no
   * outputs", and the client keeps the two apart.
   */
  ledger?: PulseLedgerRow[];
  /**
   * Set when `ledger` holds only some of the hour's outputs. Absent, never `false`. Exact: the
   * read asks for one row more than it carries.
   */
  ledgerTruncated?: true;
}

/**
 * The three windows the ribbons are summed over: all of history, the trailing year, the
 * trailing thirty days. Named rather than a day count so the set stays closed and cacheable.
 */
export const PULSE_RIBBON_WINDOW_NAMES = ["all", "1y", "30d"] as const;

/** Derived from the array, so the two cannot drift. */
export type PulseRibbonWindowName = (typeof PULSE_RIBBON_WINDOW_NAMES)[number];

/**
 * One window's ribbons, and the movements that have no ribbon.
 *
 * `unpaired` counts hub transactions (no settled direction) and multi-source migrations (whose
 * amount cannot be split between sources). Both are reported so the ribbons are not read as
 * the whole story.
 */
export interface PulseRibbonWindow {
  window: PulseWindow;
  edges: PulseEdgeTotal[];
  unpaired: {
    hubZat: number;
    hubTxs: number;
    multiMigrationZat: number;
    multiMigrationTxs: number;
  };
}

/**
 * What `/chain/pulse/ribbons` answers: every window in one read. `height` is the row every
 * mined edge was differenced from, so the ruler prints what the ribbons were measured at.
 */
export interface PulseRibbonsPayload {
  /** When the views were read, unix seconds. */
  asOf: number;
  /** The height the six closes were read at. */
  height: number;
  windows: Record<PulseRibbonWindowName, PulseRibbonWindow>;
}

/** A replay window is exactly one hour, aligned to the hour. */
export const PULSE_WINDOW_SECONDS = 3_600;

/**
 * How far past an hour's end the chain must be before that hour's answer is treated as fixed.
 * Two hours, comfortably past the reorg depth at the 75-second target.
 *
 * Shared by the API's window cache and the Next route's CDN header. The API measures it against
 * the tip's header time, the Next route against the wall clock; each call site explains why.
 */
export const PULSE_SETTLED_SECONDS = 7_200;

/**
 * How far back the replay transport reaches: twenty-four hours. Enforced at the parser so a
 * hand-edited `?from=0` cannot cost a cache entry and a range scan per arbitrary past hour.
 */
export const PULSE_REPLAY_SECONDS = DAY_SECONDS;

/**
 * What a caller is told when their window is refused. Shared by `/chain/pulse/window` and
 * `/api/pulse/window`, which refuse the same set.
 */
export const PULSE_WINDOW_PARAM_ERROR =
  `from and to must be whole seconds, from must be a multiple of ${PULSE_WINDOW_SECONDS}, ` +
  `to must be from + ${PULSE_WINDOW_SECONDS}, to must not be more than an hour ahead of now, ` +
  `and from must be within the last ${PULSE_REPLAY_SECONDS / 3_600} hours`;

/**
 * `?from`/`?to` as a window, or null when they do not describe exactly one aligned hour.
 *
 * Shared by the API route and the Next route in front of it. Alignment keeps one cache key per
 * hour and stops adjacent requests overlapping; the bounds at both ends limit cost.
 */
export function parsePulseWindowParams(
  fromRaw: string | null | undefined,
  toRaw: string | null | undefined,
  nowSeconds: number,
): PulseWindow | null {
  // An empty parameter is not zero: `Number("")` is 0, which would accept `?from=&to=3600`.
  if (!fromRaw || !toRaw) return null;
  const from = Number(fromRaw);
  const to = Number(toRaw);
  if (!Number.isInteger(from) || !Number.isInteger(to)) return null;
  if (from % PULSE_WINDOW_SECONDS !== 0) return null;
  if (to - from !== PULSE_WINDOW_SECONDS) return null;
  // One hour of slack for a client whose clock runs a little fast.
  if (to > nowSeconds + PULSE_WINDOW_SECONDS) return null;
  // Floor at the replay's reach. The extra hour is because the oldest offered hour may begin
  // up to an hour before the horizon.
  if (from < nowSeconds - PULSE_REPLAY_SECONDS - PULSE_WINDOW_SECONDS) return null;
  return { fromSeconds: from, toSeconds: to };
}
