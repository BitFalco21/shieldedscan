import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { unframe } from "../status-collector/grpc";
import { fields, parseBlockId, parseLightdInfo } from "../status-collector/protobuf";
import { decimalToUnits, unitsToDecimal } from "../status-collector/chains";
import { JSON_TARGETS } from "../status-collector/targets";

const fixture = (name: string) => readFileSync(join(__dirname, "__fixtures__", "status", name));

describe("light-wallet server answers", () => {
  // Captured from na.zec.rocks on 2026-11-15; the hash matches this explorer's block 3,575,739.
  it("reads LightdInfo", () => {
    const body = unframe(fixture("lightdinfo-na-zec-rocks.bin"));
    expect(body).not.toBeNull();
    expect(parseLightdInfo(body!)).toEqual({
      version: "v0.6.1",
      vendor: "ECC LightWalletD",
      chainName: "main",
      consensusBranchId: "77190ad9",
      blockHeight: 3575739,
      estimatedHeight: 3575739,
      zcashdBuild: "v7.0.0+git.e8db87e",
      zcashdSubversion: "/Zebra:7.0.0/",
    });
  });

  it("reads the tip, hash in display order", () => {
    const body = unframe(fixture("latestblock-na-zec-rocks.bin"));
    expect(parseBlockId(body!)).toEqual({
      height: 3575739,
      hash: "0000000000e794f8edbf520eeadd33b92b1fb8b5fc76b313e4b507cd57b4b527",
    });
  });

  it("refuses a short or compressed frame", () => {
    expect(unframe(Buffer.from([0, 0, 0]))).toBeNull();
    expect(unframe(Buffer.from([1, 0, 0, 0, 0]))).toBeNull();
    expect(unframe(Buffer.from([0, 0, 0, 0, 9, 1, 2]))).toBeNull();
    expect(unframe(Buffer.from([0, 0, 0, 0, 0]))).toEqual(Buffer.alloc(0));
  });

  it("skips fields it does not know and throws on a truncated one", () => {
    // field 15 fixed64, field 7 varint 300
    const buf = Buffer.from([0x79, 1, 2, 3, 4, 5, 6, 7, 8, 0x38, 0xac, 0x02]);
    expect(fields(buf)).toEqual([{ n: 7, varint: 300n }]);
    expect(() => fields(Buffer.from([0x22, 5, 1]))).toThrow("truncated");
  });
});

