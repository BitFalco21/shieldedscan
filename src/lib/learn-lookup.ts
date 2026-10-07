import type { LearnEntry, LearnPoolMove, LearnShape, LearnTx } from "@/domain";
import { POOL_NAMES } from "@/domain";

/**
 * The contract between `/api/learn` and the learning page's checker, held in one file both
 * import — so a field renamed on one side fails the other's types instead of rendering a blank.
 *
 * The route answers "what is this transaction?" (`?txid=`) and "show me a real example of this
 * shape" (`?example=`). Every answer echoes the question it answered, and the client discards an
 * answer to a different one, so a misconfigured cache key yields a miss rather than someone
 * else's answer.
 */

/** The shapes the page can ask for an example of: the four a beginner's steps produce. */
export const LEARN_EXAMPLE_SHAPES = [
  "transparent",
  "shielding",
  "shielded",
  "unshielding",
] as const;
export type LearnExampleShape = (typeof LEARN_EXAMPLE_SHAPES)[number];

export const TXID_PATTERN = /^[0-9a-f]{64}$/;

export type LearnLookupStatus = "found" | "missing" | "invalid" | "unavailable";

export interface LearnLookupResponse {
  readonly txid: string | null;
  readonly example: LearnExampleShape | null;
  readonly status: LearnLookupStatus;
  readonly tx: LearnTx | null;
}

export function parseExampleShape(raw: string | null): LearnExampleShape | null {
  return LEARN_EXAMPLE_SHAPES.find((shape) => shape === raw) ?? null;
}

const SHAPES: readonly LearnShape[] = [
  "transparent",
  "shielding",
  "shielded",
  "unshielding",
  "coinbase",
  "mixed",
];
const STATUSES: readonly LearnLookupStatus[] = ["found", "missing", "invalid", "unavailable"];

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;

function isEntry(v: unknown): v is LearnEntry {
  return isRecord(v) && typeof v.address === "string" && isCount(v.valueZat);
}

function isPoolMove(v: unknown): v is LearnPoolMove {
  return (
    isRecord(v) &&
    POOL_NAMES.some((p) => p === v.pool) &&
    typeof v.valueBalanceZat === "number" &&
    Number.isFinite(v.valueBalanceZat)
  );
}

function isLearnTx(v: unknown): v is LearnTx {
  return (
    isRecord(v) &&
    typeof v.txid === "string" &&
    SHAPES.some((s) => s === v.shape) &&
    (v.blockHeight === null || isCount(v.blockHeight)) &&
    isCount(v.timestamp) &&
    (v.feeZat === null || isCount(v.feeZat)) &&
    Array.isArray(v.inputs) &&
    v.inputs.every(isEntry) &&
    Array.isArray(v.outputs) &&
    v.outputs.every(isEntry) &&
    isCount(v.inputCount) &&
    isCount(v.outputCount) &&
    isCount(v.inputTotalZat) &&
    isCount(v.outputTotalZat) &&
    Array.isArray(v.pools) &&
    v.pools.every((p) => POOL_NAMES.some((name) => name === p)) &&
    Array.isArray(v.poolMoves) &&
    v.poolMoves.every(isPoolMove)
  );
}

/**
 * Accept a response only if it is well formed AND answers the question that was asked. Anything
 * else is null, which the page renders as "could not check right now" — never as a result.
 */
export function parseLearnResponse(
  body: unknown,
  asked: { txid?: string; example?: LearnExampleShape },
): LearnLookupResponse | null {
  if (!isRecord(body) || !STATUSES.some((s) => s === body.status)) return null;
  const txid = typeof body.txid === "string" ? body.txid : null;
  const example = parseExampleShape(typeof body.example === "string" ? body.example : null);
  if ((asked.txid ?? null) !== txid || (asked.example ?? null) !== example) return null;
  const status = body.status as LearnLookupStatus;
  if (status !== "found") return { txid, example, status, tx: null };
  if (!isLearnTx(body.tx)) return null;
  // A found transaction must be the one asked about; an example must have the shape asked for.
  if (asked.txid && body.tx.txid !== asked.txid) return null;
  if (asked.example && body.tx.shape !== asked.example) return null;
  return { txid, example, status, tx: body.tx };
}
