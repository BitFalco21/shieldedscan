import { describe, expect, it } from "vitest";
import { cursorNavHrefs } from "@/app/_shared/cursor-nav";
import { parseTxListFilter } from "@/domain";
import { txsHref } from "../txsHref";

describe("txsHref", () => {
  it("names only what narrows: a kind, a pool, or nothing", () => {
    expect(txsHref({ kind: "all", pool: null })).toBe("/txs");
    expect(txsHref({ kind: "shielding", pool: null })).toBe("/txs?kind=shielding");
    expect(txsHref({ kind: "all", pool: "sprout" })).toBe("/txs?pool=sprout");
  });

  it("round-trips through the parser", () => {
    for (const url of ["/txs", "/txs?kind=coinbase", "/txs?pool=ironwood"]) {
      const q = new URL(url, "https://x").searchParams;
      const filter = parseTxListFilter(q.get("kind") ?? undefined, q.get("pool") ?? undefined);
      expect(txsHref(filter)).toBe(url);
    }
  });

  it("keeps the pool on every pagination link", () => {
    const hrefs = cursorNavHrefs({ nextCursor: "N", prevCursor: "P" }, (step) =>
      txsHref({ kind: "all", pool: "orchard" }, step),
    );
    for (const href of Object.values(hrefs)) expect(href).toMatch(/^\/txs\?pool=orchard/);
    expect(hrefs.olderHref).toBe("/txs?pool=orchard&before=N");
  });
});
