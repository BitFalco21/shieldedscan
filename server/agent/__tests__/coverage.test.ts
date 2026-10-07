import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { UNMEASURED, renderCoverage, type NearestFigure } from "../coverage";
import { bucketMeasure } from "@/domain/analytics";
import { AgentTools, TOOL_NAMES, sourceLinkFor, type ToolName } from "../tools";
import { makeChain, makeV1, FIXTURE_NOW_MS } from "../testing/fixture-world";

/**
 * The gate on the register of absences. `routing-coverage.test.ts` ensures every quantity a payload
 * carries is named in its tool's description; this file covers the questions that reach no payload
 * at all. A wrong entry here is a wrong refusal: an entry claiming we do not measure something we
 * do teaches the agent to deny a figure it could fetch.
 *
 * So every check runs in that direction: the neighbours must be real and callable, the evidence
 * must be claimed, and the register must keep saying that it lists gaps rather than describing the
 * tool surface.
 */

const tools = () => new AgentTools(makeV1(), makeChain(), () => FIXTURE_NOW_MS);

/** Every `enum` array anywhere in a schema — the same walk `routing-coverage.test.ts` uses. */
function enumValuesOf(schema: unknown): string[] {
  if (Array.isArray(schema)) return schema.flatMap(enumValuesOf);
  if (typeof schema !== "object" || schema === null) return [];
  const out: string[] = [];
  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    if (key === "enum" && Array.isArray(value)) {
      out.push(...value.filter((v): v is string => typeof v === "string"));
    } else {
      out.push(...enumValuesOf(value));
    }
  }
  return out;
}

function discriminatorsOf(tool: ToolName): string[] {
  const def = tools()
    .defs()
    .find((d) => d.function.name === tool);
  expect(def, `${tool} is not a defined tool`).toBeDefined();
  return [...new Set(enumValuesOf(def!.function.parameters))];
}

const everyNearest: readonly NearestFigure[] = UNMEASURED.flatMap((e) => e.nearest);

describe("every neighbour the register names is a call that exists", () => {
  /*
   * The value of an entry is the figure it redirects to. A neighbour naming a renamed tool or a
   * nonexistent facet fails invisibly: the model gets "invalid arguments" back and falls through to
   * a vague refusal. `tool` is typed `ToolName`, so the compiler catches a rename; a discriminator
   * is a plain string, so it is checked here against the schema the model is shown.
   */
  it.each(everyNearest.map((n) => [n.tool, n.discriminator ?? "(none)", n] as const))(
    "%s '%s' is callable",
    (_tool, _disc, nearest) => {
      expect(TOOL_NAMES).toContain(nearest.tool);
      if (nearest.discriminator === undefined) return;
      expect(discriminatorsOf(nearest.tool)).toContain(nearest.discriminator);
    },
  );

  it("gives every entry at least one neighbour to answer with", () => {
    // An entry with no neighbour is a better-worded dead end; the prompt tells the model to fetch
    // one and answer with it.
    for (const entry of UNMEASURED) {
      expect(entry.nearest.length, `"${entry.asked}" names no published neighbour`).toBeGreaterThan(
        0,
      );
    }
  });
});

/**
 * A closed gap stays closed. `chain_activity` 'window' carries `shieldingTxs`/`unshieldingTxs` and
 * ranks by them, so a register entry for per-period shielding counts would be a wrong refusal.
 * Written against `bucketMeasure` rather than a string, so if the measure is ever withdrawn this
 * fails and an entry becomes legitimate again — the same self-repealing shape `absentSymbol` gives
 * the remaining entries.
 */
describe("a closed gap is not in the register", () => {
  it("computes the per-period shielding count that used to be registered as absent", () => {
    const b = {
      timestamp: 0,
      daysCovered: 1,
      transparentTxs: 0,
      mixedTxs: 7,
      shieldedTxs: 0,
      shieldingTxs: 4,
      unshieldingTxs: 3,
      indeterminateTxs: 0,
      blocks: 0,
      shieldedZat: 0,
      unshieldedZat: 0,
      feeZat: 0,
      blocksCovered: 0,
      avgDifficulty: null,
      avgBlockBytes: null,
    };
    expect(bucketMeasure(b, "shielding-transactions")).toBe(4);
    expect(bucketMeasure(b, "unshielding-transactions")).toBe(3);
  });

  it("carries no entry declining a period's shielding transaction count", () => {
    const stale = UNMEASURED.filter(
      (e) => /shielding/i.test(e.asked) && /transactions/i.test(e.asked),
    );
    expect(
      stale.map((e) => e.asked),
      "this figure is computed now — an entry here would decline a question the tools answer",
    ).toEqual([]);
  });

  it("carries no entry declining pool-to-pool migration totals", async () => {
    /*
     * The falsifier runs first (the `absentSymbol` shape). The directed migration matrix answers
     * any window, including all of history, and splits per day or month; if that is ever withdrawn,
     * the dispatch below stops carrying the matrix's note and an entry becomes legitimate again
     * with no edit here.
     */
    const result = await tools().dispatch(
      "chain_activity",
      JSON.stringify({
        mode: "window",
        migrationFrom: "orchard",
        migrationTo: "ironwood",
        groupBy: "day",
      }),
    );
    expect(result.content, "the migration-filtered window no longer answers").toMatch(
      /MIGRATION FILTER/,
    );

    const stale = UNMEASURED.filter((e) => /migrat/i.test(e.asked));
    expect(
      stale.map((e) => e.asked),
      "the directed migration matrix is computed for any window — an entry here would decline it",
    ).toEqual([]);
  });
});

