import { describe, expect, it } from "vitest";
import { recentNodeHistory } from "../tools/enrich";
import { AgentTools } from "../tools";
import { FIXTURE_NOW_MS, makeChain, makeV1 } from "../testing/fixture-world";

/** Zeno and the node history: `chain_status` 'node-history', its own facet and note. */
describe("chain_status 'node-history'", () => {
  it("reads /v1/nodes/history with the note before the data", async () => {
    const { content } = await new AgentTools(makeV1(), makeChain(), () => FIXTURE_NOW_MS).dispatch(
      "chain_status",
      JSON.stringify({ include: ["node-history"] }),
    );
    expect(content).toContain('source="GET /v1/nodes/history"');
    expect(content).toMatch(/NEVER named/);
    expect(content).toContain('"release": "1.4"');
    expect(content).toContain('"networkOperator": "DigitalOcean, LLC"');
  });

  it("keeps the first recorded day and the newest thirty", () => {
    const days = Array.from({ length: 50 }, (_, i) => ({ day: `d${i}` }));
    const trimmed = recentNodeHistory({
      data: { software: { days }, hosting: { days: days.slice(0, 5) } },
    }) as { data: { software: { days: { day: string }[] }; hosting: { days: unknown[] } } };
    expect(trimmed.data.software.days.map((d) => d.day)).toEqual([
      "d0",
      ...days.slice(-30).map((d) => d.day),
    ]);
    expect(trimmed.data.hosting.days).toHaveLength(5);
  });
});
