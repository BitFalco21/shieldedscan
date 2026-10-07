import { printableOnly } from "@/lib/printable";
import { classifySearchQuery } from "@/domain";
import { entityHrefIsRoutable } from "@/lib/entity-page";
import { V1_MINERS_PATH } from "../../v1/miners";
import { V1_TRANSPARENT_PATH } from "../../v1/transparent-series";
import { ZIP_INDEX_PATH } from "../../zips-routes";
import { referenceSource } from "../reference";
import { asRecord } from "./json";
import type { ToolName } from "./names";
import {
  API_DESCRIPTOR_PATH,
  API_DOCS_SOURCE,
  CHAIN_WINDOW_PATH,
  COVERAGE_SOURCE,
  CROSSCHAIN_AGGREGATE_PATH,
  CROSSCHAIN_DESTINATIONS_PATH,
  CROSSCHAIN_TOP_PATH,
  CROSSCHAIN_TRANSFERS_PATH,
  INSIGHT_TOPICS,
  LABELS_SOURCE,
  MARKET_PATH,
  PRICE_HISTORY_PATH,
  PRIVACY_SOURCE,
  RECENT_BLOCKS_PATH,
  RECENT_TRANSACTIONS_PATH,
  REORG_SUMMARY_PATH,
  SITE_PAGES_SOURCE,
} from "./specs";
import type { SourceLink } from "./types";

/**
 * How a tool call shows outside the model: the subject on its thinking-trail row, and the citation
 * derived from what it read.
 */

/**
 * One part of a step subject: an argument key, and the words that make its value read as English.
 * `days: 7` alone renders as a bare `7`, and `to: "2026-08-01"` alone does not say which end of the
 * window it is, so the wording travels with the key.
 */
export interface SubjectPart {
  key: string;
  /** Rendered before the value: `to 2026-08-01`. */
  prefix?: string;
  /** Rendered after it: `7 days`. */
  suffix?: string;
}

/**
 * Which arguments identify a call, most identifying first.
 *
 * Typed `Record<ToolName, …>`, so a new tool does not compile until it says what its rows read.
 *
 * Deliberately a subset of each schema: a step row is a label, not a dump, and arguments that modify
 * a call without identifying it (`limit`, `withTransactions`, `by`) would push the subject off the
 * line. Keys are checked against each tool's `defs()` schema by `step-subject.test.ts`, because a key
 * matching nothing produces a blank row rather than an error.
 */
export const SUBJECT_PARTS: Record<ToolName, readonly SubjectPart[]> = {
  lookup_transaction: [{ key: "txid" }],
  lookup_block: [{ key: "heightOrHash" }],
  lookup_address: [{ key: "address" }],
  chain_status: [{ key: "include" }],
  explorer_analytics: [{ key: "series" }],
  explorer_insights: [{ key: "topic" }],
  zec_price_history: [{ key: "on" }, { key: "days", suffix: "days" }, { key: "to", prefix: "to" }],
  crosschain: [
    { key: "mode" },
    { key: "chain" },
    { key: "venue" },
    { key: "direction" },
    { key: "sort" },
    { key: "from" },
    { key: "to", prefix: "to" },
    // The trailing window and the threshold both identify the question: two calls differing only in
    // either are different questions, so a row without them would name the wrong period or population.
    { key: "lastDays", suffix: "days" },
    // "over $" would render as `over $ 10000` (a prefix is joined with a space), so the currency goes on
    // the far side.
    { key: "minUsdAtSwap", prefix: "over", suffix: "USD" },
    { key: "minZec", prefix: "over", suffix: "ZEC" },
    { key: "groupBy", prefix: "by" },
  ],
  chain_activity: [
    { key: "mode" },
    { key: "kind" },
    { key: "from" },
    { key: "to", prefix: "to" },
    { key: "lastDays", suffix: "days" },
    { key: "groupBy", prefix: "by" },
    { key: "migrationFrom" },
    { key: "migrationTo", prefix: "into" },
  ],
  // The one tool with no parameters; the empty array is an assertion, and the test that every tool with
  // arguments has a subject exempts exactly this one.
  wrapped_zec_pools: [],
  zip_index: [{ key: "zip", prefix: "ZIP" }, { key: "section" }, { key: "query" }],
  zcash_reference: [{ key: "topic" }],
  site_guide: [{ key: "section" }, { key: "endpoint" }],
  // The expressions themselves: after validation they are digits and five operators, so the subject
  // shows the actual arithmetic — the operand-choice risk, visible on the trail.
  calculate: [{ key: "expressions" }],
};

