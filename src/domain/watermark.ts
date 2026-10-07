/** A composite watermark's decoded halves. */
export interface EventWatermark {
  /** The ordering column: a unix timestamp for a transfer, a block height for a tx. */
  position: number;
  /** The tiebreak: an id or a txid, unique within one position. */
  id: string;
}

/**
 * Encodes the boundary row of a batch as an opaque watermark, `"<position>:<id>"`.
 *
 * The id tiebreak is required. Keyed on the ordering column alone, a query's `LIMIT` can cut
 * a tied group mid-way and the next poll's `> since` would skip the remaining rows forever.
 * Encoding a full `(position, id)` position avoids that.
 *
 * Shared by the swap poller (venue timestamp) and the boundary poller (block height);
 * `swap.ts` re-exports these under its own names.
 */
export function encodeEventWatermark(position: number, id: string): string {
  return `${position}:${id}`;
}

/**
 * A bare unsigned decimal integer. `Number()` alone would accept `"0x10"` or `"1e5"`, which
 * this encoder never produces; only its own output should round-trip.
 */
const POSITION_PATTERN = /^\d+$/;

/**
 * Parses a watermark, throwing on anything malformed. Degrading to "no watermark" would
 * make the poller reconsider, and repost, the entire history.
 */
export function parseEventWatermark(raw: string): EventWatermark {
  const fail = (): never => {
    throw new Error(`malformed event watermark: ${JSON.stringify(raw)}`);
  };
  const separator = raw.indexOf(":");
  if (separator === -1) return fail();
  const positionPart = raw.slice(0, separator);
  const id = raw.slice(separator + 1);
  if (id.length === 0) return fail();
  if (!POSITION_PATTERN.test(positionPart)) return fail();
  const position = Number(positionPart);
  if (!Number.isSafeInteger(position)) return fail();
  return { position, id };
}
