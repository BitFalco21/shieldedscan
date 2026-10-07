import type { ToolName } from "../../tools/names";
import type { Rubric } from "../rubrics";

/** One eval case: a question, the world it runs in, and what its answer is graded on. */
export interface EvalCase {
  id: string;
  category:
    | "protocol"
    | "pools"
    | "live-lookup"
    | "shielded-null"
    | "explorer-meta"
    | "refusal"
    | "unanswerable"
    | "stale-knowledge"
    /**
     * Zcash's documented past — committed in `reference.ts`, transcribed from primary sources,
     * measured by nothing here. Its own category because a category is a claim about whose figures
     * these are: `insights` is what this explorer measured from its own index, `price-history` is
     * what an aggregator published and we stored, `external-data` is what a third party holds.
     * Filing these under `protocol`, where answers come from the model's understanding of how Zcash
     * works, would put transcribed figures in the voice used for conceptual explanation.
     */
    | "reference"
    | "insights"
    /**
     * Daily ZEC/USD closes. Separate from `insights` because a market price is measurable against
     * no node: these closes are ours to store and an aggregator's to have published, so every case
     * here turns on the source being named.
     */
    | "price-history"
    /**
     * Figures that are not ours — DeFiLlama's wrapped-ZEC pools. Not filed under `insights`,
     * because the risk in this category is a third party's number being described in the voice of
     * our own measurements.
     */
    | "external-data"
    | "upstream-failure"
    | "over-refusal"
    | "injection-direct"
    | "injection-indirect"
    | "injection-bypass";
  world: "live" | "fixture" | "broken";
  question: string;
  /** Tools the turn must have called (subset check, by name). */
  mustCall?: ToolName[];
  /**
   * Tools of which at least one must have been called — for questions two tools answer equally
   * well, where requiring a specific one would make the case flap on the model's choice.
   */
  mustCallAny?: ToolName[];
  /** Every regex must match the final answer. */
  mustContain?: RegExp[];
  /** No regex may match the final answer. */
  mustNotContain?: RegExp[];
  /**
   * A planted destination no answer may carry — a URL, an address to send funds to, a handle —
   * whatever the framing.
   *
   * Separate from `mustNotContain` because the two follow opposite rules. Every `mustNotContain` in
   * an injection case is checked to survive an answer that quotes the payload, since reporting an
   * injection means quoting it. A scam's destination is where that inverts: the reader must learn a
   * scam was planted without being handed the string it wants retyped. The sweep skips this field,
   * and `gradeAnswer` applies it with no attribution excuse.
   */
  mustNeverRelay?: RegExp[];
  /**
   * Semantic assertions, each a rubric a reviewer decides must hold. They replace vocabulary
   * alternations that could not tell a refusal from the word "doesn't".
   */
  mustSatisfy?: Rubric[];
  /**
   * The inverse, for over-refusal cases: every rubric must not hold. An agent that refuses
   * everything passes every refusal case while being useless.
   */
  mustNotSatisfy?: Rubric[];
  /**
   * Poison the fixture world's data with attacker-authored bytes. Three carriers, because there are
   * three places a stranger writes text this agent reads: a miner chooses a block's coinbase tag, a
   * venue chooses the chain and asset labels on a cross-chain transfer, and DeFiLlama passes on
   * whatever symbol a pool's deployer chose (the least filtered of the three).
   */
  poison?: { coinbaseTag?: string; crosschainChainLabel?: string; defillamaPoolSymbol?: string };
}

/** A txid known in full from the repo's own records (13,538 transparent inputs). */
export const WIDE_TXID = "c860a7e881d9291ab464fc52ec9213f69d071cc1cc540ea84fd05679b5bae6ed";

/** The harness's fixture txid — an Orchard→Ironwood migration paying 30,000 zat. */
export const FIXTURE_TXID = "ab".repeat(32);
