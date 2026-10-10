import { apiRequest, type ApiRequestConfig } from "./api-request";
import { createStaleMemo } from "@/lib/stale-memo";
import { cursorSearchParams } from "./cursor";
import type {
  CrossChainVolume,
  ChainInflowPoint,
  ChainOutflowPoint,
  InflowKindMonthPoint,
  VenueMonthPoint,
  CrossChainVolumeSeries,
  CrossChainFlow,
  CrossChainFlowSummary,
  CrossChainPreviousWindow,
  CrossChainTransfer,
  ZcashTxCrossings,
  CrossChainAggregate,
  CrossChainGroupBy,
  CrossChainProtocol,
  CrossChainSwapRef,
  CrossChainProtocolStats,
  CrossChainProtocolSummary,
} from "@/domain";
import {
  CROSSCHAIN_PROTOCOLS,
  orderProtocols,
  serializeChainFilter,
  utcDayFromSeconds,
  protocolStatsFromAggregate,
  protocolWindowStart,
} from "@/domain";
import type { CrossChainFilters, CursorPage, CursorQuery } from "./source";
// Shape guards shared with `chain-api-source.ts` and the live feed.
import { isTransfer } from "./shape-guards";

/**
 * Reads cross-chain transfers from the explorer API.
 *
 * The API returns domain types verbatim, so this adapter is a thin fetch-and-validate. It
 * never talks to a venue directly: venue credentials and rate budgets belong to the API's
 * single long-lived poller, and the Next app holds no API keys.
 *
 * Error contract (see `ExplorerDataSource`): a 404 means the transfer does not exist and
 * resolves to `undefined`. Anything else — a reboot, a timeout, a bad gateway — rejects, so
 * an outage surfaces at the error boundary instead of masquerading as missing data.
 */

/** Short enough to feel live, long enough that the CDN absorbs the traffic. */
const REVALIDATE_SECONDS = 30;

export interface CrossChainApiConfig extends ApiRequestConfig {
  /** The Data Cache window; absent means `REVALIDATE_SECONDS`. See `ChainApiConfig.tipRevalidateSeconds`. */
  revalidateSeconds?: number;
}

/** Same API, same box, same `apiRequest` — one retry policy and one view of the API's health. */
function request(config: CrossChainApiConfig, path: string): Promise<Response> {
  return apiRequest(config, path, config.revalidateSeconds ?? REVALIDATE_SECONDS);
}

/**
 * Write a narrowing onto a query string. Every part is omitted when it selects everything,
 * so an unfiltered request stays byte-identical and keeps one CDN cache key.
 */
function applyFilters(params: URLSearchParams, filters: CrossChainFilters): void {
  const protocol = filters.protocol ?? "all";
  const direction = filters.direction ?? "all";
  if (protocol !== "all") params.set("protocol", protocol);
  if (direction !== "all") params.set("direction", direction);
  const source = serializeChainFilter(filters.sourceChains ?? []);
  const destination = serializeChainFilter(filters.destinationChains ?? []);
  if (source) params.set("source", source);
  if (destination) params.set("destination", destination);
  if (filters.minUsdAtSwap !== undefined) params.set("min", String(filters.minUsdAtSwap));
}

/**
 * Refuse a page whose chain filters the API did not apply. An unfiltered list is a
 * well-formed list, so a filter dropped by the server is indistinguishable from one that
 * worked unless the API echoes what it applied.
 *
 * Scoped to requests that asked for a filter: an API one deploy behind sends no echo, and
 * failing every unfiltered view over that would turn a partial outage into a total one.
 */
