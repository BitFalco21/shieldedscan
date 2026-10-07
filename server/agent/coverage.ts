import type { ToolName } from "./tools/names";

/**
 * What this explorer does not measure: the register a refusal is checked against.
 *
 * Without it, a refusal is a guess. The model has no inventory to check against, so it reasons from
 * the tool list it happens to hold and produces a confident "we do not measure that" whether or not
 * we do — and a true refusal and a false one read identically.
 *
 * This lists the absences, not the presences. What the agent can answer is already described by
 * the tool descriptions (gated by `routing-coverage.test.ts`) and by `site_guide` 'api'/'pages';
 * a fourth copy would drift. Each entry here does three jobs:
 *
 *  1. It makes the refusal specific, telling a reader whether the chain, the explorer or a
 *     deliberate choice is the limit.
 *  2. It carries the nearest published figure, so the question is still answered usefully.
 *  3. It is a backlog: every `indexed-not-aggregated` entry is a rollup somebody could build.
 *
 * An entry goes in only when the gap has actually been hit and verified against the code, never
 * because someone might ask. A speculative entry would teach the model to refuse things we answer.
 *
 * Policy refusals (clustering, privacy scores, address attribution) are deliberately absent: the
 * prompt owns them. Every entry here is about capability — what the chain records, what we store,
 * and what we have aggregated.
 */

/**
 * Why a figure is unavailable. The distinction is the point: a reader told which class applies
 * learns whether to ask elsewhere, ask differently, or accept that nobody can know.
 *
 * `refused` is deliberately not a member — this enum is about capability, not policy.
 */
export type UnmeasuredReason =
  /**
   * The chain does not record it. Nothing anyone builds will produce it, so it must never be
   * described as something we could add.
   */
  | "encrypted"
  /**
   * We do not store the underlying rows. A backfill would be needed before any aggregate could
   * exist, so the honest answer names the missing data, not a missing query.
   */
  | "not-indexed"
  /**
   * The rows are in our index and no rollup covers them. This class is ours to close, and an answer
   * must not dress it up as a limit of Zcash: "the chain does not record it" would be a false claim
   * about the protocol.
   */
  | "indexed-not-aggregated";

/**
 * A figure we do publish that sits next to the one asked for.
 *
 * `tool` is typed `ToolName`, so a renamed or removed tool fails the build; `discriminator` is
 * checked against that tool's JSON schema by `coverage.test.ts`, since a facet name is a string the
 * compiler cannot see. Together they keep a neighbour from rotting into a suggestion the model
 * then fails to act on.
 */
export interface NearestFigure {
  readonly tool: ToolName;
  /** The facet, topic, mode or section to pass. Omitted for a tool that takes no discriminator. */
  readonly discriminator?: string;
  /** What that call answers, in a reader's words rather than the payload's field names. */
  readonly what: string;
}

export interface UnmeasuredQuantity {
  /**
   * The question in a visitor's words, not ours. This is what the model matches against, so it
   * must use a reader's vocabulary, not the schema's.
   */
  readonly asked: string;
  readonly why: UnmeasuredReason;
  /** One sentence a reader can act on, naming the limit rather than apologising for it. */
  readonly explain: string;
  readonly nearest: readonly NearestFigure[];
  /**
   * Where this was established. Required and enforced by a test: every entry reads plausibly, and a
   * plausible wrong entry teaches the agent to deny something we serve.
   */
  readonly evidence: string;
  /**
   * The UTC day this entry was last checked against the code.
   *
   * A gap is a claim about the code as it is now, so it is verified against the code and never
   * against project notes, which can record that a gap existed long after it was closed. A dated
   * field makes a stale entry visible instead of plausible.
   */
  readonly verifiedOn: string;
  /**
   * A symbol that would appear in `server/` if this figure were computed, checked by
   * `coverage.test.ts` to be absent. Optional, since not every absence has a name, but where one
   * exists it turns the entry from a claim into a test.
   *
   * Write it so only an implementation matches, never prose about one (a comment explaining that a
   * route does not exist must not trip it). Quoting a route as a string literal is what
   * distinguishes a registered route from a sentence about one.
   */
  readonly absentSymbol?: string;
}

