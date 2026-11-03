/**
 * Where a history too long for one request lives: the open dataset, queried on the caller's own
 * machine. The table and column names are the dataset card's (`server/opendata/tables.ts`), and a
 * test holds them together.
 */

export const OPEN_DATASET_REPO = "Shieldedscanxyz/zcash-mainnet";
export const OPEN_DATASET_URL = `https://huggingface.co/datasets/${OPEN_DATASET_REPO}`;

/**
 * A DuckDB query giving the same rows as the address export, for any address (`epoch_ms` gives a
 * zone-free UTC time; an unresolved input leaves `sent_zat` NULL, as the export does). The address is
 * checked to be a transparent address before it reaches here, so it holds only base58 characters
 * and cannot break out of the string literal.
 */
export function addressDuckDbQuery(address: string): string {
  const hf = `hf://datasets/${OPEN_DATASET_REPO}`;
  return [
    "SELECT io.block_height, epoch_ms(t.timestamp * 1000) AS block_time_utc, io.txid, t.kind AS tx_kind,",
    "       coalesce(sum(io.value_zat) FILTER (WHERE io.io = 'out'), 0) AS received_zat,",
    "       CASE WHEN bool_or(io.io = 'in' AND io.value_zat IS NULL) THEN NULL",
    "            ELSE coalesce(sum(io.value_zat) FILTER (WHERE io.io = 'in'), 0) END AS sent_zat,",
    "       t.fee_zat AS tx_fee_zat",
    `FROM '${hf}/transparent_io/*.parquet' io`,
    `JOIN '${hf}/transactions/*.parquet' t USING (txid)`,
    `WHERE io.address = '${address}'`,
    "GROUP BY ALL",
    "ORDER BY io.block_height, io.txid;",
  ].join("\n");
}

/** The pointer a refused export carries: where to go, and the query to run there. */
export function addressAlternative(address: string) {
  return {
    dataset: OPEN_DATASET_URL,
    tables: ["transparent_io", "transactions"],
    duckdb: addressDuckDbQuery(address),
  };
}
