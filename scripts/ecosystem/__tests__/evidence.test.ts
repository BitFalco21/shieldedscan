import { describe, expect, it } from "vitest";
import {
  pageDescription,
  pageTitle,
  pageVerdict,
  visibleText,
  zcashMentions,
} from "../lib/evidence.mjs";
import { isArchivedRepoPage, isForkRepoPage, latestCommitFromAtom } from "../lib/repo-activity.mjs";

const probeOf = (body: string, status = 200) => ({
  url: "https://example.org/",
  status,
  finalUrl: "https://example.org/",
  contentType: "text/html",
  body,
  error: null,
  cached: false,
});

const filler = "A private wallet for everyday payments. ".repeat(10);

describe("pageTitle / pageDescription", () => {
  it("prefers og:site_name, then <title>, decoding entities", () => {
    expect(pageTitle('<meta property="og:site_name" content="Zashi"><title>x</title>')).toBe(
      "Zashi",
    );
    expect(pageTitle("<title>Zingo &amp; Friends\n</title>")).toBe("Zingo & Friends");
  });

  it("strips control and bidi characters and caps length", () => {
    expect(pageTitle("<title>ok‮evil</title>")).toBe("okevil");
    expect(pageTitle(`<title>${"a".repeat(300)}</title>`)?.length).toBe(160);
  });

  it("reads the meta description", () => {
    expect(pageDescription('<meta name="description" content="Shielded by default">')).toBe(
      "Shielded by default",
    );
  });
});

describe("zcashMentions", () => {
  it("counts whole words only", () => {
    expect(zcashMentions("Zcash and ZEC, via Zashi").count).toBe(3);
    // YZCASH is not Zcash: a substring match is not evidence.
    expect(zcashMentions("YZCASH yield vault").count).toBe(0);
  });

  it("does not count ordinary English pool names as evidence", () => {
    expect(zcashMentions("an orchard of sapling trees").count).toBe(0);
  });

  it("ignores script contents because visibleText drops them", () => {
    const text = visibleText(`<script>var zcash = 1</script><p>${filler}</p>`);
    expect(zcashMentions(text).count).toBe(0);
  });
});

describe("pageVerdict", () => {
  it("separates an outage of the site from a refusal to robots", () => {
    expect(pageVerdict({ ...probeOf(""), status: null, error: "ENOTFOUND" }).verdict).toBe(
      "unreachable",
    );
    expect(pageVerdict(probeOf("", 403)).verdict).toBe("blocked");
    expect(pageVerdict(probeOf("", 404)).verdict).toBe("dead");
  });

  it("recognises a parked domain and a soft 404", () => {
    expect(pageVerdict(probeOf(`<p>This domain is for sale. ${filler}</p>`)).verdict).toBe(
      "parked",
    );
    expect(pageVerdict(probeOf(`<title>Page not found</title><p>${filler}</p>`)).verdict).toBe(
      "soft-404",
    );
  });

  it("calls an empty shell client-rendered, never 'not about Zcash'", () => {
    expect(pageVerdict(probeOf('<div id="root"></div><script src="a.js"></script>')).verdict).toBe(
      "client-rendered",
    );
  });

  it("calls a real page live", () => {
    expect(pageVerdict(probeOf(`<title>Wallet</title><p>${filler}</p>`)).verdict).toBe("live");
  });
});

describe("repo activity from web pages", () => {
  it("takes the newest commit in an Atom feed", () => {
    const atom = `<feed><updated>2026-09-01T00:00:00Z</updated>
      <entry><updated>2025-01-02T03:04:05Z</updated></entry>
      <entry><updated>2025-06-01T00:00:00Z</updated></entry></feed>`;
    // The feed's own <updated> is outside every <entry> and must not count.
    expect(latestCommitFromAtom(atom)).toBe("2025-06-01T00:00:00.000Z");
    expect(latestCommitFromAtom("<feed></feed>")).toBeNull();
  });

  it("reads GitHub's archive banner", () => {
    expect(isArchivedRepoPage("This repository has been archived by the owner on Jan 1")).toBe(
      true,
    );
    expect(isArchivedRepoPage("<main>code</main>")).toBe(false);
  });
});

describe("platform names and forks", () => {
  it("does not name a project after the platform hosting it", () => {
    expect(
      pageTitle('<meta property="og:site_name" content="GitHub"><title>zingo-mobile</title>'),
    ).toBe("zingo-mobile");
    expect(pageTitle('<meta property="og:site_name" content="My Site"><title>FPF</title>')).toBe(
      "FPF",
    );
  });

  it("reads GitHub's fork line, and not an organisation's list of forks", () => {
    // Shapes captured from github.com/iron-fish/librustzcash and github.com/zcashfoundation.
    expect(
      isForkRepoPage(
        'forked from <a data-hovercard-type="repository" class="Link--inTextBlock" href="/zcash/librustzcash">',
      ),
    ).toBe(true);
    expect(
      isForkRepoPage('Forked from <a class="Link--muted Link--inTextBlock" href="/alchemydc/z3">'),
    ).toBe(false);
    expect(isForkRepoPage("<p>This wallet was forked from Zecwallet in prose.</p>")).toBe(false);
  });
});