/** Long enough for a date range plus a chain; short enough that no row can shove the trail. */
export const MAX_STEP_SUBJECT_CHARS = 72;

/** Per value, before the parts are joined — one argument may not consume the whole line. */
const MAX_SUBJECT_VALUE_CHARS = 32;

/** Beyond this, an unbroken alphanumeric run is an identifier and is elided like one. */
const IDENTIFIER_CHARS = 26;

/** Items of an array argument shown in full; the rest are counted, never dropped silently. */
const MAX_SUBJECT_ITEMS = 3;

/**
 * One argument value, made safe and short enough for a row of the thinking trail.
 *
 * These bytes are model-authored, and every injection carrier (coinbase tags, venue labels, pool
 * symbols) reaches the model as text it may quote back into a tool call, so a subject is a path by
 * which an injected string reaches the page. It is rendered as text, never through `AnswerMarkdown`,
 * so this is defence in depth — but a control character could still repaint a terminal-styled
 * console, and a wall of whitespace could push real rows off the line.
 */
function subjectValue(raw: unknown): string | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? String(raw) : null;
  if (typeof raw !== "string") return null;
  // Whitespace collapses before the control-character strip: `printableOnly` drops a newline rather
  // than replacing it, and would render `a\nb` as `ab`, joining two of the model's words into one.
  const clean = printableOnly(raw.replace(/\s+/g, " ")).trim();
  if (clean === "") return null;
  // A txid, block hash or address, elided as `sourceLinkFor` elides the same value into a citation
  // label, so a reader sees one thing one way. Punctuation excludes it: a topic name or a path is short
  // prose, not an identifier.
  if (clean.length > IDENTIFIER_CHARS && /^[0-9a-zA-Z]+$/.test(clean)) {
    return `${clean.slice(0, 8)}…`;
  }
  return clean.length > MAX_SUBJECT_VALUE_CHARS
    ? `${clean.slice(0, MAX_SUBJECT_VALUE_CHARS - 1)}…`
    : clean;
}

/**
 * What a step in the console's thinking trail says was looked up ("3428150", "7 days", "aggregate ·
 * BTC · 2026-07-01 · to 2026-08-01"), or null when the call has no subject.
 *
 * The plain words for the tool itself are `describeTool` in `AgentConsole.tsx`. This half needs the
 * model's own arguments, so it lives beside the tool definitions that declare them.
 *
 * Never throws and never rejects a call: correcting a malformed call is `dispatch`'s business, and the
 * trail only describes what happened. An unreadable subject is absent, and the row still names the
 * tool.
 */
export function describeToolCall(name: string, rawArgs: string): string | null {
  const parts = (SUBJECT_PARTS as Record<string, readonly SubjectPart[] | undefined>)[name];
  if (parts === undefined || parts.length === 0) return null;

  let args: Record<string, unknown>;
  try {
    const parsed = asRecord(JSON.parse(rawArgs));
    if (parsed === null) return null;
    args = parsed;
  } catch {
    return null;
  }

  const rendered: string[] = [];
  for (const part of parts) {
    const raw = args[part.key];
    let value: string | null;
    if (Array.isArray(raw)) {
      const items = raw.map(subjectValue).filter((v): v is string => v !== null);
      if (items.length === 0) continue;
      // "+2 more" rather than a silent slice: an array that looks whole is a quiet lie, and a trail row is
      // exactly where a reader would not check.
      const shown = items.slice(0, MAX_SUBJECT_ITEMS).join(", ");
      value =
        items.length > MAX_SUBJECT_ITEMS
          ? `${shown}, +${items.length - MAX_SUBJECT_ITEMS} more`
          : shown;
    } else {
      value = subjectValue(raw);
    }
    if (value === null) continue;
    const text = `${part.prefix === undefined ? "" : `${part.prefix} `}${value}${part.suffix === undefined ? "" : ` ${part.suffix}`}`;
    // Whole parts only: truncating mid-token would read as a rendering fault. Parts are ordered so the
    // ones dropped are the least identifying.
    const joined = rendered.length === 0 ? text : `${rendered.join(" · ")} · ${text}`;
    if (joined.length > MAX_STEP_SUBJECT_CHARS) break;
    rendered.push(text);
  }

  return rendered.length === 0 ? null : rendered.join(" · ");
}

