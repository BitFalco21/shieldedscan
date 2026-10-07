import { marketCapFromTermsUsd } from "@/domain";
import { formatUsdExact } from "@/lib/format";
import { labelFor, priceInCurrency, withPoolValues } from "./enrich";
import { asRecord, NOT_JSON, parseJson, reshapeJson } from "./json";
import { HALVING_NOTE, NETWORK_FEES_NOTE, REORG_NOTE, SUPPLY_NOTE } from "./notes";
import { dataBlock, withFormattedZec } from "./payload";
import {
  CHAIN_PATH,
  HALVING_PATH,
  NETWORK_FEES_PATH,
  PRICE_FACET_PATHS,
  REORG_SUMMARY_PATH,
  STATUS_PATH,
  SUPPLY_PATH,
} from "./specs";
import type { ToolCall, Valuation } from "./types";

/**
 * Entity payloads (a transaction, a block, an address, a chain facet) as the model reads them,
 * with the note of ours that sits above some of them.
 */

/**
 * The `/v1` facets that carry a note of ours, keyed by path.
 *
 * A note exists where a payload has a property a summary would discard:
 *
 *  - supply: every pool total is public, not "knowable only with a viewing key".
 *  - halving: the countdown is derived from the tip and shrinks continuously, so a date built from
 *    it is an estimate, not a schedule.
 *  - fees: ZIP-317 is convention. Read as a measurement it overstates; as an estimate it understates.
 *  - reorgs: one node's rollbacks are not a census, and a low count mostly means we did not see them.
 *
 * Only the reorg summary is keyed, not the event list: both arrive in one tool result with the note
 * first, so keying both would print it twice.
 */
const ENTITY_NOTES: Readonly<Record<string, string>> = {
  [SUPPLY_PATH]: SUPPLY_NOTE,
  [HALVING_PATH]: HALVING_NOTE,
  [NETWORK_FEES_PATH]: NETWORK_FEES_NOTE,
  [REORG_SUMMARY_PATH]: REORG_NOTE,
};

/**
 * Notes for paths `ENTITY_NOTES` cannot key, matched by pattern: paths with a query string (a
 * drill-down's `limit`) or a dynamic segment (an address).
 *
 * Patterns must be mutually exclusive. The address summary is `$`-anchored so it cannot also match
 * its own `/transactions` drill-down, which carries a different note.
 */
const PATTERN_NOTES: readonly { prefix: RegExp; note: string }[] = [
  {
    prefix: /^\/v1\/blocks\/[^/]+\/transactions\b/,
    note: `The FIRST few transactions in this block, in the block's own order, not all of them. The block payload beside this carries \`txCount\`, which is the TRUE total — quote that for "how many", and say the list is the first few. A block on this chain can hold thousands, so never describe these rows as the block's contents or compute a composition from them; the block's own \`composition\` counts every transaction in it.`,
  },
  {
    prefix: /^\/v1\/addresses\/[^/]+\/transactions\b/,
    note: `This address's MOST RECENT transactions, newest first — a window on its history, never the whole of it. The address summary beside this carries the true transaction count; quote that for "how many". A transaction appears here because this address is on one side of it, which says nothing about who controls the other side: never name a counterparty, never link two of these transactions to each other, and never decide which output was a payment and which was change. A transparent address's net change across one transaction is exact arithmetic and may be stated.

If this address is SHIELDED there is no history to list — that is the protocol working as designed, not a gap in our data and not an outage. Say what the summary beside it says.`,
  },
  {
    prefix: /^\/v1\/addresses\/[^/]+$/,
    note: `A \`label\` is the name this site prints on this address's page — give it as this explorer's label, and \`labelSource\` says whose attribution it is if asked. No \`label\` means this explorer names none.

EVERY FIGURE HERE COVERS TRANSPARENT ADDRESSES ONLY. \`rank\` is this address's place on the transparent rich list, so it is never a rank among Zcash holders and never evidence that anyone is among the largest — most of the chain's value can be shielded, and shielded holdings are not enumerable by design. Say "the Nth largest TRANSPARENT address" or do not say largest at all.

TWO CLOCKS, AND ONLY ONE OF THEM IS STAMPED. \`balanceZat\`, \`totalReceivedZat\`, \`totalSentZat\` and \`txCount\` come from the chain index and are current. \`rank\` comes from the rich list, which is rebuilt hourly, and is as of \`rankAsOfHeight\` — quote that height beside it, and never the chain tip, which is a different number.

A NULL RANK IS TWO DIFFERENT ANSWERS and \`unknowns.rank\` says which. \`nonexistent\` means the address holds nothing, so it is on no rich list — a measurement, and the right words are "it holds no ZEC", never "unranked" and never "we do not know". \`unmeasured\` means we could not read the list; that is our gap, never a fact about the address. A null \`txCount\` is always \`unmeasured\` — our gap, never a fact about the address. It counts EVERY address, including one that has spent everything, so a zero is a measurement: the address has appeared in no transaction.

\`txCount\` counts TRANSACTIONS THIS ADDRESS APPEARS IN, once each, on either side. It is not a count of payments made, of payments received, or of counterparties.

NEVER NAME THE PARTY BEHIND AN ADDRESS, and never group addresses into one holder. One address is one address: an exchange holds thousands and one address holds thousands of people's coins.

A SHIELDED address carries none of these fields — no balance, no rank, no count. That is the protocol, not an omission here.`,
  },
];

