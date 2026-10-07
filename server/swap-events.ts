import { Pool } from "pg";
import {
  encodeSwapWatermark,
  parseSwapWatermark,
  SWAP_SETTLE_SECONDS,
  type SwapFigures,
  type SwapWatermark,
} from "@/domain/swap";
import { SETTLEMENT_ASSETS, protocolLabel, type CrossChainProtocol } from "@/domain/crosschain";
import { chainName } from "@/lib/chains";
import { printableOnly } from "@/lib/printable";
import "./pg-types";

/**
 * The watermark helpers and `SWAP_SETTLE_SECONDS` are pure and live in `@/domain/swap`, so the X
 * poster can use them without depending on `server/` (and `pg`). Re-exported here unchanged for
 * existing callers; the domain module is the one definition.
 */
export { encodeSwapWatermark, parseSwapWatermark, SWAP_SETTLE_SECONDS, type SwapWatermark };

/**
 * The venues this project ingests; `protocolLabel` is exhaustive over exactly these.
 *
 * `satisfies Record<CrossChainProtocol, true>` makes the list compiler-enforced: adding a venue to
 * the union and forgetting it here is a build error, not a silent stall in `eligibleSwaps`'s
 * protocol filter.
 */
const KNOWN_PROTOCOLS_BY_NAME = {
  thorchain: true,
  maya: true,
  "near-intents": true,
} as const satisfies Record<CrossChainProtocol, true>;

const KNOWN_PROTOCOLS: readonly CrossChainProtocol[] = Object.keys(
  KNOWN_PROTOCOLS_BY_NAME,
) as CrossChainProtocol[];

function isKnownProtocol(value: string): value is CrossChainProtocol {
  return Object.hasOwn(KNOWN_PROTOCOLS_BY_NAME, value);
}

/** A ticker is short; this is generous, not a real length limit anyone should hit. */
const MAX_SWAP_TEXT_LENGTH = 24;

/**
 * Sanitises a venue's own asset ticker and chain name, as `decodeCoinbaseTag` does a coinbase
 * script: both are attacker-chosen bytes reaching a public surface (here a public post and a
 * rendered image). `counterpart_asset` is whatever the venue's API published, and venues have
 * published phrases where a ticker belonged. The X poster's URL check covers URL-shaped text; this
 * covers the rest, such as a planted `@handle` or an imperative.
 *
 * Whitespace collapses before the control-character strip: `printableOnly` drops a newline rather
 * than replacing it, which would fuse two words into one nobody wrote. Capped well short of
 * `decodeCoinbaseTag`'s 120 characters, because no ticker or chain name is that long.
 */
function sanitizeSwapText(raw: string): string {
  return printableOnly(raw.replace(/\s+/g, " ")).trim().slice(0, MAX_SWAP_TEXT_LENGTH);
}

export interface EligibleSwapsOptions {
  /** Floor in USD, at swap time. A crossing the venue never priced never clears it. */
  minUsd: number;
  /**
   * The watermark: only crossings strictly after this position in `(timestamp, id)` order are new.
   * `null` means nothing has been considered yet. A non-null value that does not parse is an error,
   * never a silent restart.
   */
  since: string | null;
  /** How long a crossing must have sat, in seconds, before it is trusted not to be restated. */
  settleSeconds: number;
  /** The instant "now" is measured from — passed in, never read from the clock here. */
  nowMs: number;
  limit: number;
}

interface EligibleSwapRow {
  id: string;
  protocol: string;
  timestamp: number;
  counterpart_chain: string;
  counterpart_asset: string;
  counterpart_amount: number;
  zcash_txid: string;
  zec_amount_zat: number;
  usd_value_at_swap: number;
  direction: string;
}

/**
 * The query that decides which cross-chain crossings reach the public timeline. Every clause
 * excludes something that would otherwise be posted, and several exist only because of what
 * `crosschain_transfer`'s DDL allows (refunded or pending rows, unsettled amounts).
 */
