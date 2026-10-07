import { describe, expect, it } from "vitest";
import { hasDotSegment } from "../path-segments";

describe("hasDotSegment", () => {
  it("finds dot segments, plain or encoded", () => {
    for (const path of [
      "/chain/addresses/../activity",
      "/v1/transactions/./privacy",
      "/v1/addresses/%2e%2e/transactions",
      "/v1/addresses/.%2E/transactions",
      "/chain/social/post/daily/..",
    ]) {
      expect(hasDotSegment(path)).toBe(true);
    }
  });

  it("leaves ordinary paths and query strings alone", () => {
    for (const path of [
      "/v1/blocks/3428150",
      "/v1/search?q=../x",
      "/chain/zns/name/my.name",
      "/v1/addresses/t1abc/transactions?cursor=a..b",
      "/v1/analytics/activity?from=2026-01-01&to=2026-02-01",
    ]) {
      expect(hasDotSegment(path)).toBe(false);
    }
  });
});
