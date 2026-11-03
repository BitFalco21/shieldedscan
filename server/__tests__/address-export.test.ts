import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { AdmissionGate } from "../admission-gate";
import { MemoryStorePort } from "../crosschain-store";
import type { AddressBatch, AddressTxRow } from "../v1/export/address-walk";
import { V1_ADDRESS_EXPORT_PATH, v1AddressExportRoutes } from "../v1/export/address-route";
import { v1Routes } from "../v1/routes";
import { addressDuckDbQuery } from "../v1/export/open-dataset";
import {
  TRANSACTION_COLUMNS,
  TRANSPARENT_IO_COLUMNS,
  transactionsFile,
  transparentIoFile,
} from "../opendata/tables";

/**
 * The address export's contract, against stubs: the cap is checked before any walk, a refusal
 * points to the open dataset, the cheap answers (304, HEAD, refusals) start nothing, and a
 * transfer that cannot finish breaks off instead of ending short. The walk itself is
 * `address-export-db.test.ts`.
 */

const ADDR = "t1a7HnBdsBSvkGZQXD5vPYqoWRvnpG555Jy";
const TIP = { height: 3_500_000, hash: "f".repeat(64), timestamp: 1_790_000_000 };

const tx = (height: number, over: Partial<AddressTxRow> = {}): AddressTxRow => ({
  blockHeight: height,
  timestamp: 1_700_000_000 + height,
  txid: height.toString(16).padStart(64, "0"),
  kind: "transparent",
  receivedZat: 5_000,
  sentZat: 1_000,
  feeZat: 10_000,
  ...over,
});

interface Setup {
  count?: number | null;
  batches?: AddressBatch[];
  readBatch?: (above: number) => Promise<AddressBatch>;
  cap?: number;
  gate?: AdmissionGate;
  deadlineMs?: number;
}

function setup(s: Setup = {}) {
  const gate = s.gate ?? new AdmissionGate(2, 0, 10);
  const count = vi.fn(async () => (s.count === undefined ? 3 : s.count));
  const batches = s.batches ?? [
    { rows: [tx(100), tx(150)], through: 150, done: false },
    {
      rows: [tx(200, { kind: "coinbase", feeZat: null, sentZat: null })],
      through: TIP.height,
      done: true,
    },
  ];
  let i = 0;
  const readBatch = vi.fn(s.readBatch ?? (async () => batches[Math.min(i++, batches.length - 1)]!));
  const v1 = v1Routes({
    store: new MemoryStorePort(),
    enabledProtocols: {},
    extensions: [
      {
        routes: v1AddressExportRoutes({
          pool: {} as Pool,
          walkPool: {} as Pool,
          gate,
          ...(s.cap !== undefined ? { cap: s.cap } : {}),
          ...(s.deadlineMs !== undefined ? { deadlineMs: s.deadlineMs } : {}),
          tip: async () => TIP,
          count,
          readBatch: (_pool, _address, above) => readBatch(above),
        }),
        endpoints: [V1_ADDRESS_EXPORT_PATH],
      },
    ],
  });
  return { v1, gate, count, readBatch };
}

