import { describe, expect, it } from "vitest";
import {
  ECOSYSTEM_CATEGORIES,
  ECOSYSTEM_UPDATED_ON,
  ECOSYSTEM_ENTRIES,
  ecosystemHost,
} from "../ecosystem";

describe("ECOSYSTEM_ENTRIES", () => {
  it("gives every entry a unique slug id, a known category and a source", () => {
    const ids = new Set<string>();
    const known = new Set(ECOSYSTEM_CATEGORIES.map((c) => c.id));
    for (const e of ECOSYSTEM_ENTRIES) {
      expect(e.id, e.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(ids.has(e.id), `duplicate id ${e.id}`).toBe(false);
      ids.add(e.id);
      expect(known.has(e.category), e.id).toBe(true);
      expect(e.source.trim(), e.id).not.toBe("");
      expect(e.name.trim(), e.id).not.toBe("");
    }
  });

  it("links every entry to an https page with no query string and no duplicate target", () => {
    const seen = new Set<string>();
    for (const e of ECOSYSTEM_ENTRIES) {
      const u = new URL(e.url);
      expect(u.protocol, e.id).toBe("https:");
      // A query string is a tracking or locale parameter the catalogue happened to carry,
      // never part of the project's address.
      expect(u.search, e.id).toBe("");
      expect(seen.has(e.url), `two entries link ${e.url}`).toBe(false);
      seen.add(e.url);
    }
  });

  it("puts at least one project in every category, so no arc is drawn over nothing", () => {
    for (const c of ECOSYSTEM_CATEGORIES)
      expect(ECOSYSTEM_ENTRIES.filter((e) => e.category === c.id).length, c.id).toBeGreaterThan(0);
  });

  it("states the day the list was checked as a real calendar day", () => {
    expect(ECOSYSTEM_UPDATED_ON).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(new Date(`${ECOSYSTEM_UPDATED_ON}T00:00:00Z`).toISOString().slice(0, 10)).toBe(
      ECOSYSTEM_UPDATED_ON,
    );
  });

  it("lists this site exactly once, among the explorers", () => {
    const ours = ECOSYSTEM_ENTRIES.filter((e) => /shieldedscan/.test(e.url));
    expect(ours).toHaveLength(1);
    expect(ours[0]!.category).toBe("explorer");
  });
});

describe("ecosystemHost", () => {
  it("shows a site as its bare host and a repository with its path", () => {
    expect(ecosystemHost("https://www.kraken.com/")).toBe("kraken.com");
    expect(ecosystemHost("https://github.com/zcash/zips")).toBe("github.com/zcash/zips");
  });
});
