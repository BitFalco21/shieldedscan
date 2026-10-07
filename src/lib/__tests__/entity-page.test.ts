import { describe, expect, it } from "vitest";
import { entityHrefIsRoutable } from "../entity-page";

const TXID = "a".repeat(64);
const ADDRESS = "t1Mv595nLBUxJxKAfAZAG9RjhibExEErmMf";

describe("entityHrefIsRoutable", () => {
  it("refuses the identifier the model invented", () => {
    // An identifier a model invented, as it would appear in an answer link.
    expect(entityHrefIsRoutable("/tx/0d%20gitignore")).toBe(false);
    expect(entityHrefIsRoutable("/tx/0d gitignore")).toBe(false);
    expect(entityHrefIsRoutable("/tx/the-latest-transaction")).toBe(false);
    expect(entityHrefIsRoutable("/block/soon")).toBe(false);
    expect(entityHrefIsRoutable("/address/my%20wallet")).toBe(false);
  });

  it("accepts every well-formed identifier, on the route that can name it", () => {
    expect(entityHrefIsRoutable(`/tx/${TXID}`)).toBe(true);
    expect(entityHrefIsRoutable("/block/3428150")).toBe(true);
    // A 64-hex string names a txid or a block hash and the string alone cannot say which,
    // so both routes accept it. Resolving that ambiguity is `/search`'s job.
    expect(entityHrefIsRoutable(`/block/${TXID}`)).toBe(true);
    expect(entityHrefIsRoutable(`/address/${ADDRESS}`)).toBe(true);
    expect(entityHrefIsRoutable("/address/zs1exampleexampleexampleexample")).toBe(true);
  });

  it("judges a height by the classifier, not by Number()", () => {
    // `Number()` accepts both and would mint `/block/-12` as a link.
    expect(entityHrefIsRoutable("/block/-12")).toBe(false);
    expect(entityHrefIsRoutable("/block/1e9")).toBe(false);
  });

  it("requires the identifier to be the whole segment — an href is not a typed query", () => {
    // The classifier trims, which is right for a search box and wrong here: nothing trims an
    // href on the way to the data source, so `getBlock(" 7 ")` 404s. The classifier alone
    // reads all three of these as well-formed.
    expect(entityHrefIsRoutable("/block/%207%20")).toBe(false);
    expect(entityHrefIsRoutable(`/tx/${TXID}%20`)).toBe(false);
    expect(entityHrefIsRoutable(`/address/%20${ADDRESS}`)).toBe(false);
  });

  it("is narrow — it judges the three entity routes and nothing else", () => {
    // Non-entity pages carry no model-authored identifier, so they are none of its business.
    // A broad "does this route exist" check would be a second copy of the router.
    for (const href of ["/", "/analytics", "/api-docs", "/blocks", "/txs", "/cross-chain/flows"]) {
      expect(entityHrefIsRoutable(href), href).toBe(true);
    }
    // The list pages are not the detail pages: no trailing identifier, nothing to check.
    expect(entityHrefIsRoutable("/tx")).toBe(true);
    expect(entityHrefIsRoutable("/address")).toBe(true);
    // Off-site hrefs are the host allowlist's question, never this one's.
    expect(entityHrefIsRoutable("https://z.cash/anything")).toBe(true);
    expect(entityHrefIsRoutable("https://evil.example/tx/nonsense")).toBe(true);
  });

  it("reads the identifier a reader would see, past the query and the fragment", () => {
    expect(entityHrefIsRoutable(`/tx/${TXID}?utm=1`)).toBe(true);
    expect(entityHrefIsRoutable(`/tx/${TXID}#inputs`)).toBe(true);
    expect(entityHrefIsRoutable("/tx/nonsense?looks=fine")).toBe(false);
  });

  it("treats a malformed escape as what it is — not an identifier", () => {
    // `decodeURIComponent` throws on this; a thrown guard must not become an accepted link.
    expect(entityHrefIsRoutable("/tx/%zz")).toBe(false);
  });
});