function assertChainFiltersApplied(filters: CrossChainFilters, applied: unknown): void {
  const asked = {
    sourceChains: serializeChainFilter(filters.sourceChains ?? []),
    destinationChains: serializeChainFilter(filters.destinationChains ?? []),
    minUsdAtSwap: filters.minUsdAtSwap ?? null,
  };
  if (!asked.sourceChains && !asked.destinationChains && asked.minUsdAtSwap === null) return;

  const echo = applied as
    { sourceChains?: unknown; destinationChains?: unknown; minUsdAtSwap?: unknown } | undefined;
  const got = {
    sourceChains: serializeChainFilter(asStrings(echo?.sourceChains)),
    destinationChains: serializeChainFilter(asStrings(echo?.destinationChains)),
    // An absent key means an API that predates the threshold and would have ignored it; an
    // explicit null means one that understood and was asked for nothing. Undefined maps to a
    // value that never equals a real threshold.
    minUsdAtSwap:
      typeof echo?.minUsdAtSwap === "number"
        ? echo.minUsdAtSwap
        : echo && "minUsdAtSwap" in echo
          ? null
          : NaN,
  };
  if (
    got.sourceChains !== asked.sourceChains ||
    got.destinationChains !== asked.destinationChains ||
    !Object.is(got.minUsdAtSwap, asked.minUsdAtSwap)
  ) {
    throw new Error(
      `cross-chain API applied source=[${got.sourceChains}] destination=[${got.destinationChains}] ` +
        `min=[${String(got.minUsdAtSwap)}] for a request asking source=[${asked.sourceChains}] ` +
        `destination=[${asked.destinationChains}] min=[${String(asked.minUsdAtSwap)}]`,
    );
  }
}

function asStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/**
 * The previous-window comparison, checked before it is trusted. `incomplete` exists to
 * refuse a comparison whose denominator was only partly observed, so an unrecognised value
 * must fall back to no trend; waving through anything object-shaped would put a fabricated
 * percentage on every row.
 */
function isPreviousWindow(value: unknown): value is CrossChainPreviousWindow {
  if (typeof value !== "object" || value === null) return false;
  const p = value as Record<string, unknown>;
  if (p.kind === "none") return true;
  if (p.kind === "incomplete") return typeof p.recordsBeginAt === "number";
  return p.kind === "flows" && Array.isArray(p.flows);
}

/**
 * The chain list behind the SOURCE/DESTINATION menus, memoised in module scope (see
 * `lib/stale-memo.ts` for why `/cross-chain`'s `force-no-store` needs it).
 *
 * Staleness is cheap: this is which chains exist, not their numbers; the flows chart reads
 * `getCrossChainFlows` uncached. With no list at all it rejects rather than returning `[]`,
 * which would read as "no cross-chain traffic"; the caller drops the menu.
 */
const chainListMemo = createStaleMemo<CrossChainFlow[]>({
  ttlMs: 600_000,
  failureCooldownMs: 60_000,
  unavailableMessage: "cross-chain chain list is temporarily unavailable",
});

function chainList(config: CrossChainApiConfig): Promise<CrossChainFlow[]> {
  return chainListMemo.get(() => fetchChainList(config));
}

async function fetchChainList(config: CrossChainApiConfig): Promise<CrossChainFlow[]> {
  const res = await request(config, "/crosschain/flows");
  if (!res.ok) throw new Error(`cross-chain API returned ${res.status} for chains`);
  const body = (await res.json()) as Partial<CrossChainFlowSummary>;
  if (!Array.isArray(body.flows)) {
    throw new Error("cross-chain API returned an unrecognised flows shape");
  }
  return body.flows.filter(
    (f): f is CrossChainFlow =>
      typeof f?.chain === "string" &&
      (f.direction === "in" || f.direction === "out") &&
      typeof f.zecAmountZat === "number",
  );
}

/** Test seam: the memo is module state, and a test that shares it with another is not one. */
export function resetCrossChainChainListMemo(): void {
  chainListMemo.reset();
}

/**
 * One protocol's aggregate, with the narrowing checked rather than assumed. An API that
 * dropped `?protocol=` would give every card the whole market's totals; one that dropped
 * `?from=` would answer all-time under a `30D` chip. Both are well-formed answers, so the
 * store must echo what it applied; a missing echo (an older deployment) fails too.
 */
