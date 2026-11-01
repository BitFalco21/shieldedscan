import { describe, expect, it } from "vitest";
import { GET } from "../api/supply/route";
import { parseSupplyLive } from "@/data/supply-payload";
import { LIVE_POLL_CACHE_CONTROL } from "@/app/_shared/route-responses";

/** The route at its HTTP boundary, against the fixture data source: the contract, not the data. */
describe("GET /api/supply", () => {
  it("returns a payload its own client-side parser accepts", async () => {
    // Checked against each other rather than a literal, so a one-sided rename fails.
    const parsed = parseSupplyLive(await (await GET()).json());
    expect(parsed).not.toBeNull();
    expect(parsed!.pools.length).toBe(6);
  });

  it("is shared through the CDN for the live window only", async () => {
    expect((await GET()).headers.get("Cache-Control")).toBe(LIVE_POLL_CACHE_CONTROL);
  });
});