export async function eligibleSwaps(
  pool: Pool,
  opts: EligibleSwapsOptions,
): Promise<SwapFigures[]> {
  const nowSec = Math.floor(opts.nowMs / 1000);
  const settleBefore = nowSec - opts.settleSeconds;

  const params: unknown[] = [
    opts.minUsd, // $1
    settleBefore, // $2
    SETTLEMENT_ASSETS, // $3
    KNOWN_PROTOCOLS, // $4
  ];
  // `since` is optional: on the first run there is nothing already considered, and the clause must
  // not fire at all. When present it is a composite keyset (a row-value comparison over
  // (timestamp, id), both ascending), because `timestamp` alone is not unique and
  // `timestamp > $since` would drop rows of a tied group that `LIMIT` cut off from a prior batch.
  let sinceClause = "";
  if (opts.since !== null) {
    const watermark = parseSwapWatermark(opts.since);
    params.push(watermark.timestamp, watermark.id);
    sinceClause = `AND (timestamp, id) > ($${params.length - 1}, $${params.length})`;
  }
  params.push(opts.limit);
  const limitParam = params.length;

  const { rows } = await pool.query<EligibleSwapRow>(
    `SELECT id, protocol, timestamp, counterpart_chain, counterpart_asset,
            counterpart_amount, zcash_txid, zec_amount_zat, usd_value_at_swap, direction
       FROM crosschain_transfer
      -- Both directions: inbound and outbound crossings are announced alike.
        WHERE direction IN ('in', 'out')
        -- The single most important filter here: the CHECK also permits 'pending' and
        -- 'refunded'. Posting a refunded swap announces a movement that was undone;
        -- posting a pending one announces one that has not happened.
        AND status = 'completed'
        -- Wrapped ZEC redeeming to native ZEC is a real crossing this project counts,
        -- but as a post it reads as nonsense ("1,000 ZEC/ZEC on Maya -> 1,000 ZEC").
        -- assetTickerIsKnown cannot catch it, because "ZEC/ZEC" contains no space.
        AND counterpart_is_synthetic = false
        -- A CACAO or RUNE counterpart is a venue settling its own internal accounts,
        -- not a crossing — every other read path (postgres-crosschain-store.ts's list/count/
        -- aggregate queries) excludes exactly this, via the same shared constant.
        AND counterpart_asset <> ALL($3)
        -- Only a venue this project can label. protocol carries no CHECK constraint
        -- (unlike direction/status), so this is what keeps LIMIT applying to rows that
        -- can actually be posted — filtering the unknown-protocol rows out AFTER the
        -- LIMIT (in JS) could return a page with nothing postable on it, and the caller
        -- would have no row left to advance its watermark from.
        AND protocol = ANY($4)
        -- The schema's own comment says NULL means unsettled, and the card prints
        -- this number.
        AND counterpart_amount IS NOT NULL
        -- The whole of the post's call to action.
        AND zcash_txid IS NOT NULL
        -- SQL's three-valued logic excludes a NULL price for free: NULL >= $1 is
        -- neither true nor false, so an unpriced crossing never clears the floor.
        -- That is the wanted behaviour, not an accident of the comparison.
        AND usd_value_at_swap >= $1
        -- The venue may still restate this row; wait it out before trusting it. Both
        -- the venue's own timestamp AND when we first stored it must predate the
        -- settle window — a backfilled row can carry an old venue timestamp while
        -- having sat zero seconds in our own database, which is exactly the
        -- restatement risk this window exists to guard against.
        AND timestamp <= $2
        AND first_seen_at <= $2
        ${sinceClause}
      ORDER BY timestamp ASC, id ASC
      LIMIT $${limitParam}`,
    params,
  );

  const results: SwapFigures[] = [];
  for (const row of rows) {
    // The SQL already restricts to known protocols, but `protocol` has no CHECK constraint and
    // `protocolLabel` is an exhaustive switch with no default, so this narrows the type before it
    // gets there. A row this project cannot label is skipped, never posted with a missing venue
    // name.
    if (!isKnownProtocol(row.protocol)) continue;
    // Native-ness is a fact about the raw row: comparing sanitised forms could let two different
    // tickers collide after stripping.
    const counterpartIsNative = row.counterpart_asset === row.counterpart_chain;
    results.push({
      transferId: row.id,
      timestamp: row.timestamp,
      zecAmountZat: row.zec_amount_zat,
      usdAtSwap: row.usd_value_at_swap,
      // Both are the venue's own bytes reaching a public post and a rendered image; see
      // `sanitizeSwapText`.
      counterpartAsset: sanitizeSwapText(row.counterpart_asset),
      counterpartChain: row.counterpart_chain,
      counterpartChainName: sanitizeSwapText(chainName(row.counterpart_chain)),
      counterpartAmount: row.counterpart_amount,
      counterpartIsNative,
      venue: protocolLabel(row.protocol),
      zcashTxid: row.zcash_txid,
      // The CHECK on this column permits only 'in' and 'out', and the query asks for exactly those,
      // so anything else means the schema moved; defaulting to inbound would announce an outbound
      // crossing as money arriving.
      direction: row.direction === "out" ? "out" : "in",
    });
  }
  return results;
}