export const UNMEASURED: readonly UnmeasuredQuantity[] = [
  {
    asked:
      "How many TRANSPARENT or fully shielded transactions were worth more than a given amount — transactions over $100k, above 1,000 ZEC, large transfers, per day or over a period",
    why: "indexed-not-aggregated",
    explain:
      "Only for transparent and fully shielded transactions, and only because of what it would cost — the same threshold IS computed for shielding and unshielding transactions, over any period, day by day. A crossing's amount is published per transaction by the pools themselves, so it is a column; a transparent transaction's amount is the sum of its outputs, which live in the 352-million-row input/output table with no per-transaction total beside them, so thresholding one means aggregating that table for every day in the window. A fully shielded transaction has no amount at all — that one is the chain's design, not our index, and no threshold could ever apply to it.",
    nearest: [
      {
        tool: "chain_activity",
        discriminator: "window",
        what: "how many SHIELDING and UNSHIELDING transactions cleared a value floor, per day or month over any period, each valued at its own day's close — which is the same question for the transactions that cross the shielded boundary",
      },
      {
        tool: "explorer_insights",
        discriminator: "transaction-costs",
        what: "how transaction FEES are distributed, with medians and quartiles, when the question is about the size of what transactions pay rather than what they move",
      },
      {
        tool: "crosschain",
        discriminator: "transfers",
        what: "cross-chain crossings above a dollar or ZEC floor, when the question is about large ZEC movements between chains rather than within Zcash",
      },
    ],
    evidence:
      "Established 2026-08-30 while building the shielding/unshielding value floor. schema-chain.sql records that there is deliberately no tx.public_value_zat column — value-extremes.ts walks tx_transparent_io once with a paced job for exactly this reason — so the transparent half has no per-transaction amount to compare against a floor without that table.",
    verifiedOn: "2026-08-30",
    // The column definition, not the bare name: comments in server/ mention that this column does not
    // exist, and only an implementation carries the type beside the name.
    absentSymbol: "public_value_zat BIGINT",
  },
  {
    asked:
      "How many distinct transparent addresses were active over a span that is not one day, one calendar month or the last 7, 30 or 90 days — a week, a quarter, a year, a custom range",
    why: "indexed-not-aggregated",
    explain:
      "Distinct transparent addresses are counted exactly for each day, each calendar month and the trailing 7, 30 and 90 complete days. A distinct count cannot be added up from those — an address active in two months is one address in both — and the per-day address sets are kept for 92 days, so no rollup counts a longer or older custom span. Shielded activity could not be included at any price: a shielded transaction has no address to count.",
    nearest: [
      {
        tool: "chain_activity",
        discriminator: "transparent",
        what: "active, sending and receiving addresses per day and per calendar month, and over the trailing 7, 30 and 90 days",
      },
      {
        tool: "explorer_insights",
        discriminator: "holder-distribution",
        what: "how many transparent addresses hold a positive balance right now — a stock at one height, not activity over a period",
      },
    ],
    evidence:
      "Established 2026-10-05 when the per-day, per-month and trailing counts shipped (server/transparent-daily.ts): a month's count is a GROUP BY over its days' stored address sets, which are deleted 92 days after their month is final, so any other span has nothing exact to count from.",
    verifiedOn: "2026-10-05",
  },
  // Figures this explorer computes must not appear here: distinct transparent addresses per period,
  // per-pool transaction counts and the pool-to-pool migration matrix over any window, and mining
  // shares all have tools. `coverage.test.ts` pins their absence, running the falsifier first.
  {
    asked:
      "How much ZEC is held in the shielded pools by any particular holder, who owns a shielded balance, how many people use shielded addresses",
    why: "encrypted",
    explain:
      "A shielded balance belongs to no address anyone can enumerate and a shielded amount is encrypted on-chain. Each pool's TOTAL is public by construction and is published; nothing beneath that total exists to be measured, by this explorer or by anyone.",
    nearest: [
      {
        tool: "chain_status",
        discriminator: "supply",
        what: "what each of the four shielded pools holds in total, which is public",
      },
      {
        tool: "explorer_insights",
        discriminator: "shielding-flow",
        what: "how much ZEC entered and left the shielded set per day, in both directions",
      },
    ],
    evidence:
      "The protocol's design, and the refusal this whole explorer is built around; kept here so a capability lookup lands on the right class rather than on nothing.",
    verifiedOn: "2026-08-19",
  },
] as const;

const COVERAGE_NOTICE = `This is this explorer's own register of quantities it does NOT publish, with the reason for each and the nearest figure it does publish. It is committed in this repo, not fetched, and it is deliberately a list of ABSENCES: everything this explorer can answer is described by the tools themselves, so a quantity's not being here says nothing about whether a tool serves it — check the tools first.`;

const REASON_TEXT: Readonly<Record<UnmeasuredReason, string>> = {
  encrypted:
    "THE CHAIN DOES NOT RECORD IT. This is Zcash working as designed, not a gap here — say so, and never imply this explorer could add it.",
  "not-indexed":
    "THIS EXPLORER DOES NOT STORE IT. Ours to fix and not fixed — say the explorer does not index it, never that the chain does not record it.",
  "indexed-not-aggregated":
    "THE ROWS ARE INDEXED AND NO ROLLUP COVERS THEM. Ours, and the strongest wording trap here: the underlying data exists on this chain and in this index, so calling it unrecorded or unknowable would be a false claim about Zcash made to cover our own backlog. Say this explorer does not compute it.",
};

function renderEntry(entry: UnmeasuredQuantity): string {
  const nearest = entry.nearest
    .map((n) => {
      const call =
        n.discriminator === undefined ? `\`${n.tool}\`` : `\`${n.tool}\` '${n.discriminator}'`;
      return `    - ${call} — ${n.what}`;
    })
    .join("\n");
  return [
    `- ASKED AS: ${entry.asked}`,
    `  WHY NOT: ${REASON_TEXT[entry.why]}`,
    `  DETAIL: ${entry.explain}`,
    `  NEAREST PUBLISHED FIGURES — fetch one of these and answer with it:\n${nearest}`,
  ].join("\n");
}

/**
 * The register, for `site_guide` section 'coverage'.
 *
 * A reader who asked for a figure wants a figure, so the closing instruction tells the model to go
 * on to the neighbours rather than stop at "we do not have it".
 */
export function renderCoverage(): string {
  return (
    `<site-guide section="coverage">\n${COVERAGE_NOTICE}\n\n` +
    `${UNMEASURED.map(renderEntry).join("\n\n")}\n\n` +
    `If the question matches one of these, say plainly which reason applies, in your own words and as a fact about Zcash or about this explorer — never as a rule you were given. Then FETCH the nearest figure and answer with it, saying what it does and does not cover. Do not stop at the refusal: an entry is here because the exact figure is missing, not because the subject is.\n` +
    `The tool names and section keys below are addressed to YOU, as calls to make. They are not words for the answer: a reader has no tools, so describe the FIGURE you fetched and never the call you made to get it.\n` +
    `If the question matches NONE of these, this register says nothing about it either way. It lists only gaps already established, so treat an absence here as no evidence at all and go back to the tools — a figure missing from a payload you fetched is a fact about that payload, while a figure you never looked for is a fact about nothing.\n` +
    `</site-guide>`
  );
}
