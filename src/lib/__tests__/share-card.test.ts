import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pageShareMetadata, siteShareImages } from "../share-card";

/**
 * Next replaces a parent segment's `openGraph` with a page's own, so a page that writes an
 * `openGraph` object without `images` previews with no picture at all. Pinned two ways: the
 * helper always carries the site image, and no route file writes an `openGraph` literal
 * that lacks one.
 */

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "__tests__" ? [] : routeFiles(path);
    return /\.(tsx|ts)$/.test(name) ? [path] : [];
  });
}

describe("share cards", () => {
  it("pageShareMetadata keeps the site image and sets both previews' words", () => {
    const m = pageShareMetadata("A title", "A description");
    expect(m.openGraph?.images).toEqual(siteShareImages);
    expect(m.openGraph?.title).toBe("A title");
    expect(m.twitter).toMatchObject({ title: "A title", description: "A description" });
  });

  it("no route writes an openGraph object without an image", () => {
    const offenders: string[] = [];
    for (const file of routeFiles(join(process.cwd(), "src/app"))) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/openGraph:\s*\{/g)) {
        // Walk to the matching brace so a nested object cannot end the scan early.
        let depth = 0;
        let end = m.index! + m[0].length - 1;
        for (; end < src.length; end++) {
          if (src[end] === "{") depth++;
          else if (src[end] === "}" && --depth === 0) break;
        }
        if (!/\bimages\b/.test(src.slice(m.index!, end))) offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});