/** `/v1/transactions/{txid}` itself — not `/privacy`, which carries no input arrays. */
const TX_DETAIL_PATH_RE = /^\/v1\/transactions\/[^/?]+$/;

/**
 * How many entries of each transparent side the model is shown.
 *
 * `/v1` caps the arrays at 1,000 (with `transparentInputCount` always emitted). For the agent that is
 * far too generous: a 1,000-input transaction is ~150 KB of JSON streamed to the model twice per
 * turn, so one question about a wide transaction would cost as much of the day's budget as dozens of
 * ordinary ones. The model needs the shape of the sides, not every row — counts and totals are
 * separate fields — so the arrays are trimmed here, with `…Shown` beside the true count.
 */
export const MAX_TX_SIDE_ENTRIES = 40;

/**
 * A transaction payload with each transparent side trimmed to `MAX_TX_SIDE_ENTRIES`, the true
 * counts left untouched, and a `…Shown` field beside every trimmed array. Falls back to the raw
 * body when it does not parse, as every payload does (`reshapeJson`).
 */
export function transactionJson(body: string): string {
  return reshapeJson(body, (parsed) => {
    const record = asRecord(parsed);
    if (record === null) return withFormattedZec(parsed);
    const out: Record<string, unknown> = { ...record };
    for (const side of ["transparentInputs", "transparentOutputs"] as const) {
      const rows = out[side];
      if (!Array.isArray(rows)) continue;
      const shown = rows.length > MAX_TX_SIDE_ENTRIES ? rows.slice(0, MAX_TX_SIDE_ENTRIES) : rows;
      // The name /tx prints in place of a labelled address, resolved the same way it is there.
      out[side] = shown.map((row: unknown) =>
        typeof row === "object" && row !== null
          ? {
              ...(row as Record<string, unknown>),
              ...labelFor((row as { address?: unknown }).address),
            }
          : row,
      );
      // The count field is the fact; this says how much of it the array beside it carries.
      if (shown !== rows) out[`${side}Shown`] = MAX_TX_SIDE_ENTRIES;
    }
    return withFormattedZec(out);
  });
}

/** The address summary's path: exactly `/v1/addresses/<a>`, never its drill-downs. */
const ADDRESS_SUMMARY_PATH_RE = /^\/v1\/addresses\/[^/]+$/;

/**
 * The address summary with the name this site prints on the address's page.
 *
 * `/v1` serves no label (a name would travel without its basis), so the agent reads
 * `ADDRESS_LABELS` itself, exactly as `/address` does — otherwise it would say "this explorer does
 * not label it" beside a page that does.
 */
