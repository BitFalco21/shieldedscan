import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ECOSYSTEM_ENTRIES } from "@/domain/ecosystem";
import { ECOSYSTEM_LOGOS } from "../logos.generated";

const dir = join(process.cwd(), "public/ecosystem/logos");
const files = new Set(
  readdirSync(dir)
    .filter((f) => f.endsWith(".png"))
    .map((f) => f.slice(0, -4)),
);

describe("ecosystem logos", () => {
  it("points only at icons that are committed, so no mark renders as a broken image", () => {
    for (const id of ECOSYSTEM_LOGOS) expect(files.has(id), `${id}.png missing`).toBe(true);
  });

  it("commits no icon the page does not use and none for a project it does not list", () => {
    const ids = new Set(ECOSYSTEM_ENTRIES.map((e) => e.id));
    for (const f of files) {
      expect(ECOSYSTEM_LOGOS.has(f), `${f}.png is not in the manifest`).toBe(true);
      expect(ids.has(f), `${f}.png belongs to no entry`).toBe(true);
    }
  });
});
