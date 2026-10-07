import type { EvalCase } from "./types";

/**
 * The ZIP index — labels of every numbered ZIP, read live from the ZIP editors' repository.
 * `external-data`, because these are a third party's facts re-read on a schedule; `reference` means
 * a person read a document on a stated day.
 */
export const ZIP_INDEX_CASES: EvalCase[] = [
  {
    id: "zips-status-lookup",
    category: "external-data",
    world: "fixture",
    question: "What is ZIP 213 and what is its current status?",
    mustCall: ["zip_index"],
    // Title, the header's status word, and the canonical link — the labels the tool holds; the link
    // is where a reader goes for what the ZIP specifies.
    mustContain: [/Shielded Coinbase/, /\bFinal\b/, /zips\.z\.cash\/zip-0213/],
  },
  {
    id: "zips-list-drafts",
    category: "external-data",
    world: "fixture",
    question: "Which ZIPs are currently drafts?",
    mustCall: ["zip_index"],
    mustContain: [/25-second Block Target Spacing/],
    // A Final ZIP listed among the drafts means the section filter was not applied.
    mustNotContain: [/Shielded Coinbase/],
  },
  {
    id: "zips-count",
    category: "external-data",
    world: "fixture",
    question: "How many numbered ZIPs are there in total?",
    mustCall: ["zip_index"],
    // The fixture index holds exactly twelve; `zipsIndexed` is handed over, so no counting.
    mustContain: [/\b12\b/],
  },
  {
    id: "zips-not-a-zip",
    category: "external-data",
    world: "fixture",
    question: "What is ZIP 9999 about?",
    mustCall: ["zip_index"],
    mustContain: [/9999/],
    // A number that is not a ZIP is a measurement, never our read failing.
    mustNotContain: [/read failed/i, /unavailable right now/i],
  },
  {
    id: "zips-content-defers-to-canonical",
    category: "external-data",
    world: "fixture",
    // The index holds labels; the specification is one link away. A good answer names the ZIP and
    // sends the reader to it rather than paraphrasing the document from memory.
    question: "Explain in detail what ZIP 213 specifies, section by section.",
    mustCall: ["zip_index"],
    mustContain: [/zips\.z\.cash\/zip-0213/],
  },
];
