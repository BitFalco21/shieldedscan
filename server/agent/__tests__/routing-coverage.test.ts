import { describe, expect, it } from "vitest";
import { AgentTools, TOOL_NAMES, type ToolName } from "../tools";
import { ALL_CASES } from "../evals/cases";
import { makeChain, makeV1, FIXTURE_NOW_MS, TXID } from "../testing/fixture-world";

/**
 * Routing coverage. The failure class: a figure is already in a payload the agent can reach, but
 * the tool's description lacks the word a visitor would use for it, so the question routes nowhere
 * and is answered from model memory. (Example: a halving payload carrying `minerZat` /
 * `fundingStreamsZat` / `lockboxZat` under a description mentioning only "the block subsidy".)
 *
 * The check is derived rather than enumerated, in two halves:
 *
 *  - Reachability. Every tool needs at least one corpus case that must call it, so a tool cannot
 *    ship with no question pointing at it.
 *  - Vocabulary. Every quantity a payload actually carries must be named in the description of the
 *    tool that returns it. Quantities are read off real dispatched payloads, not a hand-kept
 *    manifest, so adding a field fails this test until the description gains the word for it.
 *
 * Graded mechanically, with no model in the loop: routing is a recorded fact.
 */

function tools() {
  return new AgentTools(makeV1(), makeChain(), () => FIXTURE_NOW_MS);
}

/** Every `enum` array anywhere in a tool's JSON schema, including inside `items`. */
function enumValuesOf(schema: unknown): string[] {
  if (Array.isArray(schema)) return schema.flatMap(enumValuesOf);
  if (typeof schema !== "object" || schema === null) return [];
  const out: string[] = [];
  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    if (key === "enum" && Array.isArray(value)) {
      out.push(...value.filter((v): v is string => typeof v === "string"));
    } else {
      out.push(...enumValuesOf(value));
    }
  }
  return out;
}

function definitions() {
  return tools().defs();
}

/** tool → its discriminator values, derived from the schema the model is actually shown. */
function discriminators(): Map<ToolName, string[]> {
  const map = new Map<ToolName, string[]>();
  for (const def of definitions()) {
    const values = [...new Set(enumValuesOf(def.function.parameters))];
    if (values.length > 0) map.set(def.function.name as ToolName, values);
  }
  return map;
}

describe("every tool is reachable from the corpus", () => {
  it("names every tool in some case's mustCall", () => {
    const called = new Set(ALL_CASES.flatMap((c) => c.mustCall ?? []));
    // `zcash_reference` and `site_guide` answer from committed constants, but a question still has
    // to route to them, so they are not exempt.
    const unreached = TOOL_NAMES.filter((name) => !called.has(name));
    expect(unreached, `no corpus case requires: ${unreached.join(", ")}`).toEqual([]);
  });

  /**
   * Per-value behavioural coverage is deliberately not asserted. Checking that a case routes to
   * `chain_status` 'halving' specifically would need the eval runner to record tool arguments; it
   * records only names. Matching each value's words against question text needs a long excuse list
   * for values no natural question spells ("chain", "none", a sort order), so it would read as
   * coverage while asserting little.
   *
   * Instead every tool must appear in some case's `mustCall` (above), and every discriminator value
   * must be exercised by the dispatch table below, so a new facet cannot ship without a question
   * pointing at its tool and a call checking its payload.
   */
});

// --------------------------------------------------------------- the vocabulary half

/**
 * One representative dispatch per discriminator value, so the check reads real payload keys.
 * Hand-written, then checked against the derived enum set below so a new facet cannot be left out.
 */
