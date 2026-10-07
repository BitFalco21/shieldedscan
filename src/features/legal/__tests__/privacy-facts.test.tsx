import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PrivacyPage } from "../PrivacyPage";
import { PrivacyText } from "../PrivacyText";
import {
  PRIVACY_EGRESS,
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
  type PrivacyClaim,
} from "@/content/privacy-facts";

/**
 * The page and the agent's guide read one copy of these claims, `privacy-facts.ts`; this is
 * the page half. A second, hand-written summary for the agent would be a second copy of a legal
 * claim, free to drift.
 *
 * The guide half is in `server/agent/__tests__/site-guide.test.ts`. Together they mean a claim
 * cannot be added to the page without the agent gaining it, or changed on one side alone.
 */

const ALL_CLAIMS: readonly PrivacyClaim[] = [
  ...PRIVACY_NOT_DONE,
  ...PRIVACY_PROCESSED,
  ...PRIVACY_PROCESSORS,
  ...PRIVACY_EGRESS,
  PRIVACY_OPERATOR,
];

const ALL_PROSE: readonly string[] = [
  PRIVACY_SUMMARY,
  PRIVACY_PROCESSED_INTRO,
  PRIVACY_LEGAL_BASIS,
  PRIVACY_PROCESSORS_INTRO,
  PRIVACY_PROCESSORS_OUTRO,
  ...PRIVACY_RIGHTS,
];

/** The page's text as a reader gets it — one line, so a claim spanning elements still matches. */
const pageText = (): string => {
  const { container } = render(<PrivacyPage />);
  return (container.textContent ?? "").replace(/\s+/g, " ");
};

const flat = (s: string) => plainPrivacyText(s).replace(/\s+/g, " ");

describe("the page renders the committed claims", () => {
  it("prints every claim's label and body verbatim", () => {
    const text = pageText();
    // The egress list is gated on the deployment's flag, so ask for the list the page itself
    // renders rather than the whole set — the agent entry is legitimately absent here.
    const rendered = ALL_CLAIMS.filter(
      (c) => PRIVACY_EGRESS.every((e) => e.id !== c.id) || privacyEgressFor(false).includes(c),
    );
    for (const claim of rendered) {
      expect(text, `${claim.id}: label missing from the page`).toContain(claim.label);
      expect(text, `${claim.id}: body missing from the page`).toContain(flat(claim.body));
    }
  });

  it("prints every committed paragraph verbatim", () => {
    const text = pageText();
    for (const prose of ALL_PROSE) {
      expect(text, `paragraph missing: ${prose.slice(0, 40)}…`).toContain(flat(prose));
    }
  });

  it("counts the egress panel's heading from the list, never from a literal", () => {
    // On mainnet the list is five without the agent and six with it; the flag is off in the
    // test environment.
    expect(privacyEgressFor(false)).toHaveLength(5);
    expect(privacyEgressFor(true)).toHaveLength(6);
    expect(pageText()).toContain("FIVE PLACES DATA LEAVES YOUR BROWSER");
  });
});

describe("the two claims that are ABSENCES", () => {
  it("states no retention period, purge interval or log lifetime", () => {
    // The retention window is plan-dependent, so a figure here would go stale silently. Every
    // claim in the file is checked, not just the rendered page, so the agent's copy is covered.
    const everything = [pageText(), ...ALL_CLAIMS.map((c) => c.body), ...ALL_PROSE].join(" ");
    expect(everything).not.toMatch(
      /\b\d+\s*(?:-|\s)?(?:hour|day|week|month)s?\b[^.]{0,40}(?:log|purge|retention|retain|delete|discard)/i,
    );
    expect(everything).not.toMatch(
      /(?:purge|retention|retained|kept)[^.]{0,30}\b\d+\s*(?:hour|day|week|month)/i,
    );
  });

  it("names no country of residence and no supervisory authority by name", () => {
    // The operator is identified by handle alone. The right to complain is stated without
    // naming a country's authority, which would name a country.
    const text = pageText();
    expect(text).toContain("@shieldedscanxyz");
    expect(text).not.toMatch(/\b(?:CNIL|ICO|Datatilsynet|Garante|Datenschutzbeauftragte)\b/);
    expect(text).toContain("the authority in your own country of residence");
  });
});

describe("the marker renderer", () => {
  it("draws a code span, an emphasis, an internal link and an external link", () => {
    const { container } = render(
      <PrivacyText text="a `code` and *ink* and [/ai-agent](/ai-agent) and [handle](https://x.com/a)" />,
    );
    expect(container.querySelector(".font-mono")?.textContent).toBe("code");
    expect(container.querySelector(".text-ink")?.textContent).toBe("ink");
    const links = [...container.querySelectorAll("a")];
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/ai-agent", "https://x.com/a"]);
    // An off-site link must not hand the target a referrer, the standard every other outbound
    // link on this site meets.
    expect(links[1]!.getAttribute("rel")).toBe("noopener noreferrer");
    expect(container.textContent).toBe("a code and ink and /ai-agent and handle");
  });

  it("never emits markup from the text — an unmatched marker stays a literal character", () => {
    const { container } = render(<PrivacyText text="<b>bold</b> and a lone ` tick" />);
    expect(container.querySelector("b")).toBeNull();
    expect(container.textContent).toBe("<b>bold</b> and a lone ` tick");
  });

  it("strips markers for the agent, keeping the link text and dropping its target", () => {
    // The target is dropped on purpose: a URL in a payload is a URL a model may quote, and
    // `guard.ts` allowlists what an answer may link.
    expect(plainPrivacyText("see [/ai-agent](/ai-agent) or [us](https://x.com/a)")).toBe(
      "see /ai-agent or us",
    );
    expect(plainPrivacyText("a `Set-Cookie` header and *emphasis*")).toBe(
      "a Set-Cookie header and emphasis",
    );
  });
});
