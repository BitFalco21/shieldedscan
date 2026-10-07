import { describe, expect, it } from "vitest";
import { extractLinks } from "../lib/markdown-links.mjs";

/** The real shape of ZecHub's site/Using_Zcash/Wallets.md, read 2026-09-27, trimmed. */
const WALLETS = `# Wallets

## [Zingo!](https://www.zingolabs.org/)
![logo](/content-images/zingocard-9a2546668d.webp "Zingo!")
- Devices: Mobile | Desktop
- Pools: Transparent | Sapling | Ironwood
- Ironwood: Ready

---

## [Edge](https://edge.app)
- Pools: Transparent | Sapling

See also the [ZIP 316 spec](https://zips.z.cash/zip-0316) for addresses.
`;

describe("extractLinks", () => {
  const { entries, mentions } = extractLinks(WALLETS);

  it("reads a heading link as a catalogue ENTRY with its bullet properties", () => {
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      name: "Zingo!",
      url: "https://www.zingolabs.org/",
      section: "Wallets",
      props: {
        Devices: ["Mobile", "Desktop"],
        Pools: ["Transparent", "Sapling", "Ironwood"],
        Ironwood: ["Ready"],
      },
    });
    expect(entries[1]?.props).toEqual({ Pools: ["Transparent", "Sapling"] });
  });

  it("never reads an image as a link", () => {
    expect([...entries, ...mentions].some((l) => l.url.includes("content-images"))).toBe(false);
  });

  it("keeps an inline link as a MENTION, separate from the entries", () => {
    expect(mentions).toEqual([
      { text: "ZIP 316 spec", url: "https://zips.z.cash/zip-0316", section: "Wallets" },
    ]);
  });

  it("stops attaching bullets once the next heading starts", () => {
    const { entries: e } = extractLinks(
      "## [A](https://a.example)\n- Pools: Sapling\n## Other\n- Pools: Orchard\n",
    );
    expect(e).toHaveLength(1);
    expect(e[0]?.props).toEqual({ Pools: ["Sapling"] });
  });
});
