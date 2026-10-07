/**
 * Advisory verdicts on a run's NEEDS REVIEW cases — a reading aid for the person who grades them,
 * never a gate. Reads a `--dump` from `run.ts`, sends each outstanding rubric to the judge with the
 * direction the case asserts, prints the verdicts and writes `<dump>.judged.json` beside it.
 *
 *   node dist/eval-judge-review.mjs run.json (NEAR_AI_API_KEY in the environment)
 *
 * The runner's exit code is untouched: `run.ts` still prints NEEDS REVIEW and exits 3, because a
 * person decides. This only puts a second opinion beside each answer so the reviewer can read the
 * disagreements first. Validate the judge (`judge-validate.ts`) before trusting it.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { ALL_CASES } from "./cases";
import type { DumpFile } from "./dump";
import {
  checkRubric,
  JUDGE_MODEL,
  JUDGE_PROVIDER,
  nearJudgeCaller,
  type RawVerdict,
} from "./judge";
import { ALL_RUBRICS } from "./rubrics";

const API_KEY = process.env[JUDGE_PROVIDER.keyEnv];

interface Judged {
  id: string;
  rubricId: string;
  expect: "satisfies" | "does-not-satisfy";
  verdict: RawVerdict | "error";
  agrees: boolean;
  reason: string;
}

async function main(): Promise<void> {
  const path = process.argv[2];
  if (!API_KEY || !path) {
    console.error(`usage: ${JUDGE_PROVIDER.keyEnv}=… node eval-judge-review.mjs <run.json>`);
    process.exit(2);
  }
  type ReviewedCase = DumpFile["cases"][number] & {
    reviews?: { rubricId: string; expect: "satisfies" | "does-not-satisfy" }[];
  };
  const dump = JSON.parse(readFileSync(path, "utf8")) as Omit<DumpFile, "cases"> & {
    cases: ReviewedCase[];
  };
  const byId = new Map(ALL_CASES.map((c) => [c.id, c]));
  const rubricById = new Map(ALL_RUBRICS.map((r) => [r.id, r]));
  const judge = nearJudgeCaller(API_KEY);
  const pending = dump.cases.filter((c) => c.passed && (c.reviews?.length ?? 0) > 0);
  console.log(
    `judge ${JUDGE_MODEL} @ ${JUDGE_PROVIDER.id} · ${pending.length} cases to review from ${path}\n`,
  );
  const out: Judged[] = [];
  let disagreements = 0;
  let errors = 0;
  for (const c of pending) {
    const testCase = byId.get(c.id);
    if (!testCase) {
      console.log(`?      ${c.id} — not in the current corpus, skipped`);
      continue;
    }
    for (const review of c.reviews ?? []) {
      const rubric = rubricById.get(review.rubricId);
      if (!rubric) {
        console.log(`?      ${c.id} — unknown rubric ${review.rubricId}, skipped`);
        continue;
      }
      const expected: RawVerdict = review.expect === "satisfies" ? "pass" : "fail";
      const check = await checkRubric(
        rubric,
        expected,
        { question: testCase.question, answer: c.answer, toolsCalled: c.toolsCalled },
        judge,
        AbortSignal.timeout(180_000),
      );
      const agrees = check.ok;
      if (check.verdict === "error") errors++;
      else if (!agrees) disagreements++;
      const tag = check.verdict === "error" ? "ERROR " : agrees ? "agrees" : "DISAGR";
      console.log(
        `${tag} ${c.id} · ${review.rubricId} (case expects ${review.expect}) — ${check.reason}`,
      );
      out.push({
        id: c.id,
        rubricId: review.rubricId,
        expect: review.expect,
        verdict: check.verdict,
        agrees,
        reason: check.reason,
      });
    }
  }
  const outPath = path.replace(/\.json$/, "") + ".judged.json";
  writeFileSync(outPath, JSON.stringify({ model: JUDGE_MODEL, judged: out }, null, 2));
  console.log("\n────────────────────────────────────────");
  console.log(
    `${out.length} rubrics judged · ${disagreements} disagree with the case · ${errors} errors · written to ${outPath}`,
  );
  console.log(
    "Advisory only: read the disagreements first, then the rest. The run's own verdict is unchanged.",
  );
}
void main();
