import { Hono, type Context } from "hono";
import type { Pool } from "pg";
import { classifyZcashAddress, parseUtcDayStart } from "@/domain";
import { addressActivityWindow } from "../address-activity";
import { addressValueExtremes } from "../address-extremes";
import { DAY_SECONDS } from "@/domain/time";
import { MAINNET_SITE_URL as SITE } from "@/lib/network";
import { amount } from "./format";
import { ParamError, rejectUnknown } from "./params";
import { routeGroupErrors, setCache } from "./http";
import { createKeyedCache } from "./keyed-cache";

/**
 * One transparent address over a window, and its largest receipt and payment. The same bounded
 * walks the agent uses (`address-activity.ts`, `address-extremes.ts`), so the two answers cannot
 * differ.
 *
 * These are the most expensive public reads, bounded three ways: a pool of two dedicated
 * connections (a cold walk is ~4 s at one heap page per row, so a caller waits at most five
 * seconds for a connection, then gets a 503); a response cache, six hours for a window that ended
 * before yesterday and ten minutes otherwise; and the Caddy `v1_address` zones, the tightest on
 * `/v1`. The walks are capped at 20,000 index rows and say when the cap bit (`complete: false`,
 * `coversFromHeight`).
 *
 * Transparent activity only: a shielded transaction has no address to file under, so these are
 * never an address's whole activity, and a shielded address is refused by name.
 */

const CLOSED_TTL_MS = 6 * 60 * 60 * 1000;
const OPEN_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 500;

export const V1_ADDRESS_WINDOW_PATHS = [
  "/v1/addresses/{address}/activity",
  "/v1/addresses/{address}/extremes",
] as const;

/** The Caddy matcher for these two paths, kept beside them so the test can hold the two together. */
export const V1_ADDRESS_WINDOW_REGEXP = "^/v1/addresses/[^/]+/(activity|extremes)$";

export interface V1AddressWindowDeps {
  pool: Pool;
  now?: () => number;
  /** The walks, injectable so the HTTP contract is testable without a database. */
  activity?: typeof addressActivityWindow;
  extremes?: typeof addressValueExtremes;
}

export function v1AddressWindowRoutes(deps: V1AddressWindowDeps): Hono {
  const app = new Hono();
  const now = deps.now ?? Date.now;
  const activity = deps.activity ?? addressActivityWindow;
  const extremes = deps.extremes ?? addressValueExtremes;
  const nowSec = () => Math.floor(now() / 1000);
  const cached = createKeyedCache({ now, max: CACHE_MAX });

  app.onError(routeGroupErrors("the address index could not answer just now; retry shortly"));

  const transparentAddress = (c: Context): string => {
    const raw = c.req.param("address") ?? "";
    const kind = classifyZcashAddress(raw);
    if (kind === "transparent") return raw.trim();
    throw new ParamError(
      "invalid_parameter",
      kind === null
        ? "address is not a Zcash address"
        : "a shielded address has no public activity: its transactions are encrypted on-chain by design",
    );
  };

  const headers = (c: Context, closed: boolean) =>
    setCache(c, closed ? "settledWindow" : "openWindow");

  app.get("/v1/addresses/:address/activity", async (c) => {
    const address = transparentAddress(c);
    const q = c.req.query();
    rejectUnknown(q, ["from", "to"]);
    const from = parseUtcDayStart(q.from);
    const to = parseUtcDayStart(q.to);
    if (from === null || to === null) {
      throw new ParamError(
        "invalid_parameter",
        "from and to are both required UTC days (YYYY-MM-DD), to exclusive",
      );
    }
    if (to <= from) throw new ParamError("invalid_parameter", "to must be a later day than from");
    const todayStart = Math.floor(nowSec() / DAY_SECONDS) * DAY_SECONDS;
    const closed = to <= todayStart - DAY_SECONDS;
    const w = await cached(
      `activity:${address}:${from}:${to}`,
      closed ? CLOSED_TTL_MS : OPEN_TTL_MS,
      () => activity(deps.pool, address, from, to),
    );
    const notes: string[] = [];
    if (!w.complete) {
      notes.push(
        `The walk is capped and covered only heights from ${w.coversFromHeight} upward; the figures are for that part of the window.`,
      );
    }
    if (to > todayStart) notes.push("The window includes today's unfinished UTC day.");
    headers(c, closed);
    return c.json({
      query: { address, from: q.from, to: q.to },
      window: { fromHeight: w.fromHeight, toHeight: w.toHeight },
      coverage: { status: notes.length === 0 ? "complete" : "partial", notes },
      source: { name: "ShieldedScan", url: `${SITE}/address/${address}` },
      basis:
        "transparent activity only: value paid to the address and spent from it. Shielded value has no address to file under and is never included.",
      data: {
        transactions: w.txCount,
        lifetimeTransactions: w.lifetimeTxCount,
        received: amount(w.receivedZat),
        sent: amount(w.sentZat),
        net: amount(w.netZat),
        firstHeight: w.firstHeight,
        lastHeight: w.lastHeight,
      },
      // Null is our gap — an emptied address before the all-address count caught up — never "the
      // address has no history": it has at least the transactions in this window's own index.
      unknowns: w.lifetimeTxCount === null ? { "data.lifetimeTransactions": "unmeasured" } : {},
      asOf: nowSec(),
    });
  });

  app.get("/v1/addresses/:address/extremes", async (c) => {
    const address = transparentAddress(c);
    rejectUnknown(c.req.query(), []);
    const e = await cached(`extremes:${address}`, OPEN_TTL_MS, () => extremes(deps.pool, address));
    const side = (s: typeof e.largestReceived) =>
      s === null
        ? null
        : {
            netChange: amount(s.netChangeZat),
            ties: s.count,
            // Named only when unique: a tie has no single transaction to point at.
            txid: s.count === 1 ? s.txid : null,
            height: s.count === 1 ? s.blockHeight : null,
            transactionPublicValue: s.publicValueZat === null ? null : amount(s.publicValueZat),
          };
    const notes = e.complete
      ? []
      : [
          `Only the address's newest ${e.considered} transactions were considered (from height ${e.fromHeight}); an older transaction may be larger.`,
        ];
    headers(c, false);
    return c.json({
      query: { address },
      coverage: { status: notes.length === 0 ? "complete" : "partial", notes },
      source: { name: "ShieldedScan", url: `${SITE}/address/${address}` },
      basis:
        "the address's own net movement per transaction, transparent value only; coinbase payouts included, since a mining reward is a genuine receipt.",
      data: {
        lifetimeTransactions: e.txCount,
        considered: e.considered,
        largestReceived: side(e.largestReceived),
        largestSent: side(e.largestSent),
      },
      unknowns: {
        ...(e.txCount === null ? { "data.lifetimeTransactions": "unmeasured" } : {}),
        ...(e.largestReceived === null ? { "data.largestReceived": "nonexistent" } : {}),
        ...(e.largestSent === null ? { "data.largestSent": "nonexistent" } : {}),
      },
      asOf: nowSec(),
    });
  });

  return app;
}