const CALLS: { tool: ToolName; args: Record<string, unknown> }[] = [
  { tool: "lookup_transaction", args: { txid: TXID } },
  // `heightOrHash`, not `id`: a wrong argument name returns an invalid-arguments message with no
  // payload, which `payloadsOf`'s caller reports as unreadable.
  { tool: "lookup_block", args: { heightOrHash: "3428150", withTransactions: true } },
  { tool: "lookup_address", args: { address: "t1KrG29yWzoi7Bs2pvsgXozZYPvGG4D3sGi" } },
  // The period drill-down, whose payload carries quantities the lifetime summary does not: a
  // windowed transaction count, received and sent totals, and the lifetime denominator that keeps
  // the windowed count from reading as the whole.
  {
    tool: "lookup_address",
    args: {
      address: "t1KrG29yWzoi7Bs2pvsgXozZYPvGG4D3sGi",
      from: "2026-07-01",
      to: "2026-08-01",
    },
  },
  {
    tool: "lookup_address",
    args: { address: "t1KrG29yWzoi7Bs2pvsgXozZYPvGG4D3sGi", withValueExtremes: true },
  },
  { tool: "chain_status", args: { include: ["chain"] } },
  { tool: "chain_status", args: { include: ["supply"] } },
  { tool: "chain_status", args: { include: ["status"] } },
  { tool: "chain_status", args: { include: ["halving"] } },
  { tool: "chain_status", args: { include: ["fees"] } },
  { tool: "chain_status", args: { include: ["reorgs"] } },
  { tool: "chain_status", args: { include: ["market"] } },
  { tool: "chain_status", args: { include: ["tx-counts"] } },
  { tool: "explorer_analytics", args: { series: "monthly" } },
  { tool: "explorer_analytics", args: { series: "crosschain-flows" } },
  { tool: "explorer_analytics", args: { series: "mempool" } },
  { tool: "explorer_insights", args: { topic: "ironwood-inflow" } },
  { tool: "explorer_insights", args: { topic: "shielding-flow" } },
  { tool: "explorer_insights", args: { topic: "transaction-costs" } },
  { tool: "explorer_insights", args: { topic: "crosschain-volume" } },
  { tool: "explorer_insights", args: { topic: "holder-distribution" } },
  { tool: "zec_price_history", args: { days: 7 } },
  { tool: "wrapped_zec_pools", args: {} },
  { tool: "zip_index", args: {} },
  { tool: "zip_index", args: { zip: [213] } },
  { tool: "zip_index", args: { section: "in-force" } },
  { tool: "zip_index", args: { section: "proposed" } },
  { tool: "zip_index", args: { section: "draft" } },
  { tool: "zip_index", args: { section: "retired", query: "sapling" } },
  { tool: "crosschain", args: { mode: "aggregate", groupBy: "chain" } },
  { tool: "crosschain", args: { mode: "transfers", sort: "largest", sortBy: "zec" } },
  { tool: "crosschain", args: { mode: "destinations" } },
  { tool: "chain_activity", args: { mode: "window", from: "2026-07-01", to: "2026-08-01" } },
  { tool: "chain_activity", args: { mode: "miners", from: "2026-07-01", to: "2026-08-01" } },
  { tool: "chain_status", args: { include: ["records"] } },
  { tool: "chain_status", args: { include: ["mining"] } },
  { tool: "chain_status", args: { include: ["nodes"] } },
  { tool: "chain_activity", args: { mode: "pools", from: "2026-07-01", to: "2026-08-01" } },
  {
    tool: "chain_activity",
    args: { mode: "pools", from: "2026-07-01", to: "2026-08-01", groupBy: "day", pool: "orchard" },
  },
  {
    tool: "chain_activity",
    args: { mode: "pool-balances", from: "2026-01-01", to: "2026-08-01", groupBy: "month" },
  },
  {
    tool: "chain_activity",
    args: { mode: "transparent", from: "2026-07-01", to: "2026-08-01", groupBy: "day" },
  },
  {
    tool: "chain_activity",
    args: {
      mode: "transparent",
      from: "2026-07-01",
      to: "2026-08-01",
      groupBy: "day",
      sort: "active-addresses",
      top: 3,
    },
  },
  // A ranked window, because it emits `ranking` — with the tie count and the two denominators an
  // honest superlative needs. One call is enough: the measure chooses the order, not the columns,
  // so the other measures are shape-only below.
  {
    tool: "chain_activity",
    args: {
      mode: "window",
      from: "2026-07-01",
      to: "2026-08-01",
      groupBy: "day",
      sort: "transactions",
    },
  },
  // A migration-filtered grouped window, because each bucket then carries its own `migrations`
  // cells — the per-day split of the pool-to-pool matrix.
  {
    tool: "chain_activity",
    args: {
      mode: "window",
      from: "2026-07-01",
      to: "2026-08-01",
      groupBy: "day",
      migrationFrom: "orchard",
      migrationTo: "ironwood",
    },
  },
  { tool: "chain_activity", args: { mode: "recent-blocks" } },
  { tool: "chain_activity", args: { mode: "recent-transactions" } },
  { tool: "zcash_reference", args: { topic: "economics" } },
  { tool: "zcash_reference", args: { topic: "addresses" } },
  { tool: "zcash_reference", args: { topic: "privacy" } },
  { tool: "zcash_reference", args: { topic: "consensus" } },
  { tool: "site_guide", args: { section: "api" } },
];

