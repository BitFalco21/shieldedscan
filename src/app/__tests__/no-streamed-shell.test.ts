import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A page whose essential read fails must answer 500, which holds only while the failure is
 * thrown in the shell: under a Suspense boundary Next has already committed 200, and the edge
 * would store the error as the page (ARCHITECTURE.md, "Caching and freshness").
 */
describe("no Suspense boundary above a page", () => {
  const appDir = join(process.cwd(), "src", "app");
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? walk(path) : [path];
    });
  const files = walk(appDir);

  it("has no loading.tsx anywhere", () => {
    expect(files.filter((f) => /[/\\]loading\.(t|j)sx?$/.test(f))).toEqual([]);
  });

  it("has no Suspense in any layout or template", () => {
    const shells = files.filter((f) => /[/\\](layout|template)\.(t|j)sx?$/.test(f));
    expect(shells.length).toBeGreaterThan(0);
    for (const file of shells) expect(readFileSync(file, "utf8"), file).not.toMatch(/<Suspense\b/);
  });
});