const url = (q = "") => `/v1/addresses/${ADDR}/export${q}`;
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("an address's history as a file", () => {
  it("streams every batch as one CSV, oldest first, with its provenance", async () => {
    const { v1, gate, readBatch } = setup();
    const res = await v1.request(url());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8; header=present");
    expect(res.headers.get("content-disposition")).toBe(
      `attachment; filename="shieldedscan_address_${ADDR}.csv"`,
    );
    expect(res.headers.get("x-data-height")).toBe("3500000");
    expect(res.headers.get("x-data-through")).toBe("2026-09-21T14:13:20Z");
    expect(res.headers.get("etag")).toMatch(/^W\/"[0-9a-f]{40}"$/);
    const lines = (await res.text()).split("\r\n");
    expect(lines).toEqual([
      "block_height,block_time_utc,txid,tx_kind,received_zat,sent_zat,net_zat,tx_fee_zat",
      `100,2023-11-14T22:15:00Z,${tx(100).txid},transparent,5000,1000,4000,10000`,
      `150,2023-11-14T22:15:50Z,${tx(150).txid},transparent,5000,1000,4000,10000`,
      // An unresolved input: what was sent is unknown, so the net is too. Never a 0.
      `200,2023-11-14T22:16:40Z,${tx(200).txid},coinbase,5000,,,`,
      "",
    ]);
    // The second batch starts above the height the first one ended on.
    expect(readBatch.mock.calls.map((c) => c[0])).toEqual([-1, 150]);
    await settle();
    expect(gate.inFlight).toBe(0);
  });

  it("is the same table as JSON, each empty cell with its reason", async () => {
    const { v1 } = setup();
    const res = await v1.request(url("?format=json"));
    expect(res.headers.get("content-disposition")).toContain("inline");
    const body = await res.json();
    expect(body.query).toEqual({ address: ADDR });
    expect(body.dataHeight).toBe(TIP.height);
    expect(body.rowCount).toBe(3);
    expect(body.rows[2]).toMatchObject({ tx_kind: "coinbase", sent_zat: null, tx_fee_zat: null });
    expect(body.unknowns).toEqual({
      "rows.2.sent_zat": "indeterminate",
      "rows.2.net_zat": "indeterminate",
      "rows.2.tx_fee_zat": "nonexistent",
    });
  });
});

describe("the cap", () => {
  it("refuses past it before any walk, with the count and a query over the open dataset", async () => {
    const { v1, readBatch, gate } = setup({ count: 50_001, cap: 10_000 });
    const res = await v1.request(url());
    expect(res.status).toBe(422);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json();
    expect(body.error.code).toBe("export_too_large");
    expect(body.error.message).toContain("50,001");
    expect(body).toMatchObject({ count: 50_001, cap: 10_000 });
    expect(body.alternative.dataset).toBe(
      "https://huggingface.co/datasets/Shieldedscanxyz/zcash-mainnet",
    );
    expect(body.alternative.duckdb).toContain(`WHERE io.address = '${ADDR}'`);
    expect(body.alternative.duckdb).toContain("transparent_io/*.parquet");
    expect(readBatch).not.toHaveBeenCalled();
    expect(gate.inFlight).toBe(0);
  });

  it("points at tables and columns the open dataset actually publishes", () => {
    const query = addressDuckDbQuery(ADDR);
    const io = TRANSPARENT_IO_COLUMNS.map((c) => c.name);
    const txs = TRANSACTION_COLUMNS.map((c) => c.name);
    for (const name of query.matchAll(/\bio\.(\w+)/g)) expect(io).toContain(name[1]);
    for (const name of query.matchAll(/\bt\.(\w+)/g)) expect(txs).toContain(name[1]);
    expect(query).toContain(`/${transparentIoFile(0, 0).split("/")[0]}/*.parquet`);
    expect(query).toContain(`/${transactionsFile(0).split("/")[0]}/*.parquet`);
  });

  it("will not walk an address whose count it cannot read", async () => {
    const { v1, readBatch } = setup({ count: null });
    const res = await v1.request(url());
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("60");
    expect((await res.json()).alternative.tables).toEqual(["transparent_io", "transactions"]);
    expect(readBatch).not.toHaveBeenCalled();
  });

  it("breaks the transfer off if the walk passes the cap anyway", async () => {
    const { v1, gate } = setup({
      count: 2,
      cap: 2,
      batches: [{ rows: [tx(1), tx(2), tx(3)], through: TIP.height, done: true }],
    });
    const res = await v1.request(url());
    expect(res.status).toBe(200);
    await expect(res.text()).rejects.toThrow(/cap/);
    await settle();
    expect(gate.inFlight).toBe(0);
  });
});

