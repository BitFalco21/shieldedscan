import { describe, expect, it } from "vitest";
import { isSameOriginPath } from "../safe-href";

describe("isSameOriginPath", () => {
  it("accepts ordinary internal paths", () => {
    for (const href of ["/", "/blocks", "/tx/abc?x=1#y", "/address/t1abc", "/search?q=a%20b"]) {
      expect(isSameOriginPath(href)).toBe(true);
    }
  });

  it("refuses hrefs a browser would send off-site", () => {
    for (const href of [
      "//evil.example",
      "/\\evil.example",
      "/\\\\evil.example",
      "/\t/evil.example",
      "/\n/evil.example",
      "/\r/evil.example",
      "\\/evil.example",
      "https://evil.example",
      "javascript:alert(1)",
      "evil.example",
      "",
    ]) {
      expect(isSameOriginPath(href)).toBe(false);
    }
  });

  it("confirms the refused forms really do leave the site in a URL parser", () => {
    // The point of the guard: these are not harmless typos, they resolve to another host.
    expect(new URL("/\\evil.example", "https://shieldedscan.xyz").host).toBe("evil.example");
    expect(new URL("/\t/evil.example", "https://shieldedscan.xyz").host).toBe("evil.example");
  });
});
