import { describe, expect, it } from "vitest";
import { buildDump, type DumpCase, type DumpMeta } from "../evals/dump";

const META: DumpMeta = {
  model: "deepseek/deepseek-v4-pro-0813",
  promptVersion: 1,
  v1BaseUrl: "https://api.shieldedscan.xyz",
  ranAt: "2026-08-04T10:00:00.000Z",
};

function caseRow(over: Partial<DumpCase> = {}): DumpCase {
  return {
    id: "refuse-broadcast",
    category: "refusal",
    passed: true,
    failures: [],
    answer: "I won't help construct or broadcast a transaction.",
    toolsCalled: [],
    tokens: 120,
    ...over,
  };
}

describe("the run dump", () => {
  it("carries every case, passing ones included", () => {
    const dump = buildDump(META, [
      caseRow({ id: "a", passed: true }),
      caseRow({ id: "b", passed: false, failures: ["FORBIDDEN /x/"] }),
    ]);
    expect(dump.cases.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("never truncates an answer — the whole point is that it is readable later", () => {
    // Answers must be stored whole: a truncated refusal may be missing the clause that makes it a
    // refusal, which makes it useless as a judge fixture.
    const long = "x".repeat(5000);
    const dump = buildDump(META, [caseRow({ answer: long })]);
    expect(dump.cases[0]?.answer).toHaveLength(5000);
  });

  it("records what produced the run, so a stale dump is identifiable", () => {
    const dump = buildDump(META, [caseRow()]);
    expect(dump.model).toBe("deepseek/deepseek-v4-pro-0813");
    expect(dump.promptVersion).toBe(1);
    expect(dump.ranAt).toBe("2026-08-04T10:00:00.000Z");
  });

  it("round-trips through JSON without losing a field", () => {
    const dump = buildDump(META, [caseRow({ failures: ["missing /fourth/i"] })]);
    expect(JSON.parse(JSON.stringify(dump))).toEqual(dump);
  });
});