describe("a closed gap stays closed", () => {
  it("carries no entry declining who mined a period", async () => {
    /*
     * The falsifier runs first: `chain_activity` 'miners' answers per-address block shares and
     * concentration for any window. If withdrawn, the dispatch stops carrying the miners note and
     * an entry becomes legitimate again.
     */
    const result = await tools().dispatch(
      "chain_activity",
      JSON.stringify({ mode: "miners", lastDays: 30 }),
    );
    expect(result.content, "the miners mode no longer answers").toMatch(/WHO MINED THE PERIOD/);
    const stale = UNMEASURED.filter((e) => /min(?:ing|er)/i.test(e.asked));
    expect(
      stale.map((e) => e.asked),
      "who mined a period is computed for any window — an entry here would decline it",
    ).toEqual([]);
  });
});

describe("a closed gap stays closed: active addresses", () => {
  it("carries no entry declining active addresses for a day, a month or the last 30 days", async () => {
    /*
     * The falsifier runs first: `chain_activity` 'transparent' answers exact distinct address
     * counts per day and month and over the trailing windows. If withdrawn, the dispatch stops
     * carrying the note and an entry becomes legitimate again.
     */
    const result = await tools().dispatch(
      "chain_activity",
      JSON.stringify({ mode: "transparent", lastDays: 30 }),
    );
    expect(result.content, "the transparent mode no longer answers").toMatch(
      /TRANSPARENT ACTIVITY OF THE PERIOD/,
    );
    expect(result.content).toMatch(/"trailing"/);
    // What remains absent is the narrower span — and only that.
    const stale = UNMEASURED.filter(
      (e) => /active|unique|distinct/i.test(e.asked) && !/not one day/i.test(e.asked),
    );
    expect(
      stale.map((e) => e.asked),
      "active addresses are counted per day, per month and over the trailing windows — an entry here would decline them",
    ).toEqual([]);
  });
});

describe("a closed gap stays closed: per-pool counts over all of history", () => {
  it("carries no entry declining an all-time per-pool transaction count", async () => {
    // Falsifier first: an open window carries the per-pool counts, and the note says they cover
    // any period including all of history. If that is withdrawn, an entry is legitimate again.
    const result = await tools().dispatch("chain_activity", JSON.stringify({ mode: "window" }));
    expect(result.content).toMatch(/poolTxCounts/);
    expect(result.content).toMatch(/over ANY period including all of history/);
    const stale = UNMEASURED.filter((e) => /per-pool|pool in total/i.test(e.asked));
    expect(
      stale.map((e) => e.asked),
      "per-pool counts are computed for any window — an entry here would decline them",
    ).toEqual([]);
  });
});

