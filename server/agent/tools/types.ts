import type { ToolName } from "./names";

/**
 * The shapes the tool modules share: what a tool returns, the two surfaces it dispatches at, and
 * what travels with an aggregate payload.
 */

export interface ToolResult {
  /** What the model receives: one `<data>` envelope per endpoint called. */
  content: string;
  /**
   * `"GET /v1/…"` per call that answered, in order: the transcript the derived citations come from.
   *
   * A path that was requested and did not answer is deliberately absent. A citation's claim is that
   * a reader can open it and check the figure; a read that 404'd (e.g. a model-invented txid)
   * establishes nothing. The model still sees the failure inside its `<data>` or `<unavailable>`
   * block; only the claim that the failed read is checkable is withheld.
   */
  endpoints: string[];
}

export interface SourceLink {
  label: string;
  href: string;
}

/** The slice of a Hono app the tools need. Structural, so tests can pass the real /v1. */
export interface V1Requester {
  request(path: string): Response | Promise<Response>;
}

/**
 * The private API, for aggregate series `/v1` does not publish.
 *
 * Structurally identical to `V1Requester` and deliberately a separate type: the two surfaces have
 * different guarantees (keyless with labelled nulls vs token-gated with none), and a single port
 * would let a detail lookup be routed at the private API by a one-word edit.
 *
 * The implementation supplies the bearer header, so no token exists in this module and none can
 * reach the model. `server/index.ts` builds it from the same buffer the middleware compares
 * against (`bearerAuth().header()`), so the agent's dispatch cannot drift from the gate it passes.
 */
export interface ChainRequester {
  request(path: string): Response | Promise<Response>;
}

/**
 * What travels with an aggregate payload: our own note about it, and any figure we derive for it.
 * Shared by the insight topics and by the wrapped-ZEC pool read, which is an aggregate in every
 * respect except that the numbers are somebody else's.
 */
export interface AggregateSpec {
  /**
   * Prepended outside the `<data>` envelope, because it is ours and the envelope says that what it
   * wraps is not. Each note carries the one property of its series a summary would otherwise drop.
   */
  readonly note: string;
  /**
   * Adds the site's own derived figures (see `enrichIronwood` / `enrichFees`).
   *
   * The valuation carries the spot price read off a sibling facet in the same call, or null when
   * none was fetched or the poller is cold, so a figure this site renders in dollars can be handed
   * over in dollars. The model does no arithmetic, so a zatoshi-only payload leaves the dollar
   * question unanswerable — and the model will then deny the figure is public, or hand the reader a
   * price to multiply, which is the same fabrication one step removed.
   */
  readonly enrich?: (payload: unknown, valuation: Valuation) => unknown;
  /**
   * Named in the "this read failed" message. Defaulted because it only matters where the upstream is
   * not us: calling a DeFiLlama outage "an outage on our side" would be false. It names the read
   * rather than blaming a party — the same path can fail because a third party is down or because
   * our own bearer gate refused.
   */
  readonly upstream?: string;
  /**
   * Whether a payload carrying no data points is a legitimate answer rather than a failed read.
   *
   * False by default, and the default matters: an empty shielding-flow series would state that Zcash
   * has never shielded anything, so `[]` is reported as our outage. A narrowed aggregate inverts it —
   * "no ZEC crossed from Dogecoin in July" is a measurement. The two look identical on the wire, so
   * this is a property of the spec, never inferred from the payload.
   */
  readonly emptyIsAnAnswer?: boolean;
  /**
   * Checks that the server applied the narrowing that was asked for; returns why not, or null.
   *
   * An API one deploy behind ignores an unknown `?from=` and answers all-time — a well-formed
   * aggregate with nothing in the numbers to reveal it answers a different question, which a model
   * would then state as July's figure. So the echo is verified, and a mismatch becomes the same
   * `<unavailable>` block an outage produces.
   */
  readonly verify?: (payload: unknown) => string | null;
}

/**
 * One `explorer_insights` topic: the private endpoint it reads, the page that publishes the same
 * figures, and our own note about what the numbers do and do not assert.
 *
 * The page lives here rather than in `sourceLinkFor` so a topic cannot cite one place and be
 * described as living in another; a citation must point at something a reader can open, and the
 * private endpoints are not that.
 */
export interface InsightSpec extends AggregateSpec {
  readonly path: string;
  readonly source: SourceLink;
  /**
   * Further reads this topic answers from, each rendered as its own `<data>` block.
   *
   * They share the parent's note and source: the note is keyed on its text, so a topic prints one
   * caveat however many payloads it fetched, and the citation resolves to the same page. Declared
   * rather than special-cased in `dispatch`, so the per-topic endpoint test derives what to expect.
   */
  readonly alsoRead?: readonly {
    readonly path: string;
    readonly enrich?: AggregateSpec["enrich"];
  }[];
  /**
   * Whether this topic's figures are ones the site renders in dollars; if set, the spot price rides
   * along so the enrichment can value them. A property of the topic, so the question has one answer.
   */
  readonly valuesInUsd?: boolean;
}

/**
 * What a figure is valued in for this turn, and the rate that gets it there.
 *
 * One object rather than a loose `priceUsd`: every valuation is `zat → ZEC → usd → currency`, and a
 * function holding the price but not the rate would silently produce dollars under a euro heading.
 * Threading them together makes the compiler name every site when a term changes.
 *
 * `priceUsd` is nullable by design: it comes from a poller that is cold at start-up and can fail,
 * and an absent price must surface as null, never as a fallback number.
 */
export interface Valuation {
  /** Spot ZEC/USD, or null when nothing measured it. */
  priceUsd: number | null;
  /** Units of `currency` per one USD. Exactly 1 for USD. */
  rate: number;
  /** Lowercase ISO 4217, or `btc`. */
  currency: string;
}

/**
 * One dispatch: a fixed path, which surface dispatches it, and how its payload is presented.
 *
 * Surface and presentation are independent questions. `/v1/prices/daily` is public, so it dispatches
 * at `V1Requester`, yet it is a growing series with caveats of ours, so it gets the aggregate
 * treatment (a note, a window with its true count, and `<unavailable>` instead of an empty series).
 *
 * `surface` is stated at every construction site rather than defaulted: detail lookups must go
 * through /v1, where nulls arrive labelled, and a default is what a later edit changes by accident.
 *
 * `aggregate` carries the whole spec rather than a topic key, so a payload's caveats travel with the
 * path that produced it.
 */
export interface ToolCall {
  path: string;
  surface: "v1" | "chain";
  aggregate?: AggregateSpec;
}

/**
 * Every tool that actually dispatches: all but `zcash_reference` (answers from a committed constant)
 * and `calculate` (evaluates its own arguments), which both return before this is reached.
 *
 * Narrowed as a type rather than handled as a dead `case`, so the compiler enforces the exclusion at
 * both ends: this function cannot silently grow a path for them, and `dispatch` cannot stop
 * short-circuiting them without failing to typecheck.
 */
export type DispatchedToolName = Exclude<ToolName, "zcash_reference" | "calculate">;
