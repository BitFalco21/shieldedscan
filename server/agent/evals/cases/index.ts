import type { EvalCase } from "./types";
import { GOLDEN } from "./golden";
import { INJECTION } from "./injection";
import { AMOUNTS } from "./amounts";
import { DEPTH } from "./depth";
import { INSIGHTS } from "./insights";
import { ANSWER_SHAPE } from "./answer-shape";
import { EXTERNAL_POOLS } from "./external-pools";
import { ZIP_INDEX_CASES } from "./zip-index";
import { PRICE_HISTORY_CASES } from "./price-history";
import { LANGUAGE } from "./language";
import { CROSSCHAIN } from "./crosschain";
import { CROSSCHAIN_THRESHOLD } from "./crosschain-threshold";
import { CHAIN_ACTIVITY } from "./chain-activity";
import { COVERAGE } from "./coverage";
import { WINDOW_RANKING } from "./window-ranking";
import { ADDRESS_WINDOW } from "./address-window";
import { ROADMAP } from "./roadmap";
import { PUBLISHED_SERIES } from "./published-series";

/**
 * The eval corpus. Nothing is logged, so there are no user transcripts to learn from: the corpus is
 * authored deliberately and is the agent's quality process.
 *
 * Worlds a case can run in:
 *  - "live" — tools dispatch against the deployed /v1 (real chain data). Needs EVAL_V1_BASE_URL or
 *    the production default.
 *  - "fixture" — tools dispatch against the in-process fixture world (`testing/fixture-world.ts`:
 *    synthetic data, real routing), optionally poisoned via `poison`.
 *  - "broken" — every call answers 503, on both surfaces, for the upstream-failure cases.
 *
 * Mechanical assertions are regexes over the final answer text plus the recorded tool calls;
 * semantic rubrics go to human review (see grade.ts).
 */
export const ALL_CASES: readonly EvalCase[] = [
  ...GOLDEN,
  ...INJECTION,
  ...AMOUNTS,
  ...DEPTH,
  ...INSIGHTS,
  ...ANSWER_SHAPE,
  ...EXTERNAL_POOLS,
  ...ZIP_INDEX_CASES,
  ...PRICE_HISTORY_CASES,
  ...LANGUAGE,
  ...CROSSCHAIN,
  ...CROSSCHAIN_THRESHOLD,
  ...CHAIN_ACTIVITY,
  ...COVERAGE,
  ...WINDOW_RANKING,
  ...ADDRESS_WINDOW,
  ...ROADMAP,
  ...PUBLISHED_SERIES,
];

export type { EvalCase } from "./types";
export { GOLDEN } from "./golden";
export { INJECTION } from "./injection";