async function protocolAggregate(
  config: CrossChainApiConfig,
  protocol: CrossChainProtocol,
  groupBy: CrossChainGroupBy,
  fromDay: string | null,
  fromTimestamp: number | null,
): Promise<CrossChainAggregate> {
  const params = new URLSearchParams({ groupBy, protocol });
  if (fromDay !== null) params.set("from", fromDay);
  const res = await request(config, `/crosschain/aggregate?${params}`);
  if (!res.ok)
    throw new Error(`cross-chain API returned ${res.status} for the ${protocol} aggregate`);
  const body = (await res.json()) as Partial<CrossChainAggregate>;
  if (
    typeof body?.totals?.in?.zecAmountZat !== "number" ||
    typeof body?.totals?.out?.zecAmountZat !== "number" ||
    !Array.isArray(body.groups) ||
    typeof body.lastAt !== "number" ||
    typeof body.firstAt !== "number"
  ) {
    throw new Error("cross-chain API returned an unrecognised aggregate shape");
  }
  const applied = body.applied as { protocol?: unknown; fromTimestamp?: unknown } | undefined;
  if (applied?.protocol !== protocol) {
    throw new Error(`cross-chain API ignored the protocol narrowing for ${protocol}`);
  }
  if (fromTimestamp !== null && applied.fromTimestamp !== fromTimestamp) {
    throw new Error(`cross-chain API ignored the window for ${protocol}`);
  }
  return body as CrossChainAggregate;
}

/**
 * The protocol's largest swap in the window, read from the public
 * `/v1/crosschain/transfers/top` — the only route that ranks.
 *
 * That route publishes no echo, but each row carries its own protocol and timestamp, so the
 * answer is checked against the narrowing directly. A row from another protocol or from
 * before the window means the narrowing was dropped, and the answer is refused.
 */
async function protocolLargest(
  config: CrossChainApiConfig,
  protocol: CrossChainProtocol,
  fromDay: string | null,
  fromTimestamp: number | null,
): Promise<CrossChainSwapRef | null> {
  const params = new URLSearchParams({ protocol, by: "zec", limit: "1" });
  if (fromDay !== null) params.set("from", fromDay);
  const res = await request(config, `/v1/crosschain/transfers/top?${params}`);
  if (!res.ok) throw new Error(`public API returned ${res.status} for the ${protocol} top swap`);
  const body = (await res.json()) as { items?: unknown };
  if (!Array.isArray(body.items)) throw new Error("public API returned an unrecognised top shape");
  const row = body.items[0] as
    | {
        id?: unknown;
        protocol?: unknown;
        direction?: unknown;
        timestamp?: unknown;
        zecAmountZat?: unknown;
        legs?: { zcash?: { usdAtSwap?: unknown }; counterpart?: { chain?: unknown } };
      }
    | undefined;
  if (row === undefined) return null;
  if (
    typeof row.id !== "string" ||
    (row.direction !== "in" && row.direction !== "out") ||
    typeof row.timestamp !== "number" ||
    typeof row.zecAmountZat !== "number" ||
    typeof row.legs?.counterpart?.chain !== "string"
  ) {
    throw new Error("public API returned an unrecognised top transfer");
  }
  if (row.protocol !== protocol || (fromTimestamp !== null && row.timestamp < fromTimestamp)) {
    throw new Error(`public API ignored the narrowing on the ${protocol} top swap`);
  }
  const usd = row.legs.zcash?.usdAtSwap;
  return {
    id: row.id,
    direction: row.direction,
    counterpartChain: row.legs.counterpart.chain,
    zecAmountZat: row.zecAmountZat,
    usdValueAtSwap: typeof usd === "number" && Number.isFinite(usd) ? usd : null,
    timestamp: row.timestamp,
  };
}

/**
 * The protocols tab's summary, held for a minute per warm instance and per window.
 *
 * The route is `force-no-store`, so without this every view would cost six to nine upstream
 * reads, three of them against the keyless, rate-limited /v1 surface. A module memo (see
 * `chainList`) rather than the Data Cache; a failure is never stored.
 */
