import { describe, expect, it } from "vitest";
import { ZNS_SITE_URL, znsExplorerHref } from "@/lib/links";

describe("znsExplorerHref", () => {
  it("deep-links the registry's explorer to one name, encoded", () => {
    expect(znsExplorerHref("zenith")).toBe(`${ZNS_SITE_URL}/explorer?search=zenith`);
    expect(znsExplorerHref("a b")).toBe(`${ZNS_SITE_URL}/explorer?search=a%20b`);
  });
});