describe("what starts nothing", () => {
  it("refuses a shielded address and a non-address by name", async () => {
    const { v1, count } = setup();
    const shielded = await v1.request(
      "/v1/addresses/zs1z7rejlpsa98s2rrrfkwmaxu53e4ue0ulcrw0h4x5g8jl04tak0d3mm47vdtahatqrlkngh9sly/export",
    );
    expect(shielded.status).toBe(400);
    expect((await shielded.json()).error.message).toMatch(/shielded address has no public history/);
    expect((await v1.request("/v1/addresses/nonsense/export")).status).toBe(400);
    expect(count).not.toHaveBeenCalled();
  });

  it("answers an unchanged file with a 304 before counting", async () => {
    const { v1, count } = setup();
    const tag = (await v1.request(url())).headers.get("etag")!;
    count.mockClear();
    const res = await v1.request(url(), { headers: { "If-None-Match": tag } });
    expect(res.status).toBe(304);
    expect(count).not.toHaveBeenCalled();
    // CSV and JSON are different files.
    const json = await v1.request(url("?format=json"), { headers: { "If-None-Match": tag } });
    expect(json.status).toBe(200);
    await json.text();
  });

  it("answers HEAD with headers only: no count, no slot, no walk", async () => {
    const { v1, count, readBatch, gate } = setup();
    const res = await v1.request(url(), { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(count).not.toHaveBeenCalled();
    expect(readBatch).not.toHaveBeenCalled();
    expect(gate.inFlight).toBe(0);
  });

  it("refuses with a 503 when every slot is taken", async () => {
    const gate = new AdmissionGate(1, 0, 10);
    await gate.acquire();
    const { v1, readBatch } = setup({ gate });
    const res = await v1.request(url());
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("10");
    expect(readBatch).not.toHaveBeenCalled();
  });

  it("refuses an unknown parameter and an unknown format", async () => {
    const { v1 } = setup();
    expect((await v1.request(url("?from=2026-01-01"))).status).toBe(400);
    expect((await v1.request(url("?format=xlsx"))).status).toBe(400);
  });
});

describe("a transfer that cannot finish", () => {
  it("breaks off on a failed batch, never ending short, and frees its slot", async () => {
    let calls = 0;
    const { v1, gate } = setup({
      readBatch: async () => {
        calls += 1;
        if (calls === 1) return { rows: [tx(1)], through: 1, done: false };
        throw new Error("canceling statement due to statement timeout");
      },
    });
    const res = await v1.request(url());
    expect(res.status).toBe(200);
    await expect(res.text()).rejects.toThrow(/statement timeout/);
    await settle();
    expect(gate.inFlight).toBe(0);
  });

  it("breaks off at the deadline, and frees its slot once the batch in flight settles", async () => {
    let release: () => void = () => undefined;
    const { v1, gate } = setup({
      deadlineMs: 20,
      readBatch: () =>
        new Promise<AddressBatch>((resolve) => {
          release = () => resolve({ rows: [tx(1)], through: 1, done: false });
        }),
    });
    const res = await v1.request(url());
    const reading = res.text();
    await expect(reading).rejects.toThrow(/deadline/);
    // The query is still running: the slot stays taken until it returns.
    expect(gate.inFlight).toBe(1);
    release();
    await settle();
    await settle();
    expect(gate.inFlight).toBe(0);
  });

  it("frees its slot when the client goes away", async () => {
    const { v1, gate, readBatch } = setup({
      readBatch: async (above) => ({ rows: [tx(above + 2)], through: above + 2, done: false }),
    });
    const res = await v1.request(url());
    const reader = res.body!.getReader();
    await reader.read();
    await reader.cancel();
    await settle();
    expect(gate.inFlight).toBe(0);
    const reads = readBatch.mock.calls.length;
    await new Promise((r) => setTimeout(r, 20));
    expect(readBatch.mock.calls.length).toBe(reads);
  });
});
