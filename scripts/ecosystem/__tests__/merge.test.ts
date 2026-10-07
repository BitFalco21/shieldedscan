import { describe, expect, it } from "vitest";
import { attachGrantMatches, isInternalLink, mergeItems } from "../lib/merge.mjs";

const zechubZingo = {
  source: "zechub",
  strength: "entry",
  name: "Zingo!",
  url: "https://www.zingolabs.org/",
};
const githubZingolib = {
  source: "github",
  strength: "topic",
  name: "zingolib",
  url: "https://zingolabs.org",
  repo: "https://github.com/zingolabs/zingolib",
};
const cratesZingolib = {
  source: "crates",
  strength: "dependent",
  name: "zingolib",
  url: "https://github.com/zingolabs/zingolib",
};

describe("mergeItems", () => {
  it("joins a site and a repository that one item names together", () => {
    const { candidates } = mergeItems([zechubZingo, githubZingolib, cratesZingolib]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.key).toBe("zingolabs.org");
    expect(candidates[0]?.keys).toEqual(["github.com/zingolabs/zingolib", "zingolabs.org"]);
    expect(candidates[0]?.sources).toEqual(["crates", "github", "zechub"]);
    expect(candidates[0]?.strongest).toBe("entry");
  });

  it("never unions through an umbrella site many repositories share", () => {
    const repos = ["librustzcash", "orchard", "zips"].map((r) => ({
      source: "github",
      strength: "topic",
      name: r,
      url: "https://z.cash",
      repo: `https://github.com/zcash/${r}`,
    }));
    const { candidates, umbrellas } = mergeItems(repos);
    expect(umbrellas).toEqual(["z.cash"]);
    expect(candidates.map((c) => c.key).sort()).toEqual([
      "github.com/zcash/librustzcash",
      "github.com/zcash/orchard",
      "github.com/zcash/zips",
    ]);
    expect(candidates.every((c) => c.umbrellas.includes("z.cash"))).toBe(true);
  });

  it("never takes a generic link text as the name", () => {
    const { candidates } = mergeItems([
      { source: "zechub", strength: "entry", name: "here", url: "https://zgo.cash" },
      { source: "zechub", strength: "mention", name: "ZGo", url: "https://zgo.cash/app" },
      { source: "zechub", strength: "mention", name: "here", url: "https://zgo.cash" },
      { source: "zechub", strength: "mention", name: "Visit ->", url: "https://zgo.cash" },
    ]);
    expect(candidates[0]?.name).toBe("ZGo");
  });

  it("counts a wiki's links to its own pages as internal, not as lost projects", () => {
    const { candidates, internal, unkeyable } = mergeItems([
      { source: "zechub", strength: "mention", name: "wallets", url: "/using-zcash/wallets" },
      { source: "zechub", strength: "mention", name: "a", url: "#a" },
      { source: "zechub", strength: "mention", name: "zaino", url: "../Zaino.md" },
    ]);
    expect(candidates).toHaveLength(0);
    expect(internal).toBe(3);
    expect(unkeyable).toHaveLength(0);
  });

  it("reads schemes correctly when deciding what is internal", () => {
    expect(isInternalLink("/dex")).toBe(true);
    expect(isInternalLink("https://edge.app")).toBe(false);
    expect(isInternalLink("mailto:x@y.z")).toBe(false);
  });
});

describe("attachGrantMatches", () => {
  const grants = [
    {
      grant: "Zingo Labs wallet development 2026",
      grantee: "Zingo Labs",
      status: "open",
      lastPaid: "2026-09-01",
    },
    {
      grant: "Edge-case fuzzing for Zebra",
      grantee: "someone",
      status: "completed",
      lastPaid: "2026-03-01",
    },
  ];

  it("matches whole words only, and skips names too short to mean anything", () => {
    const [zingo, zgo] = attachGrantMatches([{ name: "Zingo Labs" }, { name: "ZGo" }], grants);
    expect(zingo?.possibleGrants.map((g) => g.grantee)).toEqual(["Zingo Labs"]);
    expect(zgo?.possibleGrants).toEqual([]);
  });

  it("skips protocol words, which name every project and so none", () => {
    // A copy of Zebra named "zebra" would otherwise inherit every Zebra grant.
    const [zeb, zcash] = attachGrantMatches([{ name: "Zebra" }, { name: "zcash" }], grants);
    expect(zeb?.possibleGrants).toEqual([]);
    expect(zcash?.possibleGrants).toEqual([]);
  });
});
