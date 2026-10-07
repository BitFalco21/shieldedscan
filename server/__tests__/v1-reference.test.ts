import { describe, expect, it } from "vitest";
import { API_GROUPS } from "@/api-catalogue";
import { REFERENCE_TOPICS, type ReferenceTopicName } from "../agent/reference";
import { TOOL_NAMES } from "../agent/tools";
import { GLOSSARY, REFERENCE_TOPIC_LIST, v1ReferenceRoutes } from "../v1/reference";

/**
 * `/v1/reference`: the agent's reference set, published for any assistant. The text is committed,
 * so what can go wrong is the packaging: an agent instruction leaking into a public answer, a
 * relative link that means nothing off this site, an in-flight fact losing its date, or a
 * glossary naming an endpoint that does not exist.
 */

const NOW = Date.UTC(2026, 9, 4, 12);
const app = () => v1ReferenceRoutes(() => NOW);
const get = async (q = "") => {
  const res = await app().request(`/v1/reference${q}`);
  return { status: res.status, body: await res.json() };
};

describe("/v1/reference", () => {
  it("lists every topic, glossary first, and carries the glossary", async () => {
    const { status, body } = await get();
    expect(status).toBe(200);
    expect(body.topics.map((t: { name: string }) => t.name)).toEqual([...REFERENCE_TOPIC_LIST]);
    expect(body.glossary).toEqual(GLOSSARY);
  });

  it("answers a topic with every entry, absolute links, and its source", async () => {
    for (const name of REFERENCE_TOPIC_LIST.slice(1) as ReferenceTopicName[]) {
      const { status, body } = await get(`?topic=${name}`);
      expect(status, name).toBe(200);
      expect(body.entries.map((e: { id: string }) => e.id)).toEqual(
        REFERENCE_TOPICS[name].entries.map((e) => e.id),
      );
      for (const e of body.entries) {
        expect(e.source, e.id).toBeTruthy();
        expect(e.verifiedOn, e.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        if (e.href !== null) expect(e.href, e.id).toMatch(/^https:\/\//);
      }
    }
  });

  it("dates an in-flight fact from today, and says how to state it", async () => {
    const { body } = await get("?topic=roadmap");
    const inFlight = body.entries.filter((e: { inFlight: boolean }) => e.inFlight);
    expect(inFlight.length).toBeGreaterThan(0);
    for (const e of inFlight) {
      const days = Math.floor((NOW - Date.parse(`${e.verifiedOn}T00:00:00Z`)) / 86_400_000);
      expect(e.readDaysAgo, e.id).toBe(days);
    }
    expect(body.inFlightRule).toMatch(/verifiedOn/);
    // A settled fact carries no age, and a topic with none in flight carries no rule.
    for (const e of body.entries.filter((x: { inFlight: boolean }) => !x.inFlight)) {
      expect(e.readDaysAgo).toBeNull();
    }
    expect((await get("?topic=ceremonies")).body.inFlightRule).toBeUndefined();
  });

  it("never names one of Zeno's tools, which an MCP client does not have", async () => {
    // Only the underscore names: `crosschain` and `calculate` are ordinary words and paths.
    const agentOnly = TOOL_NAMES.filter((n) => n.includes("_"));
    const answers = [
      await get(),
      ...(await Promise.all(REFERENCE_TOPIC_LIST.map((t) => get(`?topic=${t}`)))),
    ];
    const text = JSON.stringify(answers.map((a) => a.body));
    for (const name of agentOnly) expect(text, name).not.toContain(name);
  });

  it("refuses an unknown topic by naming the topics, and an unknown parameter", async () => {
    const bad = await get("?topic=nope");
    expect(bad.status).toBe(400);
    expect(bad.body.error.message).toContain("glossary | ceremonies");
    expect((await get("?topic=history&x=1")).status).toBe(400);
  });

  it("glossary names only endpoints the API documents", () => {
    // Against the catalogue, not a bare app: the analytics routes mount as extensions.
    const documented = new Set(API_GROUPS.flatMap((g) => g.endpoints.map((e) => e.path)));
    const named = GLOSSARY.flatMap((g) => g.definition.match(/\/v1\/[a-z0-9/-]+/g) ?? []);
    expect(named.length).toBeGreaterThan(0);
    for (const path of named) expect(documented, path).toContain(path);
  });
});
