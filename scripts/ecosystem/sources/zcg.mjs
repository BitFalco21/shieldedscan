/**
 * Zcash Community Grants, via OpenZcash's mirror of the official ZCG spreadsheet
 * (https://openzcash.org/api/zcg/data/grants; methodology at openzcash.org/zcg/methodology).
 *
 * The ledger names grants and grantees and carries NO URL, so these rows cannot become
 * candidates by themselves. They are evidence: a candidate whose name matches a grant was
 * funded by the ecosystem's own grants body, which is one of the strongest signals that it is
 * real and Zcash-specific. Unmatched grants are reported so a reviewer can find their links.
 */
import { fetchJson } from "../lib/http.mjs";

const URL = "https://openzcash.org/api/zcg/data/grants";

export async function discoverZcg() {
  const body = await fetchJson(URL);
  if (!Array.isArray(body.data) || body.data.length === 0) {
    throw new Error("OpenZcash grants answered with no rows; refusing to treat that as no grants");
  }
  const grants = body.data.map((row) => ({
    source: "zcg",
    grant: row.grant,
    grantee: row.grantee,
    category: row.category,
    program: row.program,
    status: row.status,
    firstPaid: row.firstPaid,
    lastPaid: row.lastPaid,
    where: URL,
  }));
  return { grants };
}