/**
 * A key names a quantity when it carries one of this repo's quantity suffixes. Restricting to the
 * suffixes keeps the check from drowning in structural keys (`asOf`, `nextCursor`, `basis`,
 * `items`); the suffixes are conventions enforced everywhere (`…Zat` gets a `…Zec` sibling, a
 * percentage travels as a share), so a new quantity almost always arrives wearing one.
 */
// `Text` is included because payloads deliberately hand the model pre-formatted figures (`usdText`,
// `usdAtSwapText`, `changePctText`) so a caveat like "≥" cannot be paraphrased away. They are
// quantities for routing purposes, and without the suffix the most carefully formatted figures
// would be invisible to this check.
const QUANTITY_SUFFIX = /(?:Zat|Zec|Usd|Pct|Share|Count|Text)$/;

/**
 * Heads that carry no routing information, so requiring them would assert nothing: `totalZat`
 * appears in almost every payload, and no visitor's question is distinguished by the word "total".
 */
const GENERIC_HEADS = new Set([
  "total",
  "totals",
  "value",
  "values",
  "amount",
  "net",
  "gross",
  "sum",
  "avg",
  "average",
  "mean",
  "min",
  "max",
  "median",
  "current",
  "next",
  "previous",
  "sampled",
  "covered",
  "numerator",
  "denominator",
  "pct",
  "share",
  "count",
  "days",
  "window",
  "trailing",
  "first",
  "last",
  "this",
  "all",
  "in",
  "out",
  "p25",
  "p75",
  "q1",
  "q3",
  "paid",
  "change",
]);

/**
 * `fundingStreamsZat` → ["funding", "streams"]; `minerShare` → ["miner"]. Tokens carrying a digit
 * are dropped: `priceChange24hPct` splits to "change24h" and `last7Days` to "last7", words no
 * description or visitor would use.
 */
function headWords(key: string): string[] {
  const stem = key.replace(QUANTITY_SUFFIX, "");
  return stem
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !/\d/.test(w) && !GENERIC_HEADS.has(w));
}

function quantityKeys(value: unknown, depth = 0, into = new Set<string>()): Set<string> {
  if (depth > 6) return into;
  if (Array.isArray(value)) {
    // One element is enough: array members share a shape, and walking a 90-point series would only
    // add time.
    if (value.length > 0) quantityKeys(value[0], depth + 1, into);
    return into;
  }
  if (typeof value !== "object" || value === null) return into;
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (QUANTITY_SUFFIX.test(key)) into.add(key);
    quantityKeys(raw, depth + 1, into);
  }
  return into;
}

/** Tools whose result is prose, so carrying no JSON body is correct rather than a failure. */
const PROSE_ONLY = new Set<ToolName>(["zcash_reference", "site_guide", "calculate"]);