describe("what is kept of each JSON answer", () => {
  const keep = (id: string, body: unknown) => JSON_TARGETS.find((t) => t.id === id)!.keep(body);

  it("keeps only ZEC from THORChain's inbound list", () => {
    const body = [
      { chain: "BTC", halted: true },
      { chain: "ZEC", halted: false, chain_trading_paused: false, address: "t1x", gas_rate: "1" },
    ];
    expect(keep("thorchain.inbound", body)).toEqual([
      { halted: false, chain_trading_paused: false },
    ]);
  });

  it("keeps only ZEC from Binance's coin list, and survives a changed shape", () => {
    const body = {
      success: true,
      data: [
        { coin: "BTC", depositAllEnable: true },
        {
          coin: "ZEC",
          depositAllEnable: true,
          withdrawAllEnable: false,
          networkList: [
            {
              network: "ZEC",
              depositEnable: true,
              withdrawEnable: false,
              busy: false,
              name: "Zcash",
            },
          ],
        },
      ],
    };
    expect(keep("binance.web", body)).toEqual([
      {
        depositAllEnable: true,
        withdrawAllEnable: false,
        networks: [{ network: "ZEC", depositEnable: true, withdrawEnable: false, busy: false }],
      },
    ]);
  });

  it("records a changed shape or a venue's error envelope as a failed read, never as 'no ZEC'", () => {
    expect(() => keep("binance.web", "<html>")).toThrow("unexpected shape");
    expect(() => keep("binance.web", { success: false, code: "100001" })).toThrow("venue error");
    expect(() => keep("kucoin.currency", { code: "400100", msg: "bad" })).toThrow("venue error");
    expect(() =>
      keep("kraken.asset", { error: ["EGeneral:Too many requests"], result: {} }),
    ).toThrow("venue error");
    expect(() => keep("okx.system", { code: "50011", data: [] })).toThrow("venue error");
    expect(() => keep("thorchain.inbound", { error: "rate limited" })).toThrow("unexpected shape");
  });

  it("keeps the Zcash components of a status page", () => {
    const body = {
      components: [
        { name: "Zcash (ZEC)", status: "operational", id: "a" },
        { name: "Bitcoin", status: "major_outage" },
      ],
    };
    expect(keep("kraken.statuspage", body)).toEqual([
      { name: "Zcash (ZEC)", status: "operational" },
    ]);
  });

  it("every target id is unique", () => {
    const ids = JSON_TARGETS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("day files", () => {
  it("names a file by the UTC day; gzips days before yesterday, appending to an existing .gz", async () => {
    const dir = await mkdtemp(join(tmpdir(), "status-"));
    process.env.STATUS_DATA_DIR = dir;
    const { dayFile, compressFinishedDays } = await import("../status-collector/main");
    expect(dayFile(new Date("2026-11-15T23:59:59Z"))).toBe("status-2026-11-15.jsonl");
    await writeFile(join(dir, "status-2026-11-13.jsonl"), '{"a":1}\n');
    await writeFile(join(dir, "status-2026-11-14.jsonl"), '{"b":2}\n');
    await writeFile(join(dir, "status-2026-11-15.jsonl"), '{"c":3}\n');
    await writeFile(join(dir, "markets-2026-11-13.jsonl"), '{"m":1}\n');
    await compressFinishedDays(new Date("2026-11-15T00:00:30Z"));
    expect((await readdir(dir)).sort()).toEqual([
      "markets-2026-11-13.jsonl.gz",
      "status-2026-11-13.jsonl.gz",
      "status-2026-11-14.jsonl",
      "status-2026-11-15.jsonl",
    ]);
    // A straggler written after compression is appended as a second gzip member, not lost.
    await writeFile(join(dir, "status-2026-11-13.jsonl"), '{"late":1}\n');
    await compressFinishedDays(new Date("2026-11-15T00:01:30Z"));
    expect(gunzipSync(await readFile(join(dir, "status-2026-11-13.jsonl.gz"))).toString()).toBe(
      '{"a":1}\n{"late":1}\n',
    );
    // A crash after the rename leaves the plain file beside an archive that already holds it.
    await writeFile(join(dir, "status-2026-11-13.jsonl"), '{"late":1}\n');
    await compressFinishedDays(new Date("2026-11-15T00:02:30Z"));
    expect(await readdir(dir)).not.toContain("status-2026-11-13.jsonl");
    expect(gunzipSync(await readFile(join(dir, "status-2026-11-13.jsonl.gz"))).toString()).toBe(
      '{"a":1}\n{"late":1}\n',
    );
  });
});

describe("supply arithmetic", () => {
  it("moves between units and decimals without a float", () => {
    expect(unitsToDecimal("219999998672872241403848", 18)).toBe("219999.998672872241403848");
    expect(unitsToDecimal("0", 8)).toBe("0");
    expect(unitsToDecimal("16097471", 8)).toBe("0.16097471");
    expect(unitsToDecimal("2500000000", 8)).toBe("25");
    expect(decimalToUnits("21000000", 9)).toBe("21000000000000000");
    expect(decimalToUnits("20854656.6121147349", 9)).toBe("20854656612114734");
    expect(() => decimalToUnits("1e5", 8)).toThrow("not a decimal");
  });
});

describe("streams", () => {
  it("files market observations apart from service health", async () => {
    const { streamOf, dayFile } = await import("../status-collector/main");
    expect(streamOf("wallet")).toBe("status");
    expect(streamOf("supply")).toBe("markets");
    expect(streamOf("cex-daily")).toBe("markets");
    expect(dayFile(new Date("2026-11-15T12:00:00Z"), "markets")).toBe("markets-2026-11-15.jsonl");
  });
});
