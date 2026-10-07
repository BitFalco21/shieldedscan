// server/__tests__/zips-parse.test.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ZIP_FILE_RE, parseZipFile, parseZipTree } from "../zips";

const capture = (name: string): string =>
  readFileSync(join(__dirname, "fixtures", "zip-headers", name), "utf8");

describe("parseZipTree", () => {
  it("keeps only numbered ZIP documents — no drafts, no SVGs, no directories", () => {
    const body = {
      tree: [
        { path: "zips/zip-0213.rst", type: "blob" },
        { path: "zips/zip-0234.md", type: "blob" },
        // Companion assets live in the SAME directory; the anchored extension excludes them.
        { path: "zips/zip-0032-sapling-internal-key-derivation.svg", type: "blob" },
        { path: "zips/draft-arya-deploy-nu7.md", type: "blob" },
        { path: "zips/zip-0999.rst", type: "tree" },
        { path: "README.rst", type: "blob" },
      ],
    };
    expect(parseZipTree(body)).toEqual(["zips/zip-0213.rst", "zips/zip-0234.md"]);
  });

  it("throws on an unrecognised body rather than answering with an empty list", () => {
    expect(() => parseZipTree({ trees: [] })).toThrow();
    expect(() => parseZipTree(null)).toThrow();
  });

  it("dedupes by ZIP number when an upstream rst->md conversion carries both extensions", () => {
    const body = {
      tree: [
        { path: "zips/zip-0227.rst", type: "blob" },
        { path: "zips/zip-0227.md", type: "blob" },
        { path: "zips/zip-0213.rst", type: "blob" },
      ],
    };
    const paths = parseZipTree(body);
    const forZip227 = paths.filter((p) => /zip-0227\./.test(p));
    expect(forZip227).toHaveLength(1);
    // Sorted lexically, "zip-0227.md" precedes "zip-0227.rst" ("m" < "r"), so the .md path
    // is the one kept.
    expect(forZip227[0]).toBe("zips/zip-0227.md");
  });
});

