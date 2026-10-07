import { describe, expect, it } from "vitest";
import { ADDRESS_LABELS } from "@/domain";
import { DONATION_ADDRESS } from "@/lib/donation";
import { STATIC_PATHS } from "@/app/sitemap";
import { API_GROUPS } from "@/api-catalogue";
import { apiBaseUrl } from "@/lib/site";
import {
  SITE_PAGES,
  apiEndpoints,
  findApiEndpoint,
  renderPages,
  renderPrivacy,
  renderLabels,
} from "../site-guide";
import {
  PRIVACY_LEGAL_BASIS,
  PRIVACY_NOT_DONE,
  PRIVACY_OPERATOR,
  PRIVACY_PROCESSED,
  PRIVACY_PROCESSED_INTRO,
  PRIVACY_PROCESSORS,
  PRIVACY_PROCESSORS_INTRO,
  PRIVACY_PROCESSORS_OUTRO,
  PRIVACY_RIGHTS,
  PRIVACY_SUMMARY,
  plainPrivacyText,
  privacyEgressFor,
} from "@/content/privacy-facts";
import { AgentTools, sourceLinkFor } from "../tools";
import { makeChain, makeV1, FIXTURE_NOW_MS } from "../testing/fixture-world";

const tools = () => new AgentTools(makeV1(), makeChain(), () => FIXTURE_NOW_MS);
const ask = (args: Record<string, unknown>) => tools().dispatch("site_guide", JSON.stringify(args));

describe("the donation address", () => {
  /*
   * The donation address is a committed constant — the same one /donate renders and the QR
   * generator round-trips — so the guide must carry it in full rather than answering "what's the
   * address?" with a path to type.
   */
  it("is in the payload, in full", () => {
    const out = renderPages();
    expect(out).toContain(DONATION_ADDRESS);
    // Never a truncated form: the elision other long identifiers get would be catastrophic here,
    // because a corrupted address loses money irrecoverably.
    expect(out).not.toContain(`${DONATION_ADDRESS.slice(0, 12)}…`);
  });

  it("travels with the instruction that makes it safe to quote", () => {
    const out = renderPages();
    expect(out).toMatch(/never elided, abbreviated or re-typed from memory/);
    // The reader must always get a canonical copy to check against.
    expect(out).toMatch(/link \/donate in the same answer/);
  });
});

