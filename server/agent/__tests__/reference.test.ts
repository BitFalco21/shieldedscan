import { describe, expect, it } from "vitest";
import {
  POOL_ACTIVATION_DAYS,
  REFERENCE_TOPIC_NAMES,
  REFERENCE_TOPICS,
  referenceEndpoint,
  referenceSource,
  renderReferenceTopic,
  type ReferenceEntry,
  type ReferenceTopic,
  type ReferenceTopicName,
} from "../reference";
import { SYSTEM_PROMPT } from "../prompt";
import { sourceLinkFor } from "../tools";
import { API_GROUPS, apiDocsHrefFor } from "@/api-catalogue";

/**
 * Every committed entry, flattened. Annotated rather than inferred: `REFERENCE_TOPICS` is `as const
 * satisfies`, so `Object.values(...).flatMap` would widen the union to `unknown`; reading through
 * `ReferenceTopic` gives the sweeps a real element type.
 */
const entries = (): readonly ReferenceEntry[] =>
  REFERENCE_TOPIC_NAMES.flatMap((name): readonly ReferenceEntry[] => {
    const topic: ReferenceTopic = REFERENCE_TOPICS[name];
    return topic.entries;
  });

/**
 * The href allowlist `guard.ts` enforces on an answer, restated rather than imported. Importing the
 * sanitiser's set would make this test pass for whatever that file allows, including a host added
 * by mistake; the two lists agreeing is the property, so do not simplify this into an import.
 * `guard.test.ts` owns the sanitiser's behaviour.
 */
const LINKABLE =
  /^(?:\/|https:\/\/(?:z\.cash|zips\.z\.cash|tachyon\.z\.cash|electriccoin\.co|github\.com\/zcash))/;

