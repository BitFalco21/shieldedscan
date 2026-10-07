import { describe, expect, it } from "vitest";
import { GET } from "../api/learn/route";
import { LEARN_EXAMPLE_SHAPES, parseLearnResponse } from "@/lib/learn-lookup";

/**
 * `/api/learn` at its HTTP boundary, against the fixture data source (no API configured in
 * tests). It proves the contract — the echo, the headers, the shapes — and that the client's own
 * parser accepts what the route sends, so a field renamed on one side fails here.
 */

const call = (query: string) => GET(new Request(`http://localhost/api/learn?${query}`));

/** Fully shielded Orchard transaction from src/fixtures/transactions.ts (also in e2e/surface.ts). */
const SHIELDED_TXID = "a3f29c4e".padEnd(64, "0");

describe("GET /api/learn", () => {
  it("is never cached: a reader checks a transaction seconds after sending it", async () => {
    const response = await call(`txid=${SHIELDED_TXID}`);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("answers a known transaction with its shape, echoing the question", async () => {
    const body = await (await call(`txid=${SHIELDED_TXID}`)).json();
    expect(body.txid).toBe(SHIELDED_TXID);
    expect(body.status).toBe("found");
    const parsed = parseLearnResponse(body, { txid: SHIELDED_TXID });
    expect(parsed?.tx?.shape).toBe("shielded");
  });

  it("says missing for a well-formed id the chain does not have, never an error", async () => {
    const missing = "f".repeat(64);
    const body = await (await call(`txid=${missing}`)).json();
    expect(body).toMatchObject({ txid: missing, status: "missing", tx: null });
  });

  it("refuses a malformed id before reaching the data source", async () => {
    const body = await (await call("txid=not-a-txid")).json();
    expect(body).toMatchObject({ status: "invalid", tx: null });
  });

  it("refuses a request that asks nothing", async () => {
    expect((await call("")).status).toBe(400);
  });

  it.each(LEARN_EXAMPLE_SHAPES)("finds a real example of a %s transaction", async (shape) => {
    const body = await (await call(`example=${shape}`)).json();
    const parsed = parseLearnResponse(body, { example: shape });
    expect(parsed, JSON.stringify(body).slice(0, 200)).not.toBeNull();
    expect(parsed!.status).toBe("found");
    expect(parsed!.tx!.shape).toBe(shape);
  });

  it("is rejected by the client when the echo answers a different question", async () => {
    const body = await (await call(`txid=${SHIELDED_TXID}`)).json();
    expect(parseLearnResponse(body, { txid: "e".repeat(64) })).toBeNull();
    expect(parseLearnResponse(body, { example: "shielded" })).toBeNull();
  });
});