describe("the page guide", () => {
  /**
   * The guide is keyed off the list the site publishes, so a page cannot ship without the guide
   * gaining a line. The failure this prevents is silent: an undescribed page never appears in an
   * answer, which a reader cannot tell from the page not existing.
   */
  it("describes every path the sitemap publishes", () => {
    for (const path of STATIC_PATHS) {
      expect(SITE_PAGES[path], `no site-guide entry for ${path}`).toBeDefined();
      expect(SITE_PAGES[path]!.what.length, `${path}'s description is too thin`).toBeGreaterThan(
        25,
      );
    }
  });

  it("describes no page the sitemap does not publish", () => {
    // The inverse: `/mining` and `/v1` are deliberately out of the nav and the sitemap, and
    // describing one to a visitor is the same act as listing it for indexing.
    const listed = new Set<string>([...STATIC_PATHS, "/ai-agent"]);
    for (const path of Object.keys(SITE_PAGES)) {
      expect(listed.has(path), `${path} is described but not published`).toBe(true);
    }
  });

  it("renders every published page with a relative link and no absolute URL", () => {
    const out = renderPages();
    for (const path of STATIC_PATHS) expect(out).toContain(`- ${path} —`);
    expect(out).toContain("/ai-agent —");
    // A full URL in the guide invites one in the answer, where a relative path is what every other
    // citation uses and what works on both deployments.
    expect(out).not.toMatch(/https?:\/\//);
  });

  it("cites the site itself, through the real resolver", async () => {
    const result = await ask({ section: "pages" });
    expect(result.content).toContain('<site-guide section="pages">');
    expect(result.endpoints.length).toBe(1);
    expect(sourceLinkFor(result.endpoints[0]!)).toEqual({ label: "the explorer", href: "/" });
  });
});

describe("the API endpoint catalogue", () => {
  it("reads the same catalogue /api-docs renders, not a copy of it", () => {
    // One array, two consumers: the agent and the reference page cannot disagree about a parameter.
    expect(apiEndpoints().length).toBe(API_GROUPS.flatMap((g) => g.endpoints).length);
    expect(apiEndpoints().length).toBeGreaterThan(20);
  });

  it("finds an endpoint by path, by bare word, by id and by a real example URL", () => {
    expect(findApiEndpoint("/v1/blocks")?.path).toBe("/v1/blocks");
    expect(findApiEndpoint("blocks")?.path).toBe("/v1/blocks");
    expect(findApiEndpoint("GET /v1/blocks")?.path).toBe("/v1/blocks");
    // A visitor pastes a URL with the parameter filled in; the catalogue holds the template.
    expect(findApiEndpoint("/v1/blocks/3428150")?.path).toBe("/v1/blocks/{heightOrHash}");
  });

  it("returns null rather than the nearest match for something that does not exist", () => {
    // Answering about the wrong endpoint is worse than answering about none: a developer writes
    // code against whichever one is described.
    expect(findApiEndpoint("/v1/linkability")).toBeNull();
    expect(findApiEndpoint("viewing-key")).toBeNull();
    expect(findApiEndpoint("")).toBeNull();
  });

  it("answers a miss with the complete real list, never an apology alone", async () => {
    const result = await ask({ section: "api-endpoint", endpoint: "/v1/linkability" });
    expect(result.content).toMatch(/No catalogued endpoint matches/);
    // Every path in the reply is one that exists, which is what makes this a safe answer to an
    // invented endpoint name.
    expect(result.content).toContain("/v1/blocks");
    expect(result.content).toContain("/v1/supply");
  });

  it("hands over the parameters, a pinned example and a runnable curl", async () => {
    const result = await ask({ section: "api-endpoint", endpoint: "blocks" });
    expect(result.content).toContain("GET /v1/blocks");
    expect(result.content).toMatch(/example request: curl/);
    expect(result.content).toMatch(/example response:/);
    expect(result.content).toMatch(/Contract conventions/);
    expect(sourceLinkFor(result.endpoints[0]!)).toEqual({
      label: "API reference",
      href: "/api-docs",
    });
  });
});

describe("the live API descriptor", () => {
  /**
   * The API section fetches the live descriptor, which publishes the rate limits keyless at `GET
   * /v1` and is pinned to the real Caddy zones.
   */
  it("fetches the descriptor and hands over the rate limits", async () => {
    const result = await ask({ section: "api" });
    expect(result.endpoints).toEqual(["GET /v1"]);
    expect(result.content).toContain('"perIpBurst"');
    expect(result.content).toContain('"perIpSustained"');
    expect(result.content).toContain('"globalCeiling"');
  });

  it("tells the model a window belongs to every limit", async () => {
    // "20 per second per IP" and "20 per second" are different claims, and the second is the one a
    // model reaches for. The note carries the distinction because the key names do not:
    // `perIpBurst` says whose it is but not over what.
    const result = await ask({ section: "api" });
    expect(result.content).toMatch(/per SECOND/);
    expect(result.content).toMatch(/per MINUTE/);
    expect(result.content).toMatch(/shared by everyone/);
  });

  it("frames the absent daily cap as a decision, not a missing figure", async () => {
    const result = await ask({ section: "api" });
    expect(result.content).toMatch(/deliberately NO daily cap/);
    expect(result.content).toMatch(/refusal rather than as an unknown/);
  });

  it("says the endpoint list is complete, which is what makes an absence conclusive", async () => {
    const result = await ask({ section: "api" });
    expect(result.content).toMatch(/complete list/);
  });

  it("cites the reference page a human can open, not the JSON it read", async () => {
    const result = await ask({ section: "api" });
    expect(sourceLinkFor(result.endpoints[0]!)).toEqual({
      label: "API reference",
      href: "/api-docs",
    });
  });
});

describe("site_guide arguments", () => {
  it("rejects an unknown section without dispatching", async () => {
    const result = await ask({ section: "endpoints" });
    expect(result.content).toMatch(/^invalid arguments for site_guide/);
    expect(result.endpoints).toEqual([]);
  });

  it("rejects a missing section rather than defaulting to one", async () => {
    for (const bad of [{}, { section: "" }, { section: 3 }]) {
      const result = await tools().dispatch("site_guide", JSON.stringify(bad));
      expect(result.content).toMatch(/^invalid arguments for site_guide/);
    }
  });

  it("answers both committed sections with no working data surface behind them", async () => {
    // These two return before any dispatch: they read constants in this repo, so nothing can fail
    // and there is no `<unavailable>` path.
    const dead = { request: () => new Response("no", { status: 503 }) };
    const offline = new AgentTools(dead, dead);
    expect((await offline.dispatch("site_guide", '{"section":"pages"}')).content).toContain(
      "/shielded",
    );
    expect(
      (await offline.dispatch("site_guide", '{"section":"api-endpoint","endpoint":"blocks"}'))
        .content,
    ).toContain("/v1/blocks");
  });
});

describe("the tool definition", () => {
  it("carries the words a visitor asks limits in", () => {
    const def = tools()
      .defs()
      .find((d) => d.function.name === "site_guide");
    expect(def).toBeDefined();
    // A description is the only thing routing a question to the data, so it must contain the words
    // a visitor uses — "requests per second", "privacy policy" — not just "descriptor" or
    // "contract".
    for (const word of [
      /RATE LIMITS/i,
      /requests per second/i,
      /keys/i,
      /throttling/i,
      /privacy/i,
      /logging/i,
      /IP address/i,
      /cookies/i,
    ]) {
      expect(def!.function.description, `description omits ${String(word)}`).toMatch(word);
    }
    expect(def!.function.parameters.properties.section).toMatchObject({
      enum: ["api", "api-endpoint", "pages", "coverage", "privacy", "labels"],
    });
  });
});

describe("the privacy policy section", () => {
  /**
   * The answers this section prevents, quoted so the test reads against them: claims that "no third
   * party ever sees your request", that "no request for your IP ever leaves this site's own
   * server", and an invented "48-hour rolling purge" of an access log. The first inverts the page's
   * most consequential disclosure; the rest are invented, and the page states no retention window
   * on purpose.
   */
  const privacy = () => renderPrivacy();

  it("carries every claim the page renders, in the page's own words", () => {
    const out = privacy();
    const claims = [
      ...PRIVACY_NOT_DONE,
      ...PRIVACY_PROCESSED,
      ...PRIVACY_PROCESSORS,
      ...privacyEgressFor(true),
      PRIVACY_OPERATOR,
    ];
    for (const claim of claims) {
      expect(out, `${claim.id}: label missing from the guide`).toContain(claim.label);
      expect(out, `${claim.id}: body missing from the guide`).toContain(
        plainPrivacyText(claim.body),
      );
    }
    for (const prose of [
      PRIVACY_SUMMARY,
      PRIVACY_PROCESSED_INTRO,
      PRIVACY_LEGAL_BASIS,
      PRIVACY_PROCESSORS_INTRO,
      PRIVACY_PROCESSORS_OUTRO,
      ...PRIVACY_RIGHTS,
    ]) {
      expect(out, `paragraph missing: ${prose.slice(0, 40)}…`).toContain(plainPrivacyText(prose));
    }
  });

  it("names both processors and what Netlify records", () => {
    // Netlify is a US company that records every request with its IP, and no customer can switch
    // that off; netcup runs the box in Vienna.
    const out = privacy();
    expect(out).toContain("Netlify");
    expect(out).toContain("netcup");
    expect(out).toMatch(/including the IP address it came from/);
    expect(out).toMatch(/no customer can switch off/);
  });

  it("forbids the inversion and the invented figure, in as many words", () => {
    const out = privacy();
    expect(out).toMatch(/NEVER say that no third party handles a request/);
    expect(out).toMatch(/NEVER state a retention period/);
    // It says what to answer instead, because a bare prohibition is how a gap gets filled.
    expect(out).toMatch(/The page states no retention window/);
  });

  it("states no retention figure of its own", () => {
    // The prohibition would be worthless if the payload beneath it carried a retention figure — the
    // page's assertion, applied to the text the model reads.
    expect(privacy()).not.toMatch(
      /\b\d+\s*(?:-|\s)?(?:hour|day|week|month)s?\b[^.]{0,40}(?:log|purge|retention|retain|delete|discard)/i,
    );
  });

  it("keeps the scope on the no-access-logs claim", () => {
    // "This project's own servers keep no access logs" is true; "no access logs" is not, and the
    // scope words are what must survive.
    expect(privacy()).toContain("This project’s own servers keep no access logs.");
  });

  it("carries no URL but this site's own API host, and cites the page a reader can open", async () => {
    const out = privacy();
    // Link targets are stripped: a URL in a payload is a URL a model may quote, and `guard.ts`
    // allowlists what an answer may link. The one absolute URL kept is this site's API host, which
    // is the subject of a claim (where the /api-docs playground sends requests) rather than a link
    // target, and it is on the allowlist.
    const urls = (out.match(/https?:\/\/[^\s`)]+/g) ?? []).map((u) => u.replace(/[.,]$/, ""));
    expect(urls).toEqual([apiBaseUrl]);
    expect(out).toContain("/privacy");
    const result = await ask({ section: "privacy" });
    expect(result.content).toContain('<site-guide section="privacy">');
    expect(sourceLinkFor(result.endpoints[0]!)).toEqual({
      label: "privacy policy",
      href: "/privacy",
    });
  });

  it("answers with no working data surface behind it", async () => {
    // Committed constants, like 'pages' and 'coverage': nothing to dispatch and nothing to fail.
    const dead = { request: () => new Response("no", { status: 503 }) };
    const offline = new AgentTools(dead, dead);
    expect((await offline.dispatch("site_guide", '{"section":"privacy"}')).content).toContain(
      "netcup",
    );
  });
});

describe("the labels section", () => {
  /*
   * A label is otherwise reachable only from its address; this section makes the label table
   * reachable from a name.
   */
  it("lists every labelled address under the name the pages print", () => {
    const text = renderLabels();
    for (const [address, label] of Object.entries(ADDRESS_LABELS)) {
      const line = text.split("\n").find((l) => l.includes(address));
      expect(line, address).toBeDefined();
      expect(line, address).toContain(`"${label.name}"`);
    }
    expect(text).toContain(`${Object.keys(ADDRESS_LABELS).length} labelled addresses in all`);
  });

  it("files the exploit addresses as flagged, and names who flagged them", () => {
    const text = renderLabels();
    const flaggedPart = text.slice(
      text.indexOf("Addresses flagged"),
      text.indexOf("Other named addresses"),
    );
    expect(flaggedPart).toContain("t1WgMdtND8NF7NDUuYmq8MpMj1NTCXkMDVG");
    expect(flaggedPart).toContain('"BitGet Exploit Sept 2026"');
    expect(flaggedPart).toContain("flagged by ZachXBT");
    expect(flaggedPart).not.toContain("Binance Cold Wallet");
  });

  it("carries no URL, which the answer sanitiser would strip anyway", () => {
    expect(renderLabels()).not.toMatch(/https?:\/\//);
  });

  it("forbids extending a label to an address it does not list", () => {
    expect(renderLabels()).toMatch(/Never extend it to another address/);
  });

  it("does not let an absent label answer whether an incident happened", () => {
    // Absence from the label table means unlabelled, never "did not occur", so a bare "No." about
    // an incident is a claim the table cannot support.
    expect(renderLabels()).toMatch(/never answer "no" to whether an incident happened/);
  });

  it("is dispatched as a site_guide section, citing no page", async () => {
    const t = new AgentTools(makeV1(), makeChain(), () => FIXTURE_NOW_MS);
    const result = await t.dispatch("site_guide", JSON.stringify({ section: "labels" }));
    expect(result.content).toContain('<site-guide section="labels">');
    expect(result.endpoints).toEqual(["site:labels"]);
    expect(sourceLinkFor("site:labels")).toBeNull();
  });
});