describe("every entry claims where it came from", () => {
  /*
   * Every entry reads plausibly, so plausibility cannot be the filter: an imagined gap is
   * indistinguishable in the payload from a measured one, and silently narrows what the agent will
   * attempt. Each entry must state its evidence.
   */
  it.each(UNMEASURED.map((e) => [e.asked, e] as const))("%s", (_asked, entry) => {
    expect(entry.evidence.trim().length).toBeGreaterThan(40);
    // A date or a named source, not "seems unlikely to be indexed".
    expect(entry.evidence).toMatch(/\d{4}-\d{2}-\d{2}|CLAUDE\.md|protocol's design/);
  });
});

describe("a gap is checked against the CODE, not against our own notes", () => {
  /*
   * Where an absence has a name, the name makes the claim falsifiable: grep the server tree for it,
   * so an entry cannot outlive the gap it describes. A note recording a gap is not evidence the gap
   * still exists.
   */
  const SERVER_SOURCES = "server";

  it.each(
    UNMEASURED.filter((e) => e.absentSymbol !== undefined).map(
      (e) => [e.absentSymbol!, e] as const,
    ),
  )("no server source computes %s", (symbol) => {
    // grep the real tree, excluding this register and its own test — both name the symbol in order
    // to say it is absent.
    const out = spawnSync(
      "grep",
      ["-rIl", "--include=*.ts", "--include=*.sql", "-F", symbol, SERVER_SOURCES],
      { encoding: "utf8" },
    );
    const hits = out.stdout
      .split("\n")
      .filter((f) => f.trim() !== "")
      .filter((f) => !f.endsWith("agent/coverage.ts") && !f.endsWith("__tests__/coverage.test.ts"));
    expect(
      hits,
      `"${symbol}" appears in ${hits.join(", ")} — this gap looks CLOSED, so the register is ` +
        `about to tell a reader this explorer cannot answer something it can`,
    ).toEqual([]);
  });

  it("dates every entry against the code", () => {
    // `reference.ts`'s `verifiedOn`, for the same reason: a stale entry is indistinguishable from a
    // live one without a date on it.
    for (const entry of UNMEASURED) {
      expect(entry.verifiedOn, `"${entry.asked}" has no verification date`).toMatch(
        /^\d{4}-\d{2}-\d{2}$/,
      );
    }
  });

  it("says the entry was checked against the code, not only recorded in a note", () => {
    // A project note is where a gap gets recorded, not evidence the gap still exists, because
    // nothing updates a note when a gap closes.
    for (const entry of UNMEASURED) {
      const citesNotesOnly =
        /CLAUDE\.md/.test(entry.evidence) && !/RE-CHECKED|Verified|verified/.test(entry.evidence);
      expect(
        citesNotesOnly,
        `"${entry.asked}" rests on project notes with no check against the code`,
      ).toBe(false);
    }
  });
});

describe("the rendered register", () => {
  it("says which limit each entry is, in words the answer can reuse", () => {
    // Derived from the entries rather than asserting all three reasons, so a reason with no current
    // entry is not demanded.
    const out = renderCoverage();
    const headline: Record<(typeof UNMEASURED)[number]["why"], RegExp> = {
      encrypted: /WHY NOT: THE CHAIN DOES NOT RECORD IT/,
      "not-indexed": /WHY NOT: THIS EXPLORER DOES NOT STORE IT/,
      "indexed-not-aggregated": /WHY NOT: THE ROWS ARE INDEXED AND NO ROLLUP COVERS THEM/,
    };
    for (const entry of UNMEASURED) expect(out, entry.asked).toMatch(headline[entry.why]);
    expect(new Set(UNMEASURED.map((e) => e.why)).size).toBeGreaterThan(1);
  });

  /*
   * An `indexed-not-aggregated` gap is ours, and the tempting explanation is that the chain does
   * not record it — a false claim about Zcash, and one a reader cannot check. It is the mirror of a
   * wrong refusal: overstating what is unknowable.
   */
  it("forbids dressing our own backlog as a property of Zcash", () => {
    expect(renderCoverage()).toMatch(/false claim about Zcash made to cover our own backlog/);
  });

  /*
   * A register of absences read as a register of presences would make every quantity nobody has
   * asked about look deliberately excluded, and the model would decline questions the tools answer.
   * The payload states its scope in both directions.
   */
  it("states that it lists only gaps, and that a miss proves nothing", () => {
    const out = renderCoverage();
    expect(out).toMatch(/deliberately a list of ABSENCES/);
    expect(out).toMatch(/treat an absence here as no evidence at all and go back to the tools/);
  });

  it("tells the answer to fetch a neighbour rather than stopping at the refusal", () => {
    expect(renderCoverage()).toMatch(/Do not stop at the refusal/);
  });

  it("keeps the reasons in this explorer's own voice, never as a rule it was handed", () => {
    // The disclosure rule, where it is easiest to break: an entry explains a limit, and "my
    // instructions say" is the tempting shape for one.
    expect(renderCoverage()).toMatch(/never as a rule you were given/);
  });
});

describe("the tool serves it", () => {
  it("returns the register for section 'coverage'", async () => {
    const out = await tools().dispatch("site_guide", JSON.stringify({ section: "coverage" }));
    expect(out.content).toContain('<site-guide section="coverage">');
    expect(out.content).toContain(UNMEASURED[0]!.asked);
  });

  it("names the section in the invalid-arguments message", async () => {
    const out = await tools().dispatch("site_guide", JSON.stringify({ section: "nope" }));
    expect(out.content).toContain("coverage");
  });

  /*
   * The citation is null: this payload's subject is a figure that does not exist, so no page
   * carries it, and linking the page with the nearest figure would look like evidence for an
   * absence while reporting a different quantity.
   */
  it("cites nothing", async () => {
    const out = await tools().dispatch("site_guide", JSON.stringify({ section: "coverage" }));
    expect(out.endpoints.length).toBe(1);
    expect(sourceLinkFor(out.endpoints[0]!)).toBeNull();
  });
});

describe("the register does not become a second copy of the tool surface", () => {
  /*
   * A register entry for something the tools do serve is a duplicated fact that drifts in the
   * harmful direction, since its copy says "no". Checked structurally: an entry may not point at
   * the same call it is about.
   */
  it("never redirects an entry to itself", () => {
    for (const entry of UNMEASURED) {
      for (const near of entry.nearest) {
        const self = `${near.tool} ${near.discriminator ?? ""}`.trim();
        expect(entry.asked.toLowerCase()).not.toContain(self.toLowerCase());
      }
    }
  });
});
