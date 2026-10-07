import { SHIELD } from "@/components/PrivacyShield";

/**
 * The empty state's runnable questions, and the short list of what else Zeno can read.
 *
 * A terminal's answer to "what can I type here" is history and completion, not a paragraph. Each
 * example is a real question that exercises one thing worth demonstrating, and clicking it sends
 * it. Each should answer in one or two lookups: an example that spirals into a long turn teaches
 * the wrong thing about the agent.
 *
 * The topic label and icon are decoration hidden from assistive technology, so a tile's
 * accessible name is exactly its question — the string a reader would type, and the one the e2e
 * suite asks for by name.
 */

export interface AgentExample {
  question: string;
  /** A two-to-three-word category, upper case, drawn above the question. */
  topic: string;
  /** A 24-unit outline icon path, drawn in `stroke` like `StepIcon`. */
  icon: string;
}

export const AGENT_EXAMPLES: readonly AgentExample[] = [
  {
    topic: "BLOCKS & TXS",
    question: "what happened in block 3428150?",
    icon: "M12 3 20 7.5v9L12 21 4 16.5v-9zM4 7.5 12 12l8-4.5M12 12v9",
  },
  {
    topic: "SHIELDED POOLS",
    question: "how much ZEC is shielded right now?",
    icon: SHIELD,
  },
  {
    // One lookup; the answer states the floor caveat and keeps both directions apart rather than
    // netted.
    topic: "CROSS-CHAIN",
    question: "which chains move the most ZEC in and out of Zcash?",
    icon: "M5 8h13l-3-3M19 16H6l3 3",
  },
  {
    topic: "PROTOCOL",
    question: "what is Ironwood?",
    icon: "M12 3 21 8l-9 5-9-5zM3 13l9 5 9-5",
  },
  {
    topic: "PRICES",
    question: "what was ZEC worth on each halving day?",
    icon: "M3 20h18M4 16l5-6 4 3 7-8",
  },
  {
    topic: "THIS EXPLORER",
    question: "what are the public API's rate limits?",
    icon: "M9 4C6.5 4 7 7.5 7 9s-1 3-3 3c2 0 3 1.5 3 3s-.5 5 2 5M15 4c2.5 0 2 3.5 2 5s1 3 3 3c-2 0-3 1.5-3 3s.5 5-2 5",
  },
];

/**
 * What else Zeno can read, as plain chips — what it can read, never how it works (so no
 * "calculator": that is machinery, not a subject). Address and holder chips say "transparent"
 * every time: a shielded address has no balance anyone can look up.
 */
export const AGENT_ALSO_READS: readonly string[] = [
  "transparent addresses",
  "ZIPs",
  "the halving schedule",
  "fees",
  "reorgs",
  "wrapped ZEC on other chains",
  "the transparent rich list",
  "daily prices since 2016",
];
