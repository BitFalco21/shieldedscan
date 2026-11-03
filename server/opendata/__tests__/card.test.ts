import { describe, expect, it } from "vitest";
import { datasetCard } from "../card";
import {
  ADDRESS_COLUMNS,
  BLOCK_COINBASE_COLUMNS,
  BLOCK_COLUMNS,
  SMALL_TABLES,
  TRANSACTION_COLUMNS,
  TRANSACTIONS_EXTRA_COLUMNS,
  TRANSPARENT_IO_COLUMNS,
} from "../tables";

describe("dataset card", () => {
  const card = datasetCard({ ledger: true });
  const tables = {
    blocks: BLOCK_COLUMNS,
    blocks_coinbase: BLOCK_COINBASE_COLUMNS,
    transactions: TRANSACTION_COLUMNS,
    transparent_io: TRANSPARENT_IO_COLUMNS,
    transactions_extra: TRANSACTIONS_EXTRA_COLUMNS,
    ...SMALL_TABLES,
    addresses: ADDRESS_COLUMNS,
  };

  it("documents every published table and column", () => {
    for (const [name, columns] of Object.entries(tables)) {
      expect(card).toContain(`- config_name: ${name}\n`);
      expect(card).toContain(`### \`${name}\``);
      for (const c of columns) expect(card).toContain(`| \`${c.name}\` |`);
    }
  });

  it("says what the NU7 and coinbase tables can and cannot tell", () => {
    expect(card).toContain('data_files: "blocks_coinbase/*.parquet"');
    expect(card).toMatch(/miner-written[^]*sanitised at parse/);
    expect(card).not.toContain("miner-written coinbase text, and");
    expect(card).toContain("Empty before NU7 activates");
    expect(card).toContain("Release candidates are not covered");
    expect(card).toContain("The protocol version alone is not enough");
    expect(card).toContain(
      "One operator can use several addresses, so this understates concentration.",
    );
  });

  it("leaves nothing undescribed", () => {
    expect(card).not.toMatch(/undefined|\| *\|$/m);
  });

  it("names the ledger only in a release that carries it", () => {
    const without = datasetCard({ ledger: false });
    // A config whose files are absent breaks the Hub's viewer for the whole dataset.
    expect(without).not.toContain("config_name: transparent_io");
    expect(without).not.toContain("config_name: transactions_extra");
    expect(without).toContain("Transparent inputs and outputs by address are not in this release");
    expect(card).not.toContain("not in this release");
    expect(card).toContain("first ~5 GB");
    expect(card).toContain("`transparent_io/<start>-<end>-<part>.parquet`");
    expect(card).toMatch(/unclaimed figure/);
  });

  it("says addresses are published as a snapshot, with no labels", () => {
    expect(card).toContain('data_files: "addresses.parquet"');
    expect(card).toContain("every transparent address's balance");
    expect(card).toMatch(/`addresses`, a\nsnapshot that each release replaces/);
    expect(card).toContain("sort by `balance_zat` descending, then `address`");
    expect(card).toContain("no labels, owners or groupings");
    expect(card).not.toMatch(/\| `rank` \|/);
  });
});
