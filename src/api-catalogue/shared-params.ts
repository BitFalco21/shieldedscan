import type { ApiParam } from "./types";

/**
 * Ranking and field selection, shared by every analytics answer that carries a list of periods
 * (or of cross-chain groups). Short on purpose: each copy is read by every assistant that loads
 * the tools, and the rules are written once, in the "ranking" convention.
 */
export const RANKING_PARAMS: ApiParam[] = [
  {
    name: "sort",
    kind: "query",
    type: "field path",
    required: false,
    description:
      "Rank the periods by this numeric field; a wrong path is a 400 listing the valid ones.",
  },
  {
    name: "order",
    kind: "query",
    type: "desc | asc",
    required: false,
    description: "Default desc. Needs sort.",
  },
  {
    name: "top",
    kind: "query",
    type: "1\u2013100",
    required: false,
    description: "Keep the first N ranked periods. Needs sort.",
  },
  {
    name: "fields",
    kind: "query",
    type: "comma-separated field paths",
    required: false,
    description: "Keep only these fields in each period.",
  },
];

/** The narrowing the transfer list and its ranking share: one text, so the two cannot drift. */
export const TRANSFER_FILTER_PARAMS: ApiParam[] = [
  {
    name: "protocol",
    kind: "query",
    type: "maya | thorchain | near-intents",
    required: false,
    description: "One protocol only.",
  },
  {
    name: "direction",
    kind: "query",
    type: "in | out",
    required: false,
    description: "Relative to Zcash: `in` is to Zcash.",
  },
  {
    name: "chain",
    kind: "query",
    type: "ticker",
    required: false,
    description:
      'One counterpart chain, e.g. BTC, matched at whichever end is not Zcash: "to or from that chain". Combine with `direction` for one side.',
  },
  {
    name: "from",
    kind: "query",
    type: "YYYY-MM-DD",
    required: false,
    description: "First UTC day, inclusive.",
  },
  {
    name: "to",
    kind: "query",
    type: "YYYY-MM-DD",
    required: false,
    description:
      "UTC day the window ends before (exclusive): the whole of July is from=2026-07-01&to=2026-08-01.",
  },
  {
    name: "min",
    kind: "query",
    type: "number",
    required: false,
    description:
      "Only transfers worth at least this many USD at swap time; one whose protocol published no price is excluded, not assumed to clear it.",
  },
  {
    name: "minZec",
    kind: "query",
    type: "number",
    required: false,
    description:
      "Only transfers moving at least this many ZEC (a decimal). Every row carries its exact ZEC amount, so none is excluded.",
  },
];
