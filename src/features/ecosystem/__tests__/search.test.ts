import { describe, expect, it } from "vitest";
import { ECOSYSTEM_ENTRIES } from "@/domain/ecosystem";
import { searchEntries } from "../search";

describe("searchEntries", () => {
  it("finds nothing for an empty query rather than everything", () => {
    expect(searchEntries(ECOSYSTEM_ENTRIES, "  ")).toEqual([]);
  });

  it("ranks a name that starts with the query above one that merely contains it", () => {
    const names = searchEntries(ECOSYSTEM_ENTRIES, "zcash").map((e) => e.name);
    const firstContains = names.findIndex((n) => !n.toLowerCase().startsWith("zcash"));
    const lastStarts = names.map((n) => n.toLowerCase().startsWith("zcash")).lastIndexOf(true);
    expect(lastStarts).toBeLessThan(firstContains === -1 ? Infinity : firstContains);
  });

  it("ignores case and accents", () => {
    expect(searchEntries(ECOSYSTEM_ENTRIES, "KRÂKEN").map((e) => e.id)).toContain("kraken");
  });

  it("matches a category by its label, after the names", () => {
    const hits = searchEntries(ECOSYSTEM_ENTRIES, "mining");
    expect(hits.length).toBeGreaterThanOrEqual(
      ECOSYSTEM_ENTRIES.filter((e) => e.category === "mining").length,
    );
  });

  it("stops at the limit it is given", () => {
    expect(searchEntries(ECOSYSTEM_ENTRIES, "a", 5)).toHaveLength(5);
  });
});
