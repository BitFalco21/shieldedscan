import { NextResponse } from "next/server";
import { getDataSource } from "@/data";
import { learnShape, learnTx } from "@/domain";
import type { Transaction } from "@/domain";
import { parseExampleShape, TXID_PATTERN } from "@/lib/learn-lookup";
import type { LearnExampleShape, LearnLookupResponse } from "@/lib/learn-lookup";
import { isTestnet } from "@/lib/network";
import { isTransientUpstream } from "@/lib/transient-upstream";

/**
 * The learning page's transaction check (`/learn`): "what is this transaction, and what can
 * everyone see in it?", or "show me a real recent example of this shape".
 *
 * A first-party route handler for the same reason as `/api/resolve`: the bearer token never
 * exists client-side, so the browser asks this origin and this handler asks the data source.
 * Nothing is stored, and the page discloses the request on `/privacy`.
 *
 * Never cached, anywhere. A reader checks a transaction seconds after sending it, and a cached
 * "not found" would tell them their own transaction does not exist. So the response is
 * `no-store` and the route's reads skip Next's data cache (`fetchCache`), which would otherwise
 * replay a stale miss.
 */
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/** Recent rows scanned for an example: enough to find a small one, one indexed read. */
const EXAMPLE_SCAN = 12;

function respond(body: LearnLookupResponse, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

/** The easiest-to-read recent transaction of a shape: the one with the fewest public entries. */
function simplest(txs: readonly Transaction[], shape: LearnExampleShape): Transaction | null {
  let best: Transaction | null = null;
  for (const tx of txs) {
    if (learnShape(tx) !== shape) continue;
    const size = tx.transparentInputs.length + tx.transparentOutputs.length;
    const bestSize = best
      ? best.transparentInputs.length + best.transparentOutputs.length
      : Infinity;
    if (size < bestSize) best = tx;
  }
  return best;
}

export async function GET(request: Request): Promise<NextResponse> {
  const params = new URL(request.url).searchParams;
  const rawTxid = params.get("txid");
  const txid = rawTxid === null ? null : rawTxid.trim().toLowerCase();
  const example = parseExampleShape(params.get("example"));
  const echo = { txid, example };

  // The page is mainnet-only; so is the check that serves it.
  if (isTestnet) return respond({ ...echo, status: "invalid", tx: null }, 404);

  if (txid === null && example === null)
    return respond({ ...echo, status: "invalid", tx: null }, 400);
  if (txid !== null && !TXID_PATTERN.test(txid))
    return respond({ ...echo, status: "invalid", tx: null });

  const data = getDataSource();
  try {
    if (txid !== null) {
      const tx = await data.getTransaction(txid);
      return respond(
        tx
          ? { ...echo, status: "found", tx: learnTx(tx) }
          : { ...echo, status: "missing", tx: null },
      );
    }
    // `example` is non-null here: both-null returned above.
    const shape = example as LearnExampleShape;
    const page = await data.listTransactions({ limit: EXAMPLE_SCAN }, shape);
    const tx = simplest(page.items, shape);
    return respond(
      tx ? { ...echo, status: "found", tx: learnTx(tx) } : { ...echo, status: "missing", tx: null },
    );
  } catch (error) {
    // An outage is said as one; a shape error still propagates, so version skew stays loud.
    if (isTransientUpstream(error))
      return respond({ ...echo, status: "unavailable", tx: null }, 503);
    throw error;
  }
}