/**
 * Map an endpoint the loop actually called to the explorer page a reader can check it on. Citations
 * are derived from this transcript, never generated by the model: the answer is the shape, the linked
 * page is the evidence. Returns null rather than inventing a page for an endpoint that has none.
 *
 * An entity path carries a model-authored argument, so its identifier is checked here as well as at
 * the fetch. `ToolResult.endpoints` records only paths that answered, but this second check is
 * deliberate defence in depth, and it also catches a path that answers 2xx while its identifier is
 * not one this site can route.
 *
 * The shape question is answered by `entityHrefIsRoutable` — also what the sanitiser asks of a link in
 * the model's prose, so a citation and a link in the answer cannot disagree — which delegates to
 * `classifySearchQuery`. There is no second definition of a valid identifier here.
 */
function routable(link: SourceLink): SourceLink | null {
  return entityHrefIsRoutable(link.href) ? link : null;
}

export function sourceLinkFor(endpoint: string): SourceLink | null {
  /*
   * A committed reference fact: the one citation here pointing off this site. Every other branch cites
   * a page of ours because every other tool reports a figure we measured; these facts were transcribed,
   * so the evidence is the source document. The hosts are in `guard.ts`'s href allowlist, so the link
   * survives the sanitiser; the genesis entry cites /analytics because it is checkable against our index.
   */
  const reference = referenceSource(endpoint);
  if (reference !== null) return reference;

  /*
   * `site_guide`'s sections. Most cite a page a reader can open, since this tool's subject is pages.
   * 'coverage' is the exception, handled below.
   *
   * The descriptor cites /api-docs rather than the JSON at /v1: both are public, and the docs page is
   * built for a human, with parameters and a runnable playground.
   */
  if (endpoint === SITE_PAGES_SOURCE) return { label: "the explorer", href: "/" };
  /*
   * The coverage register cites nothing. Its subject is a figure that does not exist, so no page
   * carries it, and linking the page with the nearest figure would hand the reader something that looks
   * like evidence for an absence while reporting a different quantity. When the answer quotes a
   * neighbour, that neighbour is fetched and brings its own citation.
   */
  if (endpoint === COVERAGE_SOURCE) return null;
  if (endpoint === API_DOCS_SOURCE) return { label: "API reference", href: "/api-docs" };
  /*
   * 'privacy' cites the page: the answer summarises a legal document that is one click away, and every
   * claim in the payload is a string that page renders.
   */
  if (endpoint === PRIVACY_SOURCE) return { label: "privacy policy", href: "/privacy" };
  /*
   * 'labels' cites nothing, as the coverage register does: no one page carries the whole table. Looking
   * a named address up brings that address's page as its citation.
   */
  if (endpoint === LABELS_SOURCE) return null;

  const path = endpoint.replace(/^GET /, "");
  if (path === API_DESCRIPTOR_PATH) return { label: "API reference", href: "/api-docs" };

  // The ZIP index cites the page that renders the same rows, never the token-gated route.
  if (path === ZIP_INDEX_PATH) return { label: "ZIP index", href: "/zips" };

  const tx = path.match(/^\/v1\/transactions\/([^/]+)(?:\/privacy)?$/);
  if (tx !== null) {
    const txid = decodeURIComponent(tx[1]!);
    return routable({ label: `transaction ${txid.slice(0, 8)}…`, href: `/tx/${txid}` });
  }
  // A block and its transaction list cite the same page, which `dedupeSources` collapses to one
  // citation: `/block/<id>` renders both.
  const block = path.match(/^\/v1\/blocks\/([^/?]+)(?:\/transactions)?(?:\?.*)?$/);
  if (block !== null) {
    const id = decodeURIComponent(block[1]!);
    // The label is a presentation choice (a height reads in full, a hash is elided), so it asks the
    // classifier directly. Whether the link may exist at all is `routable`'s question.
    const label =
      classifySearchQuery(id).type === "height" ? `block ${id}` : `block ${id.slice(0, 8)}…`;
    return routable({ label, href: `/block/${id}` });
  }
  const address = path.match(/^\/v1\/addresses\/([^/?]+)(?:\/transactions)?(?:\?.*)?$/);
  if (address !== null) {
    const addr = decodeURIComponent(address[1]!);
    return routable({ label: `address ${addr.slice(0, 8)}…`, href: `/address/${addr}` });
  }
  // The aggregate topics cite the page that publishes the same figures, never the private endpoint:
  // a citation a reader cannot open is not evidence. Read from the same table entry as the path.
  for (const spec of Object.values(INSIGHT_TOPICS)) {
    // A topic's further reads cite the same page, which would otherwise be listed twice.
    const paths: readonly string[] = [
      spec.path,
      ...("alsoRead" in spec ? spec.alsoRead.map((a) => a.path) : []),
    ];
    if (paths.includes(path)) return spec.source;
  }
  // The daily closes have no page to cite: `/v1/prices/daily` is keyless and listed at /api-docs, but no
  // page publishes the series. The provenance a reader needs is the aggregator's name, which the note
  // makes the model state in the sentence. Matched on the prefix because the path carries the window as
  // a query string.
  if (path.startsWith(`${PRICE_HISTORY_PATH}?`) || path === PRICE_HISTORY_PATH) return null;
  /*
   * The `crosschain` modes carry query strings, and all cite a page a reader can open rather than the
   * endpoint (the aggregate's endpoint is token-gated).
   *
   * Not narrowed past the page: a pre-filtered URL would assert that the page can reproduce the exact
   * slice, which for an arbitrary month it cannot.
   */
  const base = path.split("?")[0] ?? path;
  if (base === CROSSCHAIN_AGGREGATE_PATH) {
    return { label: "cross-chain flows", href: "/cross-chain/flows" };
  }
  if (base === CROSSCHAIN_TRANSFERS_PATH || base === CROSSCHAIN_TOP_PATH) {
    return { label: "cross-chain transfers", href: "/cross-chain" };
  }
  if (base === CROSSCHAIN_DESTINATIONS_PATH) {
    return { label: "cross-chain transfers", href: "/cross-chain" };
  }
  /*
   * `chain_activity`'s modes. The window cites /analytics, which publishes the series its totals are
   * summed from; the recent lists cite the pages showing those rows. Prefix match for the query string.
   */
  if (base === CHAIN_WINDOW_PATH) return { label: "network activity", href: "/analytics" };
  if (base === RECENT_BLOCKS_PATH) return { label: "blocks", href: "/blocks" };
  if (base === RECENT_TRANSACTIONS_PATH) return { label: "transactions", href: "/txs" };
  // Who mined a period cites the page that shows the same shares by payout address.
  if (base === V1_MINERS_PATH) return { label: "mining", href: "/mining" };
  // No page publishes the transparent series yet: the endpoint's own reference entry does.
  if (base === V1_TRANSPARENT_PATH) {
    return { label: "transparent activity", href: "/api-docs#analytics-transparent" };
  }

  switch (path) {
    case "/v1/analytics/monthly":
      return { label: "network activity", href: "/analytics" };
    case "/v1/crosschain/flows":
      return { label: "cross-chain flows", href: "/cross-chain/flows" };
    case "/v1/supply":
    case "/v1/chain":
      return { label: "shielded pools", href: "/shielded" };
    case "/v1/mempool/summary":
      return { label: "mempool", href: "/mempool" };
    case REORG_SUMMARY_PATH:
      return { label: "reorgs", href: "/reorgs" };
    // The market facet reads a private path and cites `/compare`, which renders the same figures with the
    // same formatters. An explicit branch so the one third-party payload here is not silently uncitable.
    case MARKET_PATH:
      return { label: "market comparison", href: "/compare" };
    default:
      // `/v1/network/halving`, `/v1/network/fees` and `/v1/reorgs?limit=…` land here and cite nothing. The
      // reorg event list is already covered by the summary's citation to /reorgs.
      return null;
  }
}