describe("parseZipFile", () => {
  it("parses an .rst header (the indented literal block after ::)", () => {
    const entry = parseZipFile("zips/zip-0213.rst", capture("zip-0213.rst.head"));
    expect(entry).toEqual({
      zip: 213,
      title: "Shielded Coinbase",
      status: "Final",
      statusKind: "final",
      category: "Consensus",
      created: "2019-03-30",
    });
  });

  it("parses an .md header (fenced, unindented) through continuation lines and empty values", () => {
    const entry = parseZipFile("zips/zip-0234.md", capture("zip-0234.md.head"));
    expect(entry?.zip).toBe(234);
    expect(entry?.title).toBe("Network Sustainability Mechanism: Issuance Smoothing");
    expect(entry?.statusKind).toBe("draft");
    // The Owners continuation line must not bleed into any field we keep.
    expect(entry?.title).not.toContain("Zooko");
  });

  it("keeps a Reserved ZIP that has no Created and no Owners", () => {
    const entry = parseZipFile("zips/zip-0002.rst", capture("zip-0002.rst.head"));
    expect(entry).toEqual({
      zip: 2,
      title: "Design Considerations for Network Upgrades",
      status: "Reserved",
      statusKind: "reserved",
      category: "Informational",
      created: null,
    });
  });

  it("takes the number from the FILENAME, never from the file's own ZIP: line", () => {
    // A file claiming to be ZIP 9999 in its text is still whatever its filename says.
    const entry = parseZipFile("zips/zip-0002.rst", capture("zip-0213.rst.head"));
    expect(entry?.zip).toBe(2);
  });

  it("sanitises hostile header text and refuses to invent what it cannot verify", () => {
    const entry = parseZipFile("zips/zip-0666.rst", capture("zip-0666.rst.head"));
    expect(entry).not.toBeNull();
    // Control characters stripped, whitespace collapsed, length capped at 200 — plus the
    // one-character ellipsis that MARKS the cut, so an elided value cannot read as one
    // somebody wrote.
    expect(entry!.title.length).toBeLessThanOrEqual(201);
    expect(entry!.title.endsWith("\u2026")).toBe(true);
    expect(entry!.title).not.toMatch(/[\x00-\x1f\x7f-\x9f�]/u);
    // Unknown status: kept verbatim (sanitised), classified unrecognised — never dropped.
    expect(entry!.status).toBe("Percolating");
    expect(entry!.statusKind).toBe("unrecognised");
    // An impossible date is omitted, not rolled over into March.
    expect(entry!.created).toBeNull();
    // Category is text on a page, never markup — the angle brackets survive as characters
    // (React escapes them); what must be gone is anything unprintable, checked above.
  });

  it("keeps a multi-revision Status line WHOLE — the real ZIP 214 header", () => {
    // A multi-revision Status line is longer than the old field cap; the case is the upstream
    // header itself, so the parser is tested where the transformation happens.
    const entry = parseZipFile("zips/zip-0214.rst", capture("zip-0214.rst.head"));
    expect(entry?.status).toBe(
      "[Revision 0: Canopy, Revision 1: NU6] Final, [Revision 2: NU6.1] Proposed",
    );
    // Nothing is elided, so nothing is marked as elided.
    expect(entry?.status).not.toContain("\u2026");
    // Classification reads the strongest status word, which survived the truncation too —
    // which is precisely why the cut went unnoticed. Pinned so a repair cannot move it.
    expect(entry?.statusKind).toBe("final");
    // The Owners continuation line must not bleed into a field we keep.
    expect(entry?.title).toBe("Consensus rules for a Zcash Development Fund");
    expect(entry?.category).toBe("Consensus");
  });

  it("keeps every revision's status word — the real ZIP 317 header", () => {
    // 66 characters: the old cap rendered this as "[Revision 2] Dra", a status nobody
    // wrote, on the live page.
    const entry = parseZipFile("zips/zip-0317.rst", capture("zip-0317.rst.head"));
    expect(entry?.status).toBe(
      "[Revision 0] Active, [Revision 1: NU6.3] Draft, [Revision 2] Draft",
    );
    expect(entry?.statusKind).toBe("active");
    // Credits' continuation lines sit between Owners and Status; neither may bleed in.
    expect(entry?.status).not.toMatch(/Virza|Gindre/);
    expect(entry?.category).toBe("Standards / Wallet");
  });

  it("MARKS a cut rather than manufacturing a value nobody wrote", () => {
    // The cap is a runaway bound, not the display grain: the longest real Status line is
    // 73 characters. Reaching 200 means the header is anomalous, and an ellipsis is what
    // makes that legible instead of a plausible-looking status.
    const long = `::\n\n  ZIP: 8\n  Title: T\n  Status: ${"Final ".repeat(60)}\n`;
    const entry = parseZipFile("zips/zip-0008.rst", long);
    expect(entry?.status).toHaveLength(201);
    expect(entry?.status.endsWith("\u2026")).toBe(true);
  });

  it("returns null for a file with no parseable header", () => {
    expect(parseZipFile("zips/zip-0500.rst", "not a zip file at all")).toBeNull();
    expect(parseZipFile("zips/zip-0500.rst", "")).toBeNull();
  });

  it("returns null for a path that is not a numbered ZIP document", () => {
    expect(parseZipFile("zips/draft-foo.md", capture("zip-0213.rst.head"))).toBeNull();
  });

  it("requires Title and Status", () => {
    const noStatus = "::\n\n  ZIP: 7\n  Title: Something\n";
    expect(parseZipFile("zips/zip-0007.rst", noStatus)).toBeNull();
  });
});

describe("ZIP_FILE_RE", () => {
  it("anchors the extension so companion SVGs cannot match", () => {
    expect(ZIP_FILE_RE.test("zips/zip-0032.rst")).toBe(true);
    expect(ZIP_FILE_RE.test("zips/zip-0032-sapling-internal-key-derivation.svg")).toBe(false);
    expect(ZIP_FILE_RE.test("zips/zip-0048.md")).toBe(true);
  });
});
