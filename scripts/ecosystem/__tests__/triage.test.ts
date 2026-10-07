import { describe, expect, it } from "vitest";
import { triage } from "../lib/triage.mjs";

const NOW = Date.parse("2026-09-27T00:00:00Z");
const recent = "2026-08-01T00:00:00Z";
const old = "2021-01-01T00:00:00Z";

const base = {
  sources: ["zechub"],
  strongest: "entry",
  possibleGrants: [],
  page: { verdict: "live", zcashCount: 4 },
  repo: null,
};

describe("triage", () => {
  it("a live catalogue entry that names Zcash is likely in", () => {
    expect(triage(base, NOW).bucket).toBe("likely-in");
  });

  it("a dead or parked page is likely out whatever vouched for it", () => {
    expect(triage({ ...base, page: { verdict: "dead", zcashCount: 0 } }, NOW).bucket).toBe(
      "likely-out",
    );
    expect(triage({ ...base, page: { verdict: "parked", zcashCount: 0 } }, NOW).bucket).toBe(
      "likely-out",
    );
  });

  it("a bare mention with no Zcash evidence is likely out", () => {
    const t = triage(
      { ...base, strongest: "mention", page: { verdict: "live", zcashCount: 0 } },
      NOW,
    );
    expect(t.bucket).toBe("likely-out");
    expect(t.reasons).toContain("no Zcash evidence");
  });

  it("a blocked or client-rendered page needs a person, not a verdict", () => {
    expect(triage({ ...base, page: { verdict: "blocked", zcashCount: 0 } }, NOW).bucket).toBe(
      "needs-look",
    );
    expect(
      triage({ ...base, page: { verdict: "client-rendered", zcashCount: 0 } }, NOW).bucket,
    ).toBe("likely-in");
  });

  it("a redirect to an unrelated host is never likely in on its own", () => {
    const t = triage(
      { ...base, page: { verdict: "live", zcashCount: 4, redirectsTo: "mancity.com" } },
      NOW,
    );
    expect(t.bucket).toBe("needs-look");
    expect(t.reasons).toContain("redirects to mancity.com");
  });

  it("repository README evidence counts as Zcash evidence", () => {
    const t = triage(
      {
        ...base,
        strongest: "mention",
        page: null,
        repo: { archived: false, pushedAt: recent, zcashCount: 3 },
      },
      NOW,
    );
    expect(t.bucket).toBe("needs-look");
    expect(t.reasons).toEqual(["repo mentions Zcash", "one source, not a catalogue entry"]);
  });

  it("a stale repo is out unless another source corroborates it", () => {
    const stale = {
      ...base,
      sources: ["github"],
      strongest: "topic",
      page: null,
      repo: { archived: false, pushedAt: old },
    };
    expect(triage(stale, NOW).bucket).toBe("likely-out");
    expect(triage({ ...stale, sources: ["github", "zechub"] }, NOW).bucket).toBe("needs-look");
  });

  it("an active topic repo corroborated by a crate dependency is likely in", () => {
    expect(
      triage(
        {
          ...base,
          sources: ["crates", "github"],
          strongest: "dependent",
          page: null,
          repo: { archived: false, pushedAt: recent },
        },
        NOW,
      ).bucket,
    ).toBe("likely-in");
  });
});

describe("triage — forks", () => {
  it("a fork of a Zcash crate is never likely in on its own", () => {
    const t = triage(
      {
        ...base,
        sources: ["crates", "github"],
        strongest: "dependent",
        page: null,
        repo: { archived: false, pushedAt: recent, fork: true },
      },
      NOW,
    );
    expect(t.bucket).toBe("needs-look");
    expect(t.reasons).toContain("fork of another repo");
  });
});