const PROTOCOL_MEMO_MS = 60_000;
const protocolMemo = new Map<string, { at: number; value: Promise<CrossChainProtocolSummary> }>();

/** Test seam, for the reason `resetCrossChainChainListMemo` exists. */
export function resetCrossChainProtocolMemo(): void {
  protocolMemo.clear();
}

async function loadProtocols(
  config: CrossChainApiConfig,
  windowDays: number | null,
): Promise<CrossChainProtocolSummary> {
  const windowStart = protocolWindowStart(windowDays, Math.floor(Date.now() / 1_000));
  const fromDay = windowStart === null ? null : utcDayFromSeconds(windowStart);
  const protocols = await Promise.all(
    CROSSCHAIN_PROTOCOLS.map(async (protocol): Promise<CrossChainProtocolStats> => {
      const [windowed, allTime, largest] = await Promise.all([
        protocolAggregate(config, protocol, "chain", fromDay, windowStart),
        // Under ALL the windowed read is already the all-time one.
        fromDay === null ? null : protocolAggregate(config, protocol, "none", null, null),
        // The one cell allowed to fail alone: it costs a row on a card, where losing an aggregate
        // costs every figure. Its failure renders as unmeasured, never as "no swaps".
        protocolLargest(config, protocol, fromDay, windowStart).catch(() => "unavailable" as const),
      ]);
      return protocolStatsFromAggregate(protocol, windowed, allTime ?? windowed, largest);
    }),
  );
  return { windowDays, windowStart, protocols: orderProtocols(protocols) };
}

function protocols(
  config: CrossChainApiConfig,
  windowDays: number | null,
): Promise<CrossChainProtocolSummary> {
  const key = String(windowDays);
  const hit = protocolMemo.get(key);
  if (hit && Date.now() - hit.at < PROTOCOL_MEMO_MS) return hit.value;
  const value = loadProtocols(config, windowDays);
  protocolMemo.set(key, { at: Date.now(), value });
  value.catch(() => {
    if (protocolMemo.get(key)?.value === value) protocolMemo.delete(key);
  });
  return value;
}

