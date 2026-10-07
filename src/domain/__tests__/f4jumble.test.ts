import { describe, expect, it } from "vitest";
import { f4jumble, f4jumbleInverse } from "../encoding/f4jumble";
// Official vectors: github.com/zcash-hackworks/zcash-test-vectors,
// test-vectors/json/f4jumble.json, fetched 2026-08-17. Rows 0–1 are headers.
import vectors from "../__fixtures__/f4jumble.json";

const toBytes = (h: string) =>
  Uint8Array.from({ length: h.length / 2 }, (_, i) => parseInt(h.slice(i * 2, i * 2 + 2), 16));
const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

const rows = (vectors as unknown as string[][]).slice(2) as [string, string][];

describe("F4Jumble against every official ZIP 316 vector", () => {
  it("has vectors to test against", () => {
    expect(rows.length).toBeGreaterThan(5);
  });

  it("forward transform matches every vector", () => {
    for (const [normal, jumbled] of rows) {
      expect(toHex(f4jumble(toBytes(normal))!)).toBe(jumbled);
    }
  });

  it("inverse transform matches every vector", () => {
    for (const [normal, jumbled] of rows) {
      expect(toHex(f4jumbleInverse(toBytes(jumbled))!)).toBe(normal);
    }
  });

  it("refuses inputs outside 38..4,194,368 bytes", () => {
    expect(f4jumble(new Uint8Array(37))).toBeNull();
    expect(f4jumbleInverse(new Uint8Array(37))).toBeNull();
    expect(f4jumble(new Uint8Array(38))).not.toBeNull();
  });
});
