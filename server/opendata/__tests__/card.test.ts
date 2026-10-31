import { describe, expect, it } from "vitest";
import { datasetCard } from "../card";
import { BLOCK_COLUMNS, SMALL_TABLES, TRANSACTION_COLUMNS } from "../tables";

describe("dataset card", () => {
  const card = datasetCard();
  const tables = { blocks: BLOCK_COLUMNS, transactions: TRANSACTION_COLUMNS, ...SMALL_TABLES };

  it("documents every published table and column", () => {
    for (const [name, columns] of Object.entries(tables)) {
      expect(card).toContain(`- config_name: ${name}\n`);
      expect(card).toContain(`### \`${name}\``);
      for (const c of columns) expect(card).toContain(`| \`${c.name}\` |`);
    }
  });

  it("leaves nothing undescribed", () => {
    expect(card).not.toMatch(/undefined|\| *\|$/m);
  });
});
