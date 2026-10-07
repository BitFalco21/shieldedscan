import type { Pool } from "pg";
import { NET_UNIDENTIFIED_CLIENT, type NetReleaseGroup } from "@/domain";
import { classifyUserAgent } from "../p2p/user-agent";

/**
 * What software the answering nodes run, grouped by (user agent, declared protocol version),
 * and how many of each group were behind our tip when they last answered. ONE implementation
 * for the crawler's daily record (`net_release_day`) and the API's live view, so "behind the
 * tip" cannot mean one thing in the history and another on today's row.
 *
 * Everything here except the tip lag is what a node SAID about itself. The lag is the one
 * observation: the height a node declared in its `version` message against the height our own
 * follower had stored at that instant. That is what will show which nodes stayed on the old
 * rules once an upgrade activates, and today it shows nodes that have stopped following.
 */

/**
 * A node is behind when its declared height trails ours by more than this at its last answer.
 * Ten blocks is about twelve minutes at the 75-second target: past any propagation delay, and
 * well short of a node that has genuinely stopped.
 */
export const BEHIND_TIP_BLOCKS = 10;

/**
 * How far back the tip lookup reaches. The answering window is 24 hours (~1,150 blocks), so
 * 2,500 covers it with room for a slow day.
 */
const RECENT_BLOCK_SPAN = 2_500;

/** A block our follower stored, with the instant it stored it. */
export interface StoredBlock {
  height: number;
  receivedAt: number;
}

/** The facts a node row contributes; both the crawler and the snapshot read these columns. */
export interface ReleaseInput {
  user_agent: string | null;
  protocol_version: number | null;
  best_height: number | null;
  last_reachable: number;
}

/** One group before classification: raw user agent, `null` for "none declared". */
export interface RawReleaseGroup {
  userAgent: string | null;
  protocolVersion: number | null;
  nodes: number;
  behindTip: number;
  tipUnknown: number;
}

/**
 * Recent blocks with the follower's own arrival stamp, oldest first. Empty when the chain
 * tables do not exist in this database (a crawler pointed at a bare database, or a test), in
 * which case every lag is unknown rather than the read failing.
 *
 * `received_at`, never the header timestamp: a miner chooses its timestamp, our follower does
 * not, and the question is what WE had at the instant the node answered. Blocks the backfiller
 * wrote carry no stamp and are skipped, so an instant before the follower took over has no tip.
 */
export async function loadRecentBlocks(pool: Pick<Pool, "query">): Promise<StoredBlock[]> {
  const exists = await pool.query<{ ok: boolean }>(
    `SELECT to_regclass('public.block') IS NOT NULL AS ok`,
  );
  if (!exists.rows[0]?.ok) return [];
  const { rows } = await pool.query<{ height: number; received_at: number }>(
    `SELECT height, received_at FROM block
     WHERE height > (SELECT COALESCE(max(height), 0) FROM block) - $1
       AND received_at IS NOT NULL
     ORDER BY height`,
    [RECENT_BLOCK_SPAN],
  );
  return rows.map((r) => ({ height: Number(r.height), receivedAt: Number(r.received_at) }));
}

/** The highest block we had stored at `at`; null when nothing we hold covers that instant. */
export function heightAt(blocks: readonly StoredBlock[], at: number): number | null {
  let best: number | null = null;
  for (const b of blocks) {
    if (b.receivedAt <= at && (best === null || b.height > best)) best = b.height;
  }
  return best;
}

/**
 * Blocks the node trailed us by at its last answer; negative when it was ahead of our
 * follower, which happens for a few seconds after every block. Null when either side is
 * unknown: a node that declared no height (or zero, which a syncing node can send) or an
 * instant our records do not cover.
 */
export function tipLag(row: ReleaseInput, blocks: readonly StoredBlock[]): number | null {
  if (row.best_height === null || row.best_height <= 0) return null;
  const ours = heightAt(blocks, row.last_reachable);
  return ours === null ? null : ours - row.best_height;
}

/** Groups answering nodes by raw (user agent, protocol version), counting lag per group. */
export function rawReleaseGroups(
  rows: readonly ReleaseInput[],
  blocks: readonly StoredBlock[],
): RawReleaseGroup[] {
  const groups = new Map<string, RawReleaseGroup>();
  for (const row of rows) {
    const k = JSON.stringify([row.user_agent, row.protocol_version]);
    const g = groups.get(k) ?? {
      userAgent: row.user_agent,
      protocolVersion: row.protocol_version,
      nodes: 0,
      behindTip: 0,
      tipUnknown: 0,
    };
    g.nodes += 1;
    const lag = tipLag(row, blocks);
    if (lag === null) g.tipUnknown += 1;
    else if (lag > BEHIND_TIP_BLOCKS) g.behindTip += 1;
    groups.set(k, g);
  }
  return [...groups.values()];
}

/**
 * Classifies raw groups into the wire shape: user agent → client and release, by the same
 * function every other `/network` tab uses, merging groups that classify alike (two user-agent
 * spellings of one release). Sorted largest first, then by name, so the payload is stable.
 */
export function classifyReleaseGroups(raw: readonly RawReleaseGroup[]): NetReleaseGroup[] {
  const merged = new Map<string, NetReleaseGroup>();
  for (const g of raw) {
    const id = classifyUserAgent(g.userAgent);
    const client = id.client ?? NET_UNIDENTIFIED_CLIENT;
    const version = id.client ? id.version : null;
    const k = JSON.stringify([client, version, g.protocolVersion]);
    const m = merged.get(k) ?? {
      client,
      version,
      protocolVersion: g.protocolVersion,
      nodes: 0,
      behindTip: 0,
      tipUnknown: 0,
    };
    m.nodes += g.nodes;
    m.behindTip += g.behindTip;
    m.tipUnknown += g.tipUnknown;
    merged.set(k, m);
  }
  return [...merged.values()].sort(
    (a, b) =>
      b.nodes - a.nodes ||
      a.client.localeCompare(b.client) ||
      (a.version ?? "").localeCompare(b.version ?? "") ||
      (b.protocolVersion ?? -1) - (a.protocolVersion ?? -1),
  );
}
