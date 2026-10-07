import { describe, expect, it } from "vitest";
import { draftCategory } from "../lib/category.mjs";

const page = (path: string) => `https://github.com/ZecHub/zechub/blob/main/site/${path}`;

describe("draftCategory", () => {
  it("reads the category off the ZecHub page that listed the project", () => {
    expect(
      draftCategory({
        mentions: [{ source: "zechub", strength: "entry", where: page("Using_Zcash/Wallets.md") }],
      }),
    ).toEqual({ category: "wallet", basis: "ZecHub entry: Using_Zcash/Wallets.md" });
    expect(
      draftCategory({
        mentions: [
          {
            source: "zechub",
            strength: "mention",
            where: page("Using_Zcash/Zcash_Mining_Pools.md"),
          },
        ],
      }).category,
    ).toBe("mining");
  });

  it("a catalogue entry outranks a crate dependency — a wallet with a crate is a wallet", () => {
    expect(
      draftCategory({
        mentions: [
          { source: "crates", strength: "dependent" },
          { source: "zechub", strength: "entry", where: page("Using_Zcash/Wallets.md") },
        ],
      }).category,
    ).toBe("wallet");
  });

  it("a GitHub topic outranks a bare wiki mention", () => {
    expect(
      draftCategory({
        mentions: [
          {
            source: "zechub",
            strength: "mention",
            where: page("Zcash_Community/Community_Projects.md"),
          },
          { source: "github", strength: "topic", topic: "zcash-wallet" },
        ],
      }).category,
    ).toBe("wallet");
  });

  it("a crate dependency alone drafts a library", () => {
    expect(
      draftCategory({ mentions: [{ source: "crates", strength: "dependent" }] }).category,
    ).toBe("library");
  });

  it("says unsorted rather than guessing", () => {
    expect(
      draftCategory({
        mentions: [{ source: "zechub", strength: "mention", where: page("Research/FAQ.md") }],
      }),
    ).toEqual({ category: "unsorted", basis: "no source says what it is" });
  });
});
