import type {
  BlockSummary,
  CrossChainDirectionFilter,
  CrossChainTransfer,
  TxKindFilter,
  Transaction,
} from "@/domain";
import { blockListRow, isTransaction, isTransfer } from "./shape-guards";

/**
 * The wire guard for `/api/live`.
 *
 * Beyond shape-checking, it refuses an answer to a different question: the route echoes the
 * filters it applied, and a mismatch is discarded rather than rendered. A CDN cache key is
 * infrastructure configuration that can regress silently; an echo turns that failure into a
 * visible miss instead of an unfiltered list under a filtered chip.
 */

export interface LiveTip {
  height: number;
  hash: string;
  /** The clock every relative age on the page is measured against. Never the wall clock. */
  lastBlockTimestamp: number;
}

export interface LivePayload {
  kind: TxKindFilter;
  direction: CrossChainDirectionFilter;
  tip: LiveTip;
  blocks: BlockSummary[];
  transactions: Transaction[];
  /** Empty on testnet, which serves no cross-chain data at all. */
  transfers: CrossChainTransfer[];
}

/**
 * Numbers are checked finite, not merely `typeof "number"` (which accepts `NaN`). A `NaN` tip
 * would silently misdate every relative age on the page.
 */
function parseTip(value: unknown): LiveTip | null {
  if (typeof value !== "object" || value === null) return null;
  const t = value as Record<string, unknown>;
  if (typeof t.hash !== "string") return null;
  if (!Number.isFinite(t.height) || !Number.isFinite(t.lastBlockTimestamp)) return null;
  return {
    height: t.height as number,
    hash: t.hash,
    lastBlockTimestamp: t.lastBlockTimestamp as number,
  };
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function parseLivePayload(
  body: unknown,
  expectedKind: TxKindFilter,
  expectedDirection: CrossChainDirectionFilter,
): LivePayload | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;

  // Strict: a missing echo fails too, since absence is what an API predating the field sends.
  // `kind` narrows transactions and `direction` narrows transfers; both are checked.
  if (b.kind !== expectedKind) return null;
  if (b.direction !== expectedDirection) return null;

  const tip = parseTip(b.tip);
  if (tip === null) return null;

  return {
    kind: expectedKind,
    direction: expectedDirection,
    tip,
    // A malformed row is dropped rather than failing the payload, unlike the adapters'
    // all-or-nothing rule: this layers over a page that already rendered, so "no new rows" is
    // a safe degradation.
    blocks: asArray(b.blocks)
      .map(blockListRow)
      .filter((row): row is BlockSummary => row !== null),
    transactions: asArray(b.transactions).filter(isTransaction),
    // Absent is legitimate, not degraded: testnet omits the key entirely.
    transfers: asArray(b.transfers).filter(isTransfer),
  };
}