export function createCrossChainApiSource(config: CrossChainApiConfig) {
  return {
    async getCrossChainVolume(): Promise<CrossChainVolume> {
      const res = await request(config, "/crosschain/volume");
      if (!res.ok) throw new Error(`cross-chain API returned ${res.status} for volume`);
      const body = (await res.json()) as CrossChainVolume;
      if (
        typeof body?.in?.zecAmountZat !== "number" ||
        typeof body?.out?.zecAmountZat !== "number"
      ) {
        throw new Error("cross-chain API returned an unrecognised volume shape");
      }
      return body;
    },

    async getCrossChainVolumeSeries(): Promise<CrossChainVolumeSeries> {
      const res = await request(config, "/crosschain/volume-series");
      if (!res.ok) throw new Error(`cross-chain API returned ${res.status} for volume series`);
      const body = (await res.json()) as CrossChainVolumeSeries;
      if (!Array.isArray(body?.monthly) || !Array.isArray(body?.daily)) {
        throw new Error("cross-chain API returned an unrecognised volume series shape");
      }
      return body;
    },

    async getChainInflow(): Promise<ChainInflowPoint[]> {
      const res = await request(config, "/crosschain/inflow-by-chain");
      if (!res.ok) throw new Error(`cross-chain API returned ${res.status} for inflow by chain`);
      const body = (await res.json()) as unknown;
      if (
        !Array.isArray(body) ||
        !body.every(
          (p: ChainInflowPoint) =>
            typeof p.timestamp === "number" &&
            typeof p.chain === "string" &&
            typeof p.inZat === "number",
        )
      ) {
        throw new Error("cross-chain API returned an unrecognised inflow by chain shape");
      }
      return body as ChainInflowPoint[];
    },

    async getChainOutflow(): Promise<ChainOutflowPoint[]> {
      const res = await request(config, "/crosschain/outflow-by-chain");
      if (!res.ok) throw new Error(`cross-chain API returned ${res.status} for outflow by chain`);
      const body = (await res.json()) as unknown;
      if (
        !Array.isArray(body) ||
        !body.every(
          (p: ChainOutflowPoint) =>
            typeof p.timestamp === "number" &&
            typeof p.chain === "string" &&
            typeof p.outZat === "number",
        )
      ) {
        throw new Error("cross-chain API returned an unrecognised outflow by chain shape");
      }
      return body as ChainOutflowPoint[];
    },

    async getVenueMonths(): Promise<VenueMonthPoint[]> {
      const res = await request(config, "/crosschain/venue-months");
      if (!res.ok) throw new Error(`cross-chain API returned ${res.status} for venue months`);
      const body = (await res.json()) as unknown;
      if (
        !Array.isArray(body) ||
        !body.every(
          (p: VenueMonthPoint) =>
            typeof p.timestamp === "number" &&
            typeof p.protocol === "string" &&
            typeof p.inZat === "number" &&
            typeof p.outZat === "number",
        )
      ) {
        throw new Error("cross-chain API returned an unrecognised venue months shape");
      }
      return body as VenueMonthPoint[];
    },

    async getInflowKinds(): Promise<InflowKindMonthPoint[]> {
      const res = await request(config, "/crosschain/inflow-kinds");
      if (!res.ok) throw new Error(`cross-chain API returned ${res.status} for inflow kinds`);
      const body = (await res.json()) as unknown;
      if (
        !Array.isArray(body) ||
        !body.every(
          (p: InflowKindMonthPoint) =>
            typeof p.timestamp === "number" &&
            (p.kind === null || typeof p.kind === "string") &&
            typeof p.transfers === "number" &&
            typeof p.zat === "number",
        )
      ) {
        throw new Error("cross-chain API returned an unrecognised inflow kinds shape");
      }
      return body as InflowKindMonthPoint[];
    },

    async countCrossChainTransfers(filters: CrossChainFilters = {}): Promise<number> {
      const params = new URLSearchParams();
      applyFilters(params, filters);
      const res = await request(config, `/crosschain/transfers-count?${params}`);
      if (!res.ok) throw new Error(`cross-chain API returned ${res.status} for count`);
      const body = (await res.json()) as { total?: unknown };
      if (typeof body.total !== "number") {
        throw new Error("cross-chain API returned an unrecognised count shape");
      }
      return body.total;
    },

    async listCrossChainTransfers(
      query: CursorQuery,
      filters: CrossChainFilters = {},
    ): Promise<CursorPage<CrossChainTransfer>> {
      const params = cursorSearchParams(query);
      applyFilters(params, filters);

      const res = await request(config, `/crosschain/transfers?${params}`);
      if (!res.ok) throw new Error(`cross-chain API returned ${res.status}`);

      const body: unknown = await res.json();
      const page = body as Partial<CursorPage<CrossChainTransfer>> & { applied?: unknown };
      if (!Array.isArray(page.items) || !page.items.every(isTransfer)) {
        throw new Error("cross-chain API returned an unrecognised page shape");
      }
      assertChainFiltersApplied(filters, page.applied);
      return {
        // Normalise an absent `counterpartUsdAtSwap` to null: an older API omits it, and
        // `undefined` would pass a `!== null` guard and render "$NaN".
        items: page.items.map((t) => ({
          ...t,
          counterpartUsdAtSwap:
            typeof t.counterpartUsdAtSwap === "number" && Number.isFinite(t.counterpartUsdAtSwap)
              ? t.counterpartUsdAtSwap
              : null,
        })),
        nextCursor: typeof page.nextCursor === "string" ? page.nextCursor : null,
        prevCursor: typeof page.prevCursor === "string" ? page.prevCursor : null,
      };
    },

    async getCrossChainChains(): Promise<CrossChainFlow[]> {
      return chainList(config);
    },

    async getCrossChainFlows(windowDays: number | null = null): Promise<CrossChainFlowSummary> {
      const res = await request(
        config,
        windowDays === null ? "/crosschain/flows" : `/crosschain/flows?days=${windowDays}`,
      );
      if (!res.ok) throw new Error(`cross-chain API returned ${res.status}`);
      const body = (await res.json()) as Partial<CrossChainFlowSummary>;
      if (!Array.isArray(body.flows) || typeof body.lastAt !== "number") {
        throw new Error("cross-chain API returned an unrecognised flows shape");
      }
      /*
       * The window asked for must be the window applied. An API one deploy behind ignores an
       * unknown `?days=` and answers all-time, a well-formed aggregate that would render under a
       * `30D` chip. Scoped to requests that asked for a window; a missing `windowDays` fails.
       */
      if (windowDays !== null && body.windowDays !== windowDays) {
        throw new Error("cross-chain API ignored the flows window");
      }
      return {
        flows: body.flows,
        firstAt: body.firstAt ?? 0,
        lastAt: body.lastAt,
        windowDays,
        /*
         * The trend comparison degrades rather than failing — the opposite of the window check.
         * A missing `previous` only means no trend column (the figures are still what the chips
         * claim), so anything unrecognised is treated as absent.
         */
        previous: isPreviousWindow(body.previous) ? body.previous : { kind: "none" },
      };
    },

    async getCrossChainProtocols(
      windowDays: number | null = null,
    ): Promise<CrossChainProtocolSummary> {
      return protocols(config, windowDays);
    },

    async getCrossChainTransfer(id: string): Promise<CrossChainTransfer | undefined> {
      const res = await request(config, `/crosschain/transfers/${encodeURIComponent(id)}`);
      // Only a 404 means "no such transfer". Every other failure must reject.
      if (res.status === 404) return undefined;
      if (!res.ok) throw new Error(`cross-chain API returned ${res.status}`);

      const body: unknown = await res.json();
      if (!isTransfer(body)) {
        throw new Error("cross-chain API returned an unrecognised transfer shape");
      }
      return {
        ...body,
        counterpartUsdAtSwap:
          typeof body.counterpartUsdAtSwap === "number" &&
          Number.isFinite(body.counterpartUsdAtSwap)
            ? body.counterpartUsdAtSwap
            : null,
      };
    },

    async listCrossChainTransfersForZcashTx(txid: string): Promise<ZcashTxCrossings> {
      const asked = txid.toLowerCase();
      const path = `/crosschain/transfers/by-zcash-tx/${encodeURIComponent(asked)}`;
      const res = await request(config, path);
      // No 404 branch: an empty list is the answer for a transaction that crossed nothing, so a
      // 404 means the route is missing (an older API) and must fail loudly. ` for ` keeps a 5xx
      // classified as transient, so the page drops the strip instead of failing.
      if (!res.ok) throw new Error(`cross-chain API returned ${res.status} for ${path}`);

      const body = (await res.json()) as {
        zcashTxid?: unknown;
        transfers?: unknown;
        total?: unknown;
      };
      // The echo: a route that ignored the parameter would answer about another txid with a
      // well-formed list.
      if (body.zcashTxid !== asked) {
        throw new Error("cross-chain API answered for a different Zcash transaction");
      }
      if (!Array.isArray(body.transfers) || !body.transfers.every(isTransfer)) {
        throw new Error("cross-chain API returned an unrecognised transfers shape");
      }
      // The total is what makes a bounded list honest; one below the row count is a broken answer.
      if (
        typeof body.total !== "number" ||
        !Number.isInteger(body.total) ||
        body.total < body.transfers.length
      ) {
        throw new Error("cross-chain API returned no usable total for a Zcash transaction");
      }
      return {
        total: body.total,
        transfers: body.transfers.map((t) => ({
          ...t,
          counterpartUsdAtSwap:
            typeof t.counterpartUsdAtSwap === "number" && Number.isFinite(t.counterpartUsdAtSwap)
              ? t.counterpartUsdAtSwap
              : null,
        })),
      };
    },
  };
}
