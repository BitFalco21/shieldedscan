import type { PulseFrame, PulsePending, PulseWindowFrame } from "@/domain";
import { isFiniteNumber } from "@/lib/finite";
import { isPulseBlock, isPulseBlockPools, isPulseEvent, isPulseLedgerRow } from "./shape-guards";

/**
 * The wire guard for `/api/pulse/live` and `/api/pulse/window`.
 *
 * Beyond shape-checking, `parsePulseWindow` refuses an answer to a different question: an hour
 * of some other time is well-formed and animates perfectly, so only the echoed window can reveal
 * a cache key or endpoint that failed to narrow.
 *
 * A malformed row is dropped; a malformed envelope fails the payload. This is an enhancement over
 * a server-rendered page, so degrading to "no new movements" still leaves a correct page.
 */

/** The live endpoint's own name for itself, echoed and checked. */
export const PULSE_LIVE_KIND = "pulse-live";

export interface PulseLivePayload {
  kind: typeof PULSE_LIVE_KIND;
  frame: PulseFrame;
  /**
   * The mempool layer, or `null` when our node could not be asked. `null` (our outage) and
   * `{events: [], count: 0}` (an empty mempool) are opposite claims and must stay distinct.
   */
  pending: PulsePending | null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** The span a frame or an hour covers; checked finite so a `NaN` boundary fails outright. */
function parseWindow(value: unknown): { fromSeconds: number; toSeconds: number } | null {
  if (typeof value !== "object" || value === null) return null;
  const w = value as Record<string, unknown>;
  if (!isFiniteNumber(w.fromSeconds) || !isFiniteNumber(w.toSeconds)) return null;
  return { fromSeconds: w.fromSeconds, toSeconds: w.toSeconds };
}

/** The mempool layer. A malformed block degrades to `null` ("could not read"), never to empty. */
function parsePending(value: unknown): PulsePending | null {
  if (typeof value !== "object" || value === null) return null;
  const p = value as Record<string, unknown>;
  if (!isFiniteNumber(p.count)) return null;
  return {
    events: asArray(p.events).filter(isPulseEvent),
    count: p.count,
    ...(p.truncated === true ? { truncated: true as const } : {}),
  };
}

/**
 * The frame: the tip, the closes the boxes read, and the movements behind them. `stocks` is
 * required, not defaulted: every box's size and ruler come from it.
 */
function parseFrame(value: unknown): PulseFrame | null {
  if (typeof value !== "object" || value === null) return null;
  const f = value as Record<string, unknown>;
  const window = parseWindow(f.window);
  if (window === null) return null;
  if (!isFiniteNumber(f.tip)) return null;
  if (!isPulseBlockPools(f.stocks)) return null;
  return {
    window,
    tip: f.tip,
    stocks: f.stocks,
    blocks: asArray(f.blocks).filter(isPulseBlock),
    swaps: asArray(f.swaps).filter(isPulseEvent),
    // Carried so a truncated set of crossings is never drawn as the whole span.
    ...(f.swapsTruncated === true ? { swapsTruncated: true as const } : {}),
    ledger: asArray(f.ledger).filter(isPulseLedgerRow),
  };
}

export function parsePulseLive(body: unknown): PulseLivePayload | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  // Strict: a missing echo fails too, since absence is what an older endpoint (or a stale
  // cached response) sends.
  if (b.kind !== PULSE_LIVE_KIND) return null;
  const frame = parseFrame(b.frame);
  if (frame === null) return null;
  return { kind: PULSE_LIVE_KIND, frame, pending: parsePending(b.pending) };
}

/**
 * One replay hour, refused unless it is the hour that was asked for. Both boundaries are aligned
 * integers, so the echo must match exactly.
 */
export function parsePulseWindow(
  body: unknown,
  fromSeconds: number,
  toSeconds: number,
): PulseWindowFrame | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  const applied = parseWindow(b.applied);
  if (applied === null) return null;
  if (applied.fromSeconds !== fromSeconds || applied.toSeconds !== toSeconds) return null;
  return {
    applied,
    blocks: asArray(b.blocks).filter(isPulseBlock),
    swaps: asArray(b.swaps).filter(isPulseEvent),
    ...(b.truncated === true ? { truncated: true as const } : {}),
    // Absent stays absent: `[]` would claim no transparent outputs in the hour, while an API
    // predating the field said nothing. The page renders the two cases differently.
    ...(b.ledger === undefined ? {} : { ledger: asArray(b.ledger).filter(isPulseLedgerRow) }),
    ...(b.ledgerTruncated === true ? { ledgerTruncated: true as const } : {}),
  };
}
