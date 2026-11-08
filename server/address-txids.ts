/**
 * Rows read per txid wanted when listing an address's newest transactions. A transaction can
 * touch one address in several inputs and outputs, so the walk reads a few rows per txid; when a
 * run of many-row transactions exhausts it, the list is shorter, never wrong.
 */
export const ADDRESS_TXID_ROWS_PER_TX = 4;

/**
 * The distinct txids of `rows`, which arrive newest block first, at most `limit` of them. Within a
 * block they are ordered by txid descending, so the order does not depend on the scan.
 */
export function newestDistinctTxids(
  rows: readonly { txid: string; block_height: number }[],
  limit: number,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let i = 0;
  while (i < rows.length && out.length < limit) {
    const height = rows[i]!.block_height;
    const block: string[] = [];
    for (; i < rows.length && rows[i]!.block_height === height; i += 1) {
      const txid = rows[i]!.txid;
      if (!seen.has(txid)) {
        seen.add(txid);
        block.push(txid);
      }
    }
    block.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
    out.push(...block.slice(0, limit - out.length));
  }
  return out;
}
