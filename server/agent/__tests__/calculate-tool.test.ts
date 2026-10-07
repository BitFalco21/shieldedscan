import { describe, expect, it } from "vitest";
import { AgentTools } from "../tools";

/**
 * The `calculate` tool at the dispatch boundary: it reads nothing, and its whole payload derives
 * from the model's own arguments. Pinned here: it answers with both requesters dead (no dispatch,
 * so no `<unavailable>` path), a bad expression fails in its own row instead of voiding the call,
 * and the note about operand choice travels with every result.
 */
describe("calculate dispatch", () => {
  const dead = { request: () => new Response("no", { status: 500 }) };
  const dispatch = (args: unknown) =>
    new AgentTools(dead, dead).dispatch("calculate", JSON.stringify(args));

  it("evaluates every expression with both requesters dead, and cites no endpoint", async () => {
    const result = await dispatch({ expressions: ["(620 / 4620) * 100", "13,135.5 * 2"] });
    expect(result.endpoints).toEqual([]);
    expect(result.content).toContain('"value": 13.41991341991342');
    expect(result.content).toContain('"text": "13.41991342"');
    expect(result.content).toContain('"value": 26271');
  });

  it("carries the operand-responsibility note, outside any data envelope", async () => {
    const result = await dispatch({ expressions: ["1 + 1"] });
    // Nothing here traversed a third party, so there is no <data> envelope; the note on where
    // operands must come from and which combinations stay forbidden rides with every result.
    expect(result.content).not.toContain("<data");
    expect(result.content).toMatch(/PREFER a figure the data already carries/);
    expect(result.content).toMatch(/Never mix bases or sources/);
    expect(result.content).toMatch(/no median may be derived from other medians/i);
  });

  it("a bad expression is an error in its own row, and the others still evaluate", async () => {
    const result = await dispatch({ expressions: ["2 * 3", "1 / 0", "Math.PI"] });
    expect(result.content).toContain('"value": 6');
    expect(result.content).toContain('"error": "division by zero"');
    expect(result.content).toMatch(/not part of an arithmetic expression/);
  });

  it("malformed arguments are a correctable message, never a throw", async () => {
    for (const args of [{}, { expressions: [] }, { expressions: [1, 2] }, { expressions: "1+1" }]) {
      const result = await dispatch(args);
      expect(result.content).toMatch(/^invalid arguments for calculate/);
      expect(result.endpoints).toEqual([]);
    }
    const tooMany = await dispatch({ expressions: Array.from({ length: 11 }, () => "1+1") });
    expect(tooMany.content).toMatch(/at most 10 expressions/);
  });
});