function addressJson(body: string): string {
  return reshapeJson(body, (parsed) => {
    const out = asRecord(parsed);
    return withFormattedZec(out === null ? parsed : { ...out, ...labelFor(out.address) });
  });
}

/**
 * One `/v1` payload as the model reads it, with our note above it where the path has one. The note
 * sits outside the `<data>` envelope: what it wraps is retrieved content that anyone may have
 * written, and what precedes it is ours.
 */
export function entityBlock(
  path: string,
  retrievedAt: string,
  body: string,
  valuation: Valuation,
): string {
  const payload =
    path === SUPPLY_PATH
      ? supplyJson(body, valuation)
      : path === CHAIN_PATH
        ? chainJson(body, valuation)
        : path === STATUS_PATH
          ? chainJson(body, valuation)
          : TX_DETAIL_PATH_RE.test(path)
            ? transactionJson(body)
            : ADDRESS_SUMMARY_PATH_RE.test(path)
              ? addressJson(body)
              : reshapeJson(body, withFormattedZec);
  const note = ENTITY_NOTES[path] ?? PATTERN_NOTES.find((l) => l.prefix.test(path))?.note;
  const block = dataBlock(path, retrievedAt, payload);
  return note === undefined ? block : `<note source="GET ${path}">\n${note}\n</note>\n${block}`;
}

/**
 * The spot ZEC/USD price from whichever facet of this same call carries one, or null.
 *
 * Null-safe by construction: `priceUsd` is nullable because it comes from a poller that is cold at
 * start-up and can fail. A non-2xx facet is skipped, and `Number.isFinite` rejects a `NaN` that
 * `typeof x === "number"` accepts — a NaN price would value every pool at "$NaN".
 */
export function spotPriceUsdFrom(
  fetched: readonly { call: ToolCall; status: number; body: string }[],
): number | null {
  for (const { call, status, body } of fetched) {
    if (!PRICE_FACET_PATHS.includes(call.path) || status < 200 || status >= 300) continue;
    const parsed = parseJson(body);
    if (parsed === NOT_JSON) continue;
    const price = asRecord(parsed)?.priceUsd;
    if (typeof price === "number" && Number.isFinite(price) && price > 0) return price;
  }
  return null;
}

/**
 * The chain payload with its market cap computed, because the model may not multiply.
 *
 * `/v1/chain` publishes `circulatingSupplyZat` and `priceUsd` but no market cap, while this site's
 * homepage renders one from those two terms. Without this, the agent would either refuse a question
 * the front page answers or reason around the arithmetic rule.
 *
 * `marketCapFromTermsUsd` is the domain's own function, shared with the homepage, so the two cannot
 * disagree. Null when no price is measured — a market cap without a price is unknown, never smaller
 * — and the key is emitted either way so absence cannot read as zero.
 *
 * The chain facet, including the price converted to the reader's currency. Pool balances alone are
 * not enough: "what is ZEC worth in euros" needs the spot price itself converted, or the agent
 * receives only dollars and correctly declines to derive a euro figure.
 */
function chainJson(body: string, v: Valuation): string {
  return reshapeJson(body, (parsed) => {
    const p = asRecord(parsed);
    if (p === null) return withFormattedZec(parsed);
    const supplyZat = typeof p.circulatingSupplyZat === "number" ? p.circulatingSupplyZat : null;
    const price = typeof p.priceUsd === "number" && Number.isFinite(p.priceUsd) ? p.priceUsd : null;
    const cap = supplyZat === null ? null : marketCapFromTermsUsd(supplyZat, price);
    return withFormattedZec({
      ...p,
      marketCapUsd: cap === null ? null : formatUsdExact(cap),
      ...priceInCurrency(price, cap, v),
    });
  });
}

/** The supply payload with each pool's balance valued in dollars, then formatted as usual. */
function supplyJson(body: string, v: Valuation): string {
  return reshapeJson(body, (parsed) => withFormattedZec(withPoolValues(parsed, v)));
}
