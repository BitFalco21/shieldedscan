import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every pill is a `Badge`. `BADGE_BASE` is exported so tests can pin the shared size; only
 * `Badge.tsx` may build a pill from it, so a caller cannot compose it with colours of its own
 * and escape `Badge`'s list of tones.
 */

const SRC = resolve(process.cwd(), "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== "__tests__") walk(p, out);
    } else if (/\.tsx?$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

describe("BADGE_BASE", () => {
  it("is composed into a pill by Badge alone", () => {
    const offenders = walk(SRC)
      .map((file) => relative(SRC, file))
      .filter((file) => file !== "components/Badge.tsx")
      .filter((file) => readFileSync(join(SRC, file), "utf8").includes("BADGE_BASE"));
    expect(offenders).toEqual([]);
  });
});
