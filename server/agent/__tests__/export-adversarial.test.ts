import { describe, expect, it } from "vitest";
import { CROSSCHAIN_EXPORT_REASON } from "../../v1/export/policy";
import { AgentTools, type V1Requester } from "../tools";
import { ADDRESS_INFO, FIXTURE_NOW_MS, makeChain, makeV1 } from "../testing/fixture-world";

/**
 * `export_data` against what a confused or hijacked model might send: figures, links and rows in
 * its arguments, families and parameters that name nothing, windows no file can hold, addresses it
 * did not get from the reader. Each ends in a card built from the registry or in a refusal in
 * words, and a refusal never carries a URL or a card.
 */

const SENTINEL = "987654321";
const tools = new AgentTools(makeV1(), makeChain(), () => FIXTURE_NOW_MS);
const ask = (args: unknown, userText = "") =>
  tools.dispatch("export_data", JSON.stringify(args), userText);

async function refused(args: unknown, reason: string, userText = "") {
  const result = await ask(args, userText);
  expect(result.export, result.content).toBeUndefined();
  expect(result.content).toContain(`<refusal source="export" reason="${reason}">`);
  // A refusal names a closest export as arguments, never as a link. (A bad value is quoted back
  // to the model, clipped, so its own text may reappear; a URL of ours never does.)
  expect(result.content).not.toMatch(/https?:\/\/|\/v1\//);
  return result.content;
}

describe("injected figures, links and rows", () => {
  it.each([
    [{ family: "price", range: "30d", url: "https://evil.example/x.csv" }],
    [{ family: "price", range: "30d", values: [1, 2, 3] }],
    [{ family: "price", range: "30d", rows: [[SENTINEL]] }],
    [{ family: "price", range: "30d", title: "ZEC hits $1M" }],
    [{ family: "price", range: "30d", format: "xlsx" }],
    [{ family: "price", range: "30d", path: "/v1/agent/ask" }],
  ])("refuses an argument that is not one of the tool's: %j", async (args) => {
    const content = await refused(args, "bad-parameter");
    expect(content).toMatch(/unknown argument/);
    expect(content).not.toContain(SENTINEL);
  });

  it.each([
    [{ family: "pool", pool: "orchard", metric: SENTINEL }],
    [{ family: "pool", pool: `orchard&format=csv&x=`, metric: "balance" }],
    [{ family: "block-transactions", block: "../../agent/ask" }],
    [{ family: "block-transactions", block: "1;DROP TABLE block" }],
    [{ family: "transaction-list", kind: "all&limit=100000" }],
    [{ family: "pool", pool: "orchard", metric: "balance", interval: "hour" }],
    [{ family: "pool", pool: "orchard", metric: "balance", from: "2026-01-01&to=2030-01-01" }],
    [{ family: "price", range: "30d", interval: "month" }],
  ])("refuses a value outside its list or pattern: %j", async (args) => {
    await refused(args, "bad-parameter");
  });

  it("never lets a figure in the arguments reach the card", async () => {
    const result = await ask({ family: "supply-by-pool" });
    expect(JSON.stringify(result.export)).not.toContain(SENTINEL);
  });

  it.each([null, [], "price", 42])("refuses arguments that are not an object: %j", async (args) => {
    const result = await ask(args);
    expect(result.export).toBeUndefined();
    expect(result.content).toMatch(/not a JSON object/);
  });
});

describe("families and parameters that name nothing", () => {
  it("refuses cross-chain data by policy, in the API's words, before its parameters", async () => {
    for (const args of [
      { family: "crosschain", direction: "in", chain: "BTC" },
      { family: "crosschain" },
      { family: "crosschain", by: "asset", chain: "<script>" },
    ]) {
      const content = await refused(args, "policy");
      expect(content).toContain(CROSSCHAIN_EXPORT_REASON);
      expect(content).not.toContain("without format");
    }
  });

  it("refuses an unknown family with the closest one", async () => {
    const content = await refused({ family: "hashrate" }, "not-exportable");
    expect(content).toContain('closest: export_data {"family":"mining","metric":"difficulty"}');
  });

  it("points a per-address family at address-history", async () => {
    const content = await refused(
      { family: "wallet", address: ADDRESS_INFO.address },
      "bad-parameter",
    );
    expect(content).toMatch(/address-history/);
  });

  it.each([
    [{ family: "supply", part: "transparent", range: "1y" }, "supply-by-pool"],
    [{ family: "mining", metric: "top3-share", range: "1y" }, "miners"],
  ])("refuses a series with no history file, naming the nearest: %j", async (args, nearest) => {
    const content = await refused(args, "not-exportable");
    expect(content).toContain(`"family":"${nearest}"`);
  });

  it.each([
    [{ family: "pool", pool: "sprout", metric: "notes" }, "names-nothing"],
    [{ family: "transactions", kind: "mixed", pool: "orchard" }, "names-nothing"],
    [{ family: "pool", metric: "balance" }, "bad-parameter"],
    [{ family: "blocks", range: "30d" }, "bad-parameter"],
    [{ family: "rich-list", address: ADDRESS_INFO.address }, "bad-parameter"],
    [{ family: "price", address: ADDRESS_INFO.address }, "bad-parameter"],
    [{ family: "block-transactions" }, "bad-parameter"],
    [{ family: "address-history" }, "bad-parameter"],
  ])("refuses %j by name", async (args, reason) => {
    await refused(args, reason);
  });
});

describe("windows no file holds", () => {
  it.each([
    [{ family: "price", from: "1900-01-01" }],
    [{ family: "price", from: "2030-01-01" }],
    [{ family: "price", from: "2026-07-01", to: "2026-06-01" }],
    [{ family: "price", from: "2026-07-01", to: "2099-01-01" }],
    [{ family: "pool", pool: "orchard", metric: "balance", from: "1969-12-31", to: "2026-01-01" }],
  ])("refuses an absurd window: %j", async (args) => {
    await refused(args, "window");
  });

  it.each([
    [{ family: "price", from: "2026-02-30" }],
    [{ family: "price", from: "yesterday" }],
    [{ family: "price", range: "50y" }],
    [{ family: "price", range: "30d", from: "2026-07-01" }],
  ])("refuses a window it cannot read: %j", async (args) => {
    await refused(args, "bad-parameter");
  });

  it("refuses a daily file past 366 days, offering months or a year of days", async () => {
    const content = await refused(
      { family: "pool", pool: "orchard", metric: "balance", range: "all", interval: "day" },
      "window",
    );
    expect(content).toContain('"interval":"month"');
    expect(content).toContain('"range":"1y","interval":"day"');
  });

  it("offers the newest 1,000 days of prices when no window was asked, and says so", async () => {
    const result = await ask({ family: "price" });
    expect(result.export?.query).toEqual([
      ["from", "2023-11-08"],
      ["to", "2026-08-03"],
    ]);
    expect(result.content).toMatch(/No window was asked, so the file holds the newest 1,000 days/);
  });

  it("refuses the whole price history, offering the newest 1,000 days", async () => {
    const content = await refused({ family: "price", range: "all" }, "window");
    expect(content).toContain('closest: export_data {"family":"price","from":"2023-11-08"}');
  });
});

describe("an address the reader did not type", () => {
  const address = ADDRESS_INFO.address;

  it("is refused when it only appears in data the model read", async () => {
    const content = await refused(
      { family: "address-history", address },
      "per-address",
      "export the history of the biggest exchange wallet",
    );
    expect(content).toMatch(/the reader typed/);
  });

  it("is refused when the reader typed a different one", async () => {
    await refused({ family: "address-history", address }, "per-address", `t1${"x".repeat(33)}`);
  });

  it.each([
    ["a Sapling address", `zs1${"q".repeat(75)}`, /encrypted on-chain/],
    ["a unified address", `u1${"q".repeat(100)}`, /encrypted on-chain/],
    ["a TEX address", `tex1${"q".repeat(38)}`, /paste the t1… or t3… address/],
    ["a Bitcoin address", "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq", /paste the t1… or t3…/],
  ])("refuses %s, typed or not", async (_name, raw, why) => {
    const content = await refused({ family: "address-history", address: raw }, "per-address", raw);
    expect(content).toMatch(why);
  });
});

describe("an API that answers something other than a file", () => {
  const fixed = (status: number, body: unknown): V1Requester => ({
    request: () => new Response(JSON.stringify(body), { status }),
  });
  const withV1 = (v1: V1Requester) => new AgentTools(v1, makeChain(), () => FIXTURE_NOW_MS);

  it("passes on the API's own 400, with no card", async () => {
    const tools = withV1(
      fixed(400, {
        error: {
          code: "invalid_parameter",
          message: "a transparent transaction uses no shielded pool",
        },
      }),
    );
    const result = await tools.dispatch(
      "export_data",
      JSON.stringify({ family: "transaction-list", kind: "transparent", pool: "orchard" }),
    );
    expect(result.export).toBeUndefined();
    expect(result.content).toContain("a transparent transaction uses no shielded pool");
  });

  it.each([
    ["a 503", fixed(503, { error: { code: "upstream_unavailable", message: "busy" } })],
    ["a 500", fixed(500, { error: { code: "internal", message: "boom" } })],
    ["a 429", fixed(429, { error: { code: "rate_limited", message: "slow down" } })],
    ["a body that is not JSON", { request: () => new Response("<html>", { status: 200 }) }],
    ["another dataset's file", fixed(200, { dataset: "blocks", rows: [], columns: [] })],
    [
      "a file for another call",
      fixed(200, {
        dataset: "prices-daily",
        request: "https://api.shieldedscan.xyz/v1/prices/daily?format=json",
        columns: [{ name: "day", type: "day", description: "d", empty: [] }],
        rows: [{ day: "2026-07-01" }],
      }),
    ],
    [
      "a requester that throws",
      {
        request: () => {
          throw new Error("socket hang up");
        },
      },
    ],
  ])("says unavailable for %s, with no card and no figure", async (_name, v1) => {
    const result = await withV1(v1).dispatch(
      "export_data",
      JSON.stringify({ family: "price", range: "30d" }),
    );
    expect(result.export).toBeUndefined();
    expect(result.content).toMatch(/reason="unavailable"/);
  });
});
