import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/**
 * Exactly one file may import `next/link`: the wrapper in `components/Link.tsx`, which turns
 * prefetching off. Same shape as the inline-style gate. The needle is built at runtime so this
 * file does not match itself.
 */
describe("next/link is imported in exactly one place", () => {
  it("only components/Link.tsx imports next/link", () => {
    const needle = `from "next/${"link"}"`;
    const out = execSync(`grep -rlF '${needle}' src`, { encoding: "utf8" })
      .trim()
      .split("\n")
      .filter(Boolean);
    expect(out).toEqual(["src/components/Link.tsx"]);
  });
});
