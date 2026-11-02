import { describe, expect, it } from "vitest";
import type { Manifest, ManifestFile } from "../../opendata/manifest";
import { copyField, copyLine } from "../copy";
import { planImport } from "../plan";
import { isSafePath } from "../source";

const file = (path: string, rows = 1): ManifestFile => ({
  path,
  rows,
  bytes: 1,
  sha256: "0".repeat(64),
  contentSha256: "0".repeat(64),
});

const SMALL = [
  "pool_usage_daily.parquet",
  "shielding_daily.parquet",
  "shielding_records_daily.parquet",
  "transparent_daily.parquet",
  "transparent_monthly.parquet",
  "addresses.parquet",
];

const manifest = (paths: string[], ledger: Manifest["ledger"]["status"] = "published"): Manifest =>
  ({
    format: 1,
    network: "mainnet",
    height: 10_500,
    hash: "0".repeat(64),
    files: [...paths, ...SMALL].map((p) => file(p)),
    ledger:
      ledger === "published"
        ? {
            status: "published",
            closedRanges: 1,
            openRange: [10_000, 19_999],
            underclaimZat: "0",
            underclaimedBlocks: 0,
            skippedBlocks: 0,
          }
        : { status: "withheld", closedRanges: 1, notCached: 1 },
    snapshots: [],
  }) as unknown as Manifest;

const CHAIN = [
  "blocks/0000000-0499999.parquet",
  "transactions/0000000-0099999.parquet",
  "transactions_extra/0000000-0009999.parquet",
  "transactions_extra/0010000-0019999.parquet",
  "transparent_io/0000000-0009999-000.parquet",
  "transparent_io/0000000-0009999-001.parquet",
  "transparent_io/0010000-0019999-000.parquet",
];

describe("planImport", () => {
  it("pairs each transactions file with the extra files covering its heights", () => {
    const plan = planImport(manifest(CHAIN));
    expect(plan.problems).toEqual([]);
    expect(plan.coinbase).toBe(false);
    const tx = plan.units.find((u) => u.kind === "transactions")!;
    expect(tx.files.map((f) => f.path)).toEqual([
      "transactions/0000000-0099999.parquet",
      "transactions_extra/0000000-0009999.parquet",
      "transactions_extra/0010000-0019999.parquet",
    ]);
    expect(plan.units.filter((u) => u.kind === "transparent_io")).toHaveLength(3);
    // The block files carry no coinbase companion in an older release: those columns stay NULL.
    expect(plan.units.find((u) => u.kind === "blocks")!.files).toHaveLength(1);
  });

  it("joins blocks_coinbase to its blocks file when the release carries it", () => {
    const plan = planImport(manifest([...CHAIN, "blocks_coinbase/0000000-0499999.parquet"]));
    expect(plan.problems).toEqual([]);
    expect(plan.coinbase).toBe(true);
    expect(plan.units.find((u) => u.kind === "blocks")!.files.map((f) => f.path)).toEqual([
      "blocks/0000000-0499999.parquet",
      "blocks_coinbase/0000000-0499999.parquet",
    ]);
  });

  it("refuses a release without the ledger, or with a gap in what pairs with its rows", () => {
    expect(planImport(manifest(CHAIN, "withheld")).problems[0]).toMatch(/transparent ledger/);
    const gap = CHAIN.filter((p) => p !== "transactions_extra/0000000-0009999.parquet");
    expect(planImport(manifest(gap)).problems).toEqual([
      "transactions/0000000-0099999.parquet: transactions_extra/ does not cover its heights",
    ]);
    const partial = [
      ...CHAIN,
      "blocks/0500000-0999999.parquet",
      "blocks_coinbase/0000000-0499999.parquet",
    ];
    expect(planImport(manifest(partial)).problems).toContain(
      "blocks/0500000-0999999.parquet has no blocks_coinbase file",
    );
  });
});

describe("COPY text format", () => {
  it("escapes what COPY would read as structure, and writes NULL as \\N", () => {
    expect(copyField("a\tb\nc\\d\re")).toBe("a\\tb\\nc\\\\d\\re");
    expect(copyLine([null, 1, 2n ** 62n, true, "x"])).toBe(`\\N\t1\t${2n ** 62n}\tt\tx\n`);
    expect(copyField(0.1 + 0.2)).toBe("0.30000000000000004");
  });
});

describe("dataset paths", () => {
  it("never leave the data directory", () => {
    expect(isSafePath("transparent_io/0000000-0009999-000.parquet")).toBe(true);
    expect(isSafePath("../etc/passwd")).toBe(false);
    expect(isSafePath("/etc/passwd")).toBe(false);
    expect(isSafePath("blocks/../../x")).toBe(false);
  });
});
