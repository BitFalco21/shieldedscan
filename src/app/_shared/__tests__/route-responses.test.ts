import { describe, expect, it } from "vitest";
import { LIVE_POLL_CACHE_CONTROL, testnetAbsent } from "@/app/_shared/route-responses";

describe("route responses", () => {
  it("answers a mainnet-only endpoint on testnet with a JSON 404", async () => {
    const res = testnetAbsent();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
  });

  it("caches a polled endpoint briefly at the CDN, with no stale-while-revalidate", () => {
    expect(LIVE_POLL_CACHE_CONTROL).toBe("public, s-maxage=5");
  });
});
