/**
 * Checks that the judge is fit to be read: every fixture in `review-fixtures.ts` (most of them real
 * agent output), in both directions, at a 100% threshold. Run it before `judge-review.ts` after any
 * model or prompt change; a grader that disagrees with a committed example is not a grader.
 *
 *   node dist/eval-judge-validate.mjs [--only rubricId,rubricId] (NEAR_AI_API_KEY set)
 *
 * `--only` re-runs fixtures a previous pass could not reach: a provider timeout is an error, not a
 * verdict.
 */
import { checkRubric, JUDGE_MODEL, JUDGE_PROVIDER, nearJudgeCaller } from "./judge";
import { ALL_FIXTURES } from "./review-fixtures";

const API_KEY = process.env[JUDGE_PROVIDER.keyEnv];

async function main(): Promise<void> {
  if (!API_KEY) {
    console.error(`${JUDGE_PROVIDER.keyEnv} is required — this runner calls a real model`);
    process.exit(2);
  }
  const judge = nearJudgeCaller(API_KEY);
  const args = process.argv.slice(2);
  const onlyArg = args.includes("--only") ? args[args.indexOf("--only") + 1] : undefined;
  const only = onlyArg ? new Set(onlyArg.split(",")) : null;
  const fixtures = only ? ALL_FIXTURES.filter((f) => only.has(f.rubric.id)) : ALL_FIXTURES;
  console.log(`judge ${JUDGE_MODEL} @ ${JUDGE_PROVIDER.id} · ${fixtures.length} fixtures\n`);
  let wrong = 0;
  let errored = 0;
  for (const fixture of fixtures) {
    const check = await checkRubric(
      fixture.rubric,
      fixture.expect,
      { question: fixture.question, answer: fixture.answer, toolsCalled: [] },
      judge,
      // 180 s: the judge reasons before answering and some fixtures take over 120 s.
      AbortSignal.timeout(180_000),
    );
    if (check.verdict === "error") {
      errored++;
      console.log(`ERROR ${fixture.rubric.id} [${fixture.provenance}] — ${check.reason}`);
    } else if (check.ok) {
      console.log(`OK    ${fixture.rubric.id} [${fixture.provenance}] expect=${fixture.expect}`);
    } else {
      wrong++;
      console.log(
        `WRONG ${fixture.rubric.id} [${fixture.provenance}] expected ${fixture.expect}, judge said ${check.verdict}`,
      );
      console.log(`        judge's reason: ${check.reason}`);
      console.log(`        fixture exists because: ${fixture.note}`);
    }
  }
  console.log("\n────────────────────────────────────────");
  console.log(`${fixtures.length - wrong - errored}/${fixtures.length} correct`);
  if (errored > 0) {
    console.log(`${errored} judge errors — retry, this validated nothing`);
    process.exit(2);
  }
  if (wrong > 0) {
    console.log(`${wrong} WRONG — do not read this judge's verdicts on a run`);
    process.exit(1);
  }
  console.log("the judge agrees with every fixture in both directions");
}
void main();