describe("the committed reference corpus", () => {
  it("carries its nine topics, none of them empty", () => {
    // Pinned rather than counted, so adding a bucket is a deliberate edit and a dropped one cannot
    // pass by shifting a number. `roadmap` is the one bucket whose entries can go stale — it holds
    // what is proposed, so its statuses carry the day they were read. Append-only, matching
    // `Object.keys` order.
    expect(REFERENCE_TOPIC_NAMES).toEqual([
      "ceremonies",
      "cryptography",
      "history",
      "addresses",
      "privacy",
      "consensus",
      "economics",
      "governance",
      "roadmap",
    ]);
    for (const name of REFERENCE_TOPIC_NAMES) {
      expect(REFERENCE_TOPICS[name].entries.length, `${name} is empty`).toBeGreaterThan(0);
    }
  });

  /**
   * Every entry must name a source, a linkable document and the day it was read. Every fact here
   * reads plausibly, which is what makes an unsourced one dangerous; the test cannot verify the
   * document was opened, but it refuses an entry that does not even claim it.
   */
  it("pins every entry to a source, a linkable document and the day it was read", () => {
    for (const e of entries()) {
      expect(e.id, "id must be a slug").toMatch(/^[a-z0-9-]+$/);
      expect(e.fact.length, `${e.id} has no fact`).toBeGreaterThan(40);
      expect(e.source.length, `${e.id} names no source`).toBeGreaterThan(4);
      expect(e.verifiedOn, `${e.id} has no verification date`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(e.verifiedOn)), `${e.id} date unparseable`).toBe(false);
      // An entry may have no href (see the pin below); one that has must be linkable.
      if (e.href !== undefined) {
        expect(e.href, `${e.id} cites a host an answer could not link`).toMatch(LINKABLE);
      }
    }
  });

  /**
   * The entries allowed to carry no `href`, pinned by id so a new omission fails here and has to be
   * argued for. The NU7 coinholder vote was announced only on the community forum, a user-generated
   * host `guard.ts` deliberately does not let an answer link — the same reasoning by which
   * `sourceLinkFor` returns null for `wrapped_zec_pools` and `zec_price_history`.
   */
  // Zebra's NU7 release notes: github.com/ZcashFoundation is not on the allowlist (it admits
  // github.com/zcash only), and widening it for one citation would admit that whole organisation.
  it("lets exactly the enumerated named entries carry no linkable document", () => {
    const unlinked = entries()
      .filter((e) => e.href === undefined)
      .map((e) => e.id);
    expect(unlinked).toEqual(["nu7-zebra-testnet-release", "nu7-coinholder-vote"]);
  });

  /**
   * A citation may point at our API documentation only for a published endpoint. `/chain/*` is
   * token-gated, so a citation naming it would send a reader to something they cannot call and
   * advertise a private surface; resolving through the published catalogue makes a private path
   * unrepresentable.
   */
  it("only ever links /api-docs anchors that a published endpoint actually defines", () => {
    const anchors = entries()
      .map((e) => e.href)
      .filter((h): h is string => h !== undefined && h.startsWith("/api-docs#"));
    expect(anchors.length, "no entry cites the API at all — did an href change?").toBeGreaterThan(
      0,
    );
    const published = new Set(
      API_GROUPS.flatMap((g) => g.endpoints.map((e) => `/api-docs#${e.id}`)),
    );
    for (const href of anchors) {
      expect(published, `${href} names no published endpoint`).toContain(href);
    }
  });

  it("resolves a public path to its anchor and a private one to nothing", () => {
    // The parameter's name must not matter — a citation names the shape of the endpoint.
    expect(apiDocsHrefFor("/v1/blocks/{height}")).toBe("/api-docs#block-detail");
    expect(apiDocsHrefFor("GET /v1/supply")).toBe("/api-docs#supply");
    // Every token-gated prefix resolves to null, which is what makes the rule structural.
    for (const path of [
      "/chain/analytics/window",
      "/chain/rich-list/summary",
      "/crosschain/aggregate",
      "/chain/blocks/3428150",
    ]) {
      expect(apiDocsHrefFor(path), `${path} must not be linkable`).toBeNull();
    }
  });

  it("gives every entry a unique id, so a citation names one fact", () => {
    const ids = entries().map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  /**
   * The ceremony counts are the whole content of a "how many participants" answer, so losing one
   * would restore a refusal while every other test still passed.
   */
  it("holds the ceremony counts the tool was built for", () => {
    const facts = REFERENCE_TOPICS.ceremonies.entries.map((e) => e.fact).join(" ");
    expect(facts).toMatch(/six-participant|six participants/i);
    expect(facts).toMatch(/\b87 contributions\b/);
    expect(facts).toMatch(/over 90 contributions/i);
    // Orchard needing no ceremony is the half most easily lost in a tidy-up, and without it "which
    // pools had a ceremony" is silently incomplete.
    expect(facts).toMatch(/Orchard needed no ceremony/i);
  });

  /**
   * Activation dates, not just heights: every windowed tool takes days, and the digest and
   * `SHIELDED_UPGRADES` carry heights only. Sapling is asserted specifically: it activated at 02:15
   * UTC on the 29th, so "late October 2018" invites the 28th, and the wrong day paired with a daily
   * close yields a confident wrong price.
   */
  it("carries each pool's activation DAY, not only its height", () => {
    const e = REFERENCE_TOPICS.history.entries.find((x) => x.id === "pool-activation-dates");
    expect(e).toBeDefined();
    for (const day of ["2016-10-28", "2018-10-29", "2022-05-31", "2026-07-28"]) {
      expect(e!.fact, `no activation day ${day}`).toContain(day);
    }
    expect(e!.fact).toMatch(/2018-10-29, not the 28th/);
  });

  /**
   * The counterfeiting entry is harmful when half-stated: the flaw without the fix describes a live
   * risk that has not existed since 2018.
   */
  it("never reports the counterfeiting flaw without its remediation", () => {
    const e = REFERENCE_TOPICS.history.entries.find((x) => x.id === "counterfeiting-vulnerability");
    expect(e).toBeDefined();
    expect(e!.fact).toContain("2018-10-28");
    expect(e!.fact).toMatch(/no evidence/i);
  });

  /**
   * No entry may deny a figure a sibling in the same topic supplies. A topic renders whole, so two
   * entries disagreeing would produce a self-contradicting answer (e.g. withholding the Equihash
   * parameters while another entry states them).
   *
   * Self-repealing, like `absentSymbol`: the falsifier runs first, and the denial is forbidden only
   * once the corpus carries the figures. Withdraw the parameters and the refusal becomes legitimate
   * again with no edit here.
   */
  it("does not deny a figure that a sibling entry supplies", () => {
    const consensus = REFERENCE_TOPICS.consensus.entries;
    const supplies = consensus.some(
      (e) => /\bn\s*=\s*200\b/.test(e.fact) && /\bk\s*=\s*9\b/.test(e.fact),
    );
    expect(supplies, "the falsifier is gone — this test no longer asserts anything").toBe(true);

    for (const e of consensus) {
      expect(e.fact, `${e.id} denies the parameters a sibling states`).not.toMatch(
        /none are given here|publishes none|not given here/i,
      );
    }
  });

  /**
   * An in-flight fact states the day it was read inside its own sentence. The rendered prefix gives
   * the age, but a fact that must be paraphrased to be used can lose its caveats; with the day in
   * the prose, quoting verbatim is correct. Checked against `verifiedOn` rather than a literal, so
   * re-verifying means editing the prose and the field together.
   */
  it("states the reading day inside every in-flight fact", () => {
    const inFlight = entries().filter((e) => e.inFlight === true);
    expect(inFlight.length, "no in-flight entries — this test asserts nothing").toBeGreaterThan(0);
    for (const e of inFlight) {
      expect(e.fact, `${e.id} does not carry its own ${e.verifiedOn}`).toContain(e.verifiedOn);
    }
  });

  /**
   * No in-flight fact promises an outcome. The verb is forbidden, never a digit — the vote entry
   * legitimately carries 3,459,350 and 1,000,000. A candidate is not an inclusion, a Proposed ZIP
   * is not an Active one, and an announced vote has no result.
   *
   * The positive half is asserted too: an in-flight fact must carry a word marking it as unsettled,
   * or a flat present-tense assertion ("ZIP 234 is a Draft") would satisfy the forbid.
   */
  it("never lets an in-flight fact promise an outcome", () => {
    for (const e of entries().filter((x) => x.inFlight === true)) {
      expect(e.fact, `${e.id} promises an outcome`).not.toMatch(
        /will (?:activate|ship|be included|pass|happen)/i,
      );
      expect(e.fact, `${e.id} states an activation`).not.toMatch(/\bactivates? (?:at|on)\b/i);
      expect(e.fact, `${e.id} does not mark itself unsettled`).toMatch(
        /\bDraft\b|\bProposed\b|as read on|read on|\bproposes?d?\b|\bannounced\b|\bcandidate\b/,
      );
    }
  });

  /**
   * NU7 is described as unscheduled only while it is unscheduled; "the activation height for NU7
   * has not yet been set" must not survive NU7's activation.
   *
   * The falsifier runs first, and it is the corpus's own settled upgrade order, which gains "NU7"
   * when NU7 ships. `SHIELDED_UPGRADES` would be the wrong falsifier (it is pool-only, and NU7 may
   * add no pool). The prompt's digest carries the same order and is checked too.
   *
   * Both falsifiers read an order, not a document: the prompt mentions NU7 as proposed, so a
   * document-wide scan for "NU7" would report it as activated.
   */
  it("calls NU7 unscheduled only while the committed upgrade order agrees", () => {
    const order = REFERENCE_TOPICS.history.entries.find((e) => e.id === "nu61-exists");
    expect(order, "the committed upgrade order is gone").toBeDefined();
    const digestOrder = /^- Network upgrade history, in order:.*$/m.exec(SYSTEM_PROMPT);
    expect(digestOrder, "the prompt digest's upgrade-order line is gone or was reworded").not.toBe(
      null,
    );
    const shipped = /\bNU7\b/.test(order!.fact) || /\bNU7\b/.test(digestOrder![0]);
    expect(
      shipped,
      "the committed upgrade order (or the prompt digest) now names NU7 — it has activated, so " +
        "'the activation height for NU7 has not yet been set' is a stale refusal and " +
        "roadmap/nu7-not-yet-scheduled must be rewritten against the node",
    ).toBe(false);

    const nu7 = REFERENCE_TOPICS.roadmap.entries.find((e) => e.id === "nu7-not-yet-scheduled");
    expect(nu7, "the NU7 entry is gone").toBeDefined();
    expect(nu7!.fact).toMatch(/has not yet been set/);
  });
});

describe("rendering a topic", () => {
  it("states the facts are ours and committed, not read from the node", () => {
    const { content } = renderReferenceTopic("ceremonies");
    expect(content).toContain('<reference topic="ceremonies">');
    expect(content).toMatch(/NOT measurements/i);
    expect(content).toMatch(/read from the Zcash node/i);
  });

  /**
   * No `<data>` envelope. The envelope says "anyone may have written what follows"; nobody outside
   * this repo can write here, so wrapping it would teach the model to distrust the one payload that
   * cannot be tampered with. Asserted because the obvious "make it consistent" change is to add
   * one.
   */
  it("does not wrap committed facts in the untrusted-data envelope", () => {
    for (const name of REFERENCE_TOPIC_NAMES) {
      expect(renderReferenceTopic(name).content).not.toContain("<data");
    }
  });

  it("tells the model to give no figure the corpus does not carry", () => {
    const { content } = renderReferenceTopic("history");
    expect(content).toMatch(/NO figure, date or name that is not written here/i);
  });

  /**
   * The age of an in-flight reading is computed at request time, not authored: a frozen date reads
   * equally confident at one day or one year old. `now` is a parameter so this is assertable.
   */
  it("prints how long ago an in-flight reading was taken", () => {
    /*
     * The probe clocks are derived from the entry's own `verifiedOn`, not literals, so re-verifying
     * an entry cannot redden this test.
     */
    const roadmap: ReferenceTopic = REFERENCE_TOPICS.roadmap;
    const read = roadmap.entries.find((e) => e.inFlight === true)!.verifiedOn;
    const readMs = Date.parse(`${read}T00:00:00Z`);
    const plus = (days: number): string =>
      renderReferenceTopic("roadmap", readMs + days * 86_400_000 + 9 * 3_600_000).content;

    const twenty = plus(20);
    expect(twenty).toContain(`READ 20 DAYS AGO, ON ${read}`);
    expect(twenty).toContain("IN FLIGHT");

    expect(plus(0)).toContain(`READ TODAY, ${read}`);
    expect(plus(1), "singular at one day").toContain("READ 1 DAY AGO");
    expect(plus(2)).toContain("READ 2 DAYS AGO");

    // A `verifiedOn` in the future is a typo, and a negative count would read as a measurement.
    const before = renderReferenceTopic("roadmap", readMs - 86_400_000).content;
    expect(before).toContain("READ ON AN UNKNOWN DAY");
    expect(before).not.toMatch(/READ -\d/);
  });

  /**
   * The in-flight warning appears only on a topic that has an in-flight entry. Telling a settled
   * bucket its facts might have moved teaches the model to hedge figures this module exists to
   * state plainly. Keyed off the entries, so it repeals itself when the last `inFlight` entry
   * settles.
   */
  it("warns about staleness only where something can be stale", () => {
    expect(renderReferenceTopic("roadmap").content).toMatch(/state such a status WITH the day/i);
    for (const name of REFERENCE_TOPIC_NAMES) {
      const topic: ReferenceTopic = REFERENCE_TOPICS[name];
      if (topic.entries.some((e) => e.inFlight === true)) continue;
      const { content } = renderReferenceTopic(name);
      expect(content, `${name} is settled and must not be told otherwise`).not.toContain(
        "IN FLIGHT",
      );
      expect(content, `${name} is settled`).not.toMatch(/state such a status WITH the day/i);
    }
  });

  /**
   * An entry with no document says so; left silent, the absence invites the model to invent a
   * plausible link.
   */
  it("states when a source is named rather than linked", () => {
    const { content } = renderReferenceTopic("roadmap");
    expect(content).toContain("named, not linked");
    expect(content).toContain("Zcash Community Forum");
  });

  /**
   * One endpoint per entry, and a citation for every entry that has a document. An unlinked entry
   * keeps its endpoint (so the transcript records which facts were read) and loses only the source
   * row, the `wrapped_zec_pools` path. The exemption derives from `href`, so the ids are listed
   * only once, in the pin above.
   */
  it("emits one citation per entry returned, each resolving to its primary source", () => {
    for (const name of REFERENCE_TOPIC_NAMES) {
      const { endpoints } = renderReferenceTopic(name);
      const topicEntries: readonly ReferenceEntry[] = REFERENCE_TOPICS[name].entries;
      expect(endpoints).toHaveLength(topicEntries.length);
      for (const entry of topicEntries) {
        const link = referenceSource(referenceEndpoint(name, entry.id));
        if (entry.href === undefined) {
          expect(link, `${entry.id} has no document, so it must cite nothing`).toBeNull();
          continue;
        }
        expect(link, `${entry.id} resolved to nothing`).not.toBeNull();
        expect(link!.href).toMatch(LINKABLE);
      }
    }
  });

  /**
   * The citation must survive the real resolver: `sourceLinkFor` ends in `default: return null`, so
   * without its own branch these facts would be stated with no source beneath them.
   */
  it("resolves through sourceLinkFor rather than falling through to null", () => {
    for (const name of REFERENCE_TOPIC_NAMES) {
      const topic: ReferenceTopic = REFERENCE_TOPICS[name];
      for (const entry of topic.entries) {
        if (entry.href === undefined) continue;
        const endpoint = referenceEndpoint(name, entry.id);
        expect(sourceLinkFor(endpoint), `${endpoint} lost its citation`).not.toBeNull();
      }
    }
  });

  it("resolves nothing for an unknown topic or entry", () => {
    expect(referenceSource("reference:ceremonies#no-such-entry")).toBeNull();
    expect(referenceSource("reference:nosuchtopic#sprout-ceremony")).toBeNull();
    expect(referenceSource("GET /v1/blocks/1")).toBeNull();
    expect(referenceSource(referenceEndpoint("ceremonies", "sprout-ceremony"))).not.toBeNull();
  });
});

describe("dispatch", () => {
  const dispatch = async (topic: unknown) => {
    const { AgentTools } = await import("../tools");
    const dead = { request: () => new Response("no", { status: 500 }) };
    return new AgentTools(dead, dead).dispatch("zcash_reference", JSON.stringify({ topic }));
  };

  it("ages in-flight readings against the tool's own clock, not the wall clock", async () => {
    const roadmap: ReferenceTopic = REFERENCE_TOPICS.roadmap;
    const read = roadmap.entries.find((e) => e.inFlight === true)!.verifiedOn;
    const clock = Date.parse(`${read}T00:00:00Z`) + 3 * 86_400_000;
    const dead = { request: () => new Response("", { status: 500 }) };
    const { AgentTools } = await import("../tools");
    const result = await new AgentTools(dead, dead, () => clock).dispatch(
      "zcash_reference",
      JSON.stringify({ topic: "roadmap" }),
    );
    expect(result.content).toContain(`READ 3 DAYS AGO, ON ${read}`);
  });

  /**
   * The tool has no dispatch, so it answers with both requesters dead — which is why it has no
   * `<unavailable>` path, and what would catch a refactor routing it through an HTTP call.
   */
  it("answers with no working data surface behind it", async () => {
    const result = await dispatch("ceremonies");
    expect(result.content).toMatch(/87 contributions/);
    expect(result.endpoints.length).toBeGreaterThan(0);
  });

  it("hands an unknown topic back to the model as a correctable error", async () => {
    const result = await dispatch("ceremony");
    expect(result.content).toMatch(/^invalid arguments for zcash_reference/);
    expect(result.content).toContain("ceremonies");
    expect(result.endpoints).toEqual([]);
  });

  it("rejects a missing topic rather than defaulting to one", async () => {
    for (const bad of [undefined, "", 7, null]) {
      const result = await dispatch(bad);
      expect(result.content).toMatch(/^invalid arguments for zcash_reference/);
    }
  });
});

describe("the tool definition", () => {
  it("carries the words a visitor would use, not just the bucket names", async () => {
    const { AgentTools } = await import("../tools");
    const dead = { request: () => new Response("no", { status: 500 }) };
    const def = new AgentTools(dead, dead)
      .defs()
      .find((d) => d.function.name === "zcash_reference");
    expect(def).toBeDefined();
    const description = def!.function.description;
    // A description that omits the term for what the tool holds leaves the tool unreachable;
    // "participants" is this tool's term.
    for (const word of [
      /participants/i,
      /trusted.setup/i,
      /ceremon/i,
      /vulnerab/i,
      /ZIP 214/,
      // The `roadmap` vocabulary. This is the only gate that can catch a routing gap here:
      // `routing-coverage.test.ts` derives its check from payload quantities, and this payload is
      // prose. So the words a visitor would use are pinned.
      /NU7/,
      /Tachyon/i,
      /vot(?:e|ing)/i,
      /ZIP 234/,
      /candidate/i,
    ]) {
      expect(description, `description omits ${String(word)}`).toMatch(word);
    }
    // It must send anything current elsewhere, or it becomes a frozen second answer to questions
    // chain_status reads live.
    expect(description).toMatch(/chain_status/);
    /*
     * "LIVE CHAIN FIGURE", not "anything current": an in-flight ZIP status is current, and routing
     * "anything current" elsewhere would send every roadmap question to `chain_status`, which holds
     * none of it.
     */
    expect(description).toMatch(/LIVE CHAIN FIGURE/);
    expect(description).not.toMatch(/NOT for anything current/);
    expect(def!.function.parameters.properties.topic).toMatchObject({
      enum: REFERENCE_TOPIC_NAMES as ReferenceTopicName[],
    });
  });
});

describe("POOL_ACTIVATION_DAYS", () => {
  /*
   * The structured days are a view of the verified prose, not a second source: a day edited in one
   * place without the other fails here.
   */
  const entry = REFERENCE_TOPICS.history.entries.find((e) => e.id === "pool-activation-dates");

  it("is backed by the committed fact it summarises", () => {
    expect(entry).toBeDefined();
    for (const { pool, day } of POOL_ACTIVATION_DAYS) {
      expect(entry!.fact, `${pool} ${day}`).toContain(day);
    }
  });

  it("names all four pools once each", () => {
    expect(POOL_ACTIVATION_DAYS.map((p) => p.pool)).toEqual([
      "Sprout",
      "Sapling",
      "Orchard",
      "Ironwood",
    ]);
  });

  it("keeps Sapling on the 29th — the off-by-one that priced it 5.7% wrong", () => {
    // 2018-10-28 closed at $123.42 and 2018-10-29 at $116.81, so the wrong day gives a wrong price.
    const sapling = POOL_ACTIVATION_DAYS.find((p) => p.pool === "Sapling");
    expect(sapling!.day).toBe("2018-10-29");
  });
});