/**
 * Every JSON body in a tool result, not the widest brace span. A tool that dispatches more than one
 * call emits one `<data>` envelope per call, so slicing from the first `{` to the last `}` spans
 * two documents and fails to parse — and a silently skipped entry asserts nothing.
 *
 * Balanced-brace scanning with a per-span parse attempt. Prose legitimately contains braces
 * (`/v1`'s conventions describe a percentage as `{pct, numerator, denominator}`); those spans fail
 * to parse and are dropped. Because of that tolerance the caller also asserts that a non-prose call
 * yielded at least one payload.
 */
function payloadsOf(content: string): unknown[] {
  const out: unknown[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < content.length; i += 1) {
    const ch = content[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        try {
          out.push(JSON.parse(content.slice(start, i + 1)));
        } catch {
          // Prose that merely looks like an object. Dropped, never counted.
        }
        start = -1;
      }
      if (depth < 0) depth = 0;
    }
  }
  return out;
}

describe("a tool description names the quantities its payload carries", () => {
  it("covers every discriminator value in the dispatch table", () => {
    const inTable = new Set<string>();
    for (const call of CALLS) {
      for (const arg of Object.values(call.args)) {
        for (const v of Array.isArray(arg) ? arg : [arg]) {
          if (typeof v === "string") inTable.add(`${call.tool}:${v}`);
        }
      }
    }
    const missing: string[] = [];
    for (const [tool, values] of discriminators()) {
      for (const value of values) {
        if (!inTable.has(`${tool}:${value}`)) missing.push(`${tool}:${value}`);
      }
    }
    // Values that select a shape or narrow a set rather than naming a different subject: a sort
    // order, a grouping granularity, a venue, a direction, a transaction kind. Each returns the
    // same payload keys as the call already in the table, so a separate dispatch would assert
    // identical quantities.
    //
    // This is the one hand-kept list here, and its default is safe: a value not listed fails the
    // test, so a new facet or topic cannot be quietly skipped. Adding to it claims the value
    // changes which rows come back, not which columns.
    const shapeOnly = new Set([
      // crosschain: groupBy, sort order, sortBy, direction and venue filters
      "crosschain:venue",
      "crosschain:month",
      "crosschain:day",
      "crosschain:none",
      "crosschain:usd",
      "crosschain:recent",
      "crosschain:newest",
      // The other end of the ranking the `largest` row already exercises: same endpoint and keys,
      // only the ORDER BY direction differs.
      "crosschain:smallest",
      "crosschain:inbound",
      "crosschain:outbound",
      "crosschain:in",
      "crosschain:out",
      "crosschain:maya",
      "crosschain:thorchain",
      "crosschain:near-intents",
      // chain_activity: groupBy granularity and the privacy-kind filter
      "chain_activity:day",
      "chain_activity:month",
      "chain_activity:none",
      "chain_activity:all",
      "chain_activity:transparent",
      "chain_activity:shielded",
      "chain_activity:mixed",
      // Sub-cases of `mixed`, narrowed by which way value crossed the shielded boundary: same list,
      // no key `mixed` lacks.
      "chain_activity:shielding",
      "chain_activity:unshielding",
      "chain_activity:coinbase",
      // The migration pair filter's other pools. The orchard→ironwood call above already exercises
      // the filtered payload's shape, and a different pool changes which rows match, never which
      // keys come back. (`orchard` and `ironwood` are absent because that call carries them.)
      "chain_activity:sprout",
      "chain_activity:sapling",
      "chain_activity:multi",
      // The ranking measures. Each selects which bucket sorts first, never which keys come back;
      // the ranked call above already checks every quantity `ranking` carries. The ZEC measures are
      // named distinctly from the transaction kinds, since the schema walk cannot tell which enum a
      // value came from.
      "chain_activity:zec-shielded",
      "chain_activity:zec-unshielded",
      "chain_activity:shielded-transactions",
      "chain_activity:shielding-transactions",
      "chain_activity:unshielding-transactions",
      "chain_activity:fees",
      "chain_activity:blocks",
      "chain_activity:block-size",
      "chain_activity:difficulty",
      // The 'transparent' ranking measures other than the one dispatched above: each picks which
      // period sorts first, never which keys come back.
      "chain_activity:transparent-output-value",
      "chain_activity:transparent-input-value",
      // `sort: "transactions"` is dispatched above; the bare value is listed because the schema
      // walk cannot tell which enum a value came from. Order direction is likewise a sort flag, not
      // a subject.
      "chain_activity:transactions",
      "chain_activity:highest",
      "chain_activity:lowest",
      // These two emit prose, not JSON, so there are no payload keys to check; their descriptions
      // are pinned by reference.test.ts and site-guide.test.ts.
      "zcash_reference:ceremonies",
      "zcash_reference:cryptography",
      "zcash_reference:history",
      "zcash_reference:governance",
      // Prose, no payload keys. Its description is pinned by reference.test.ts, which requires the
      // words a visitor would use (NU7, the vote, Tachyon), because this gate cannot see a routing
      // gap in a payload with no quantities.
      "zcash_reference:roadmap",
      "site_guide:api-endpoint",
      "site_guide:pages",
      // 'coverage' is prose about quantities no payload carries, so there is nothing for this check
      // to read. Its gate is `coverage.test.ts`: every neighbour it redirects to must be a call
      // that exists.
      "site_guide:coverage",
      // 'privacy' is prose — the privacy policy's claims, with no quantities. Its gate is
      // `site-guide.test.ts`, which asserts every claim `/privacy` renders appears here verbatim
      // and that the two deliberate absences (a retention figure, a named supervisory authority)
      // appear in neither.
      "site_guide:privacy",
      // 'labels' is the label table as prose. Its quantities (balances, ranks, the rank height) are
      // written into the prose, not passed as a payload. Its gate is `site-guide.test.ts`, which
      // derives from `ADDRESS_LABELS` so every printed name appears with every address it covers,
      // and checks each address's printed balance and rank against the payload.
      "site_guide:labels",
    ]);
    const unexcused = missing.filter((m) => !shapeOnly.has(m));
    expect(
      unexcused,
      `the dispatch table does not exercise: ${unexcused.join(", ")} — add a call, so its ` +
        `payload's quantities are checked against the description`,
    ).toEqual([]);
  });

  /**
   * The core assertion: a payload that gains `minerZat` / `fundingStreamsZat` / `lockboxZat` under
   * a description lacking "miner", "funding stream" and "lockbox" fails here, before a visitor
   * finds the gap.
   */
  it("has a word for every quantity in every payload", async () => {
    const t = tools();
    const defs = new Map(definitions().map((d) => [d.function.name, d.function.description]));
    const gaps: string[] = [];

    for (const call of CALLS) {
      const result = await t.dispatch(call.tool, JSON.stringify(call.args));
      const payloads = payloadsOf(result.content);
      if (payloads.length === 0) {
        // Prose tools legitimately carry no JSON. Anything else reaching here is a call whose
        // payload could not be read, which must fail rather than be skipped.
        if (!PROSE_ONLY.has(call.tool)) {
          gaps.push(`${call.tool} returned no readable payload, so nothing was checked`);
        }
        continue;
      }

      const description = (defs.get(call.tool) ?? "").toLowerCase();
      for (const payload of payloads) {
        for (const key of quantityKeys(payload)) {
          for (const word of headWords(key)) {
            // Crude singular/plural tolerance: "streams" in a key, "stream" in the prose.
            const singular = word.replace(/s$/, "");
            if (!description.includes(word) && !description.includes(singular)) {
              gaps.push(`${call.tool} returns ${key} but its description never says "${word}"`);
            }
          }
        }
      }
    }

    expect([...new Set(gaps)].sort()).toEqual([]);
  });
});
