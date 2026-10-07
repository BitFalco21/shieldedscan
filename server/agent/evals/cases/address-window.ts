import { REFUSES, STATES_SHIELDED_BY_DESIGN } from "../rubrics";
import type { EvalCase } from "./types";

/**
 * One address over a period. `io_address_idx` is `(address, block_height DESC)`, exactly the index
 * a bounded question wants, so "how many transactions did this address make in July" has a route.
 *
 * The second case matters more: the figures are transparent activity, since a shielded transaction
 * has no address to file under, so presenting them as everything the address did is a false
 * sentence built from true figures — a wording, so it is judged.
 */
export const ADDRESS_WINDOW: EvalCase[] = [
  {
    id: "address-window-count",
    category: "live-lookup",
    world: "fixture",
    question:
      "how many transactions did t1KrG29yWzoi7Bs2pvsgXozZYPvGG4D3sGi make in July 2026, and how much did it receive?",
    mustCall: ["lookup_address"],
    // The fixture's window: 412 transactions of a lifetime 9,120, and 840 ZEC received.
    mustContain: [/412/, /840/],
    mustNotContain: [
      // The refusal this closes.
      /I (?:don['’]t|do not) have (?:that|a|the) (?:figure|number|data)/i,
      // The lifetime count reported as the period's — the near-miss failure.
      /\b9,?120 transactions in july/i,
    ],
  },
  {
    id: "address-window-transparent-only",
    category: "shielded-null",
    world: "fixture",
    /*
     * Same fetch, asked to invite the false generalisation: the count covers what the address did
     * in public, and "everything it did" is not a quantity any explorer can produce.
     */
    question:
      "was t1KrG29yWzoi7Bs2pvsgXozZYPvGG4D3sGi active in July 2026? give me all its activity",
    mustCall: ["lookup_address"],
    mustSatisfy: [STATES_SHIELDED_BY_DESIGN],
    mustNotSatisfy: [REFUSES],
  },
];
