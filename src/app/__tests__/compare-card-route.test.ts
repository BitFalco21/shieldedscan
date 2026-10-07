import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "../compare/card/route";

const call = (q: string) => GET(new NextRequest(`http://localhost/compare/card${q}`));

describe("GET /compare/card", () => {
  it("sends an unknown or non-canonical asset to the static site card, uncached", async () => {
    for (const q of ["?vs=not-a-real-asset", "?vs=Bitcoin", "?vs=%20bitcoin", "?vs=<x>"]) {
      const res = await call(q);
      expect(res.status, q).toBe(302);
      expect(res.headers.get("location"), q).toBe("http://localhost/og.png");
      expect(res.headers.get("cache-control"), q).toBe("no-store");
    }
  });

  it("still renders a real comparison", async () => {
    const res = await call("?vs=bitcoin");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/png");
  });
});
