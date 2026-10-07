import { describe, expect, it } from "vitest";
import { GET } from "../api/resolve/route";
import { canonicalSearchQuery } from "@/domain";

describe("canonicalSearchQuery", () => {
  it("trims, and lowercases a 64-hex value only", () => {
    expect(canonicalSearchQuery("  3428150 ")).toBe("3428150");
    expect(canonicalSearchQuery("AB".repeat(32))).toBe("ab".repeat(32));
    expect(canonicalSearchQuery("Zenith")).toBe("Zenith");
  });
});

describe("GET /api/resolve", () => {
  it("refuses a non-canonical spelling without looking anything up", async () => {
    for (const q of [" 3428150", "3428150 ", "AB".repeat(32)]) {
      const res = await GET(new Request(`http://localhost/api/resolve?q=${encodeURIComponent(q)}`));
      expect(res.status, q).toBe(400);
      expect(res.headers.get("cache-control"), q).toBe("no-store");
      expect((await res.json()).found).toEqual([]);
    }
  });

  it("answers the canonical spelling", async () => {
    const res = await GET(new Request("http://localhost/api/resolve?q=3428150"));
    expect(res.status).toBe(200);
    expect((await res.json()).q).toBe("3428150");
  });
});
