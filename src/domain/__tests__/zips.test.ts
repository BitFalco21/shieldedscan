import { describe, expect, it } from "vitest";
import { ZIP_SECTIONS, sortZips, zipCanonicalUrl, zipSectionOf, zipStatusKind } from "../zips";

describe("zipStatusKind", () => {
  it("classifies every plain status ZIP 0 defines", () => {
    expect(zipStatusKind("Final")).toBe("final");
    expect(zipStatusKind("Active")).toBe("active");
    expect(zipStatusKind("Proposed")).toBe("proposed");
    expect(zipStatusKind("Draft")).toBe("draft");
    expect(zipStatusKind("Reserved")).toBe("reserved");
    expect(zipStatusKind("Withdrawn")).toBe("withdrawn");
    expect(zipStatusKind("Rejected")).toBe("rejected");
    expect(zipStatusKind("Obsolete")).toBe("obsolete");
  });

  it("classifies ZIP 214's multi-revision line by its strongest status word", () => {
    // The real header, verbatim. The string is kept whole for display; the KIND only
    // drives sectioning, and a ZIP with any Final/Active revision is in force.
    const status = "[Revision 0: Canopy, Revision 1: NU6] Final, [Revision 2: NU6.1] Proposed";
    expect(zipStatusKind(status)).toBe("final");
  });

  it("matches whole words only — 'Finalising' is not Final", () => {
    expect(zipStatusKind("Finalising")).toBe("unrecognised");
  });

  it("returns unrecognised for a status the set does not carry", () => {
    expect(zipStatusKind("Percolating")).toBe("unrecognised");
    expect(zipStatusKind("")).toBe("unrecognised");
  });
});

describe("zipCanonicalUrl", () => {
  it("builds the canonical URL from the number alone, zero-padded to four digits", () => {
    expect(zipCanonicalUrl(0)).toBe("https://zips.z.cash/zip-0000");
    expect(zipCanonicalUrl(213)).toBe("https://zips.z.cash/zip-0213");
    expect(zipCanonicalUrl(1015)).toBe("https://zips.z.cash/zip-1015");
  });
});

describe("zipSectionOf", () => {
  it("files every kind into exactly one of the four sections", () => {
    expect(zipSectionOf("final")).toBe("in-force");
    expect(zipSectionOf("active")).toBe("in-force");
    expect(zipSectionOf("proposed")).toBe("proposed");
    expect(zipSectionOf("draft")).toBe("draft");
    expect(zipSectionOf("reserved")).toBe("draft");
    expect(zipSectionOf("withdrawn")).toBe("retired");
    expect(zipSectionOf("rejected")).toBe("retired");
    expect(zipSectionOf("obsolete")).toBe("retired");
    // An unrecognised status is a status the ZIP editors invented after this build
    // shipped. It must stay VISIBLE (dropping it silently shrinks the index), and the
    // least wrong home is the draft section, whose heading claims the least.
    expect(zipSectionOf("unrecognised")).toBe("draft");
  });

  it("declares the sections in render order", () => {
    expect(ZIP_SECTIONS.map((s) => s.id)).toEqual(["in-force", "proposed", "draft", "retired"]);
  });
});

describe("sortZips", () => {
  const entry = (zip: number, created: string | null) => ({
    zip,
    title: `ZIP ${zip}`,
    status: "Final",
    statusKind: "final" as const,
    category: null,
    created,
  });
  const rows = [
    entry(1, "2020-01-01"),
    entry(2, null),
    entry(3, "2024-06-01"),
    entry(4, "2016-10-28"),
  ];

  it("number order is ascending by ZIP number", () => {
    expect(sortZips(rows, "number").map((z) => z.zip)).toEqual([1, 2, 3, 4]);
  });

  it("newest puts the most recent Created first and undated rows LAST", () => {
    // An unknown date is not a claim about age in either direction — the row keeps its
    // place at the end rather than being pretended newest or oldest.
    expect(sortZips(rows, "newest").map((z) => z.zip)).toEqual([3, 1, 4, 2]);
  });

  it("oldest puts the earliest Created first and undated rows still LAST", () => {
    expect(sortZips(rows, "oldest").map((z) => z.zip)).toEqual([4, 1, 3, 2]);
  });

  it("ties on a date break by ZIP number, and the input is not mutated", () => {
    const tied = [entry(9, "2020-01-01"), entry(5, "2020-01-01")];
    expect(sortZips(tied, "newest").map((z) => z.zip)).toEqual([5, 9]);
    expect(tied.map((z) => z.zip)).toEqual([9, 5]);
  });
});
