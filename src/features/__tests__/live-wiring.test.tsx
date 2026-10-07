import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { blockSummaryOf } from "@/domain";
import { blocks } from "@/fixtures/blocks";
import { transactions } from "@/fixtures/transactions";
import { crossChainTransfers } from "@/fixtures/crosschain";
import { EMPTY_CROSSCHAIN_FILTERS } from "@/features/crosschain/crossChainHref";
import { BlocksListPage } from "@/features/blocks/BlocksListPage";
import { TxsListPage } from "@/features/transactions/TxsListPage";
import { CrossChainListPage } from "@/features/crosschain/CrossChainListPage";

/**
 * That the pages actually supply the live feed what it needs.
 *
 * `use-live-feed.test.ts` proves the hook honours `enabled` and `transferFilters`; this proves
 * the pages pass them. A page that forgets `enabled` polls on page 7 and prepends rows from the
 * tip; one that forgets `transferFilters` shows a reader the rows they excluded. Both render
 * perfectly, so these assert on the request, the only visible evidence of the wiring.
 */

function stubFetch() {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      kind: "all",
      direction: "all",
      tip: { height: 1, hash: "aa", lastBlockTimestamp: 1 },
      blocks: [],
      transactions: [],
      transfers: [],
    }),
  } as Response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Every request this render issued, as query strings. */
const queries = (mock: ReturnType<typeof stubFetch>) => mock.mock.calls.map((c) => String(c[0]));

const blocksProps = {
  tipHeight: blocks[0]!.height,
  dailyUsd: {},
  priceUsd: null,
  fees24h: null,
  txCount24h: null,
  pageSize: 25,
  blocks: [blockSummaryOf(blocks[0]!)],
  now: blocks[0]!.timestamp,
  newerHref: null,
  olderHref: null,
  oldestHref: null,
};

const txsProps = {
  txs: [transactions[0]!],
  now: transactions[0]!.timestamp,
  activeKind: "all" as const,
  totalForKind: null,
  dailyUsd: {},
  priceUsd: null,
  counts: null,
  fees24h: null,
  txCount24h: null,
  newerHref: null,
  olderHref: null,
  oldestHref: null,
};

const transfersProps = {
  transfers: [crossChainTransfers[0]!],
  now: crossChainTransfers[0]!.timestamp,
  total: null,
  volume: null,
  chains: [],
  newerHref: null,
  olderHref: null,
  oldestHref: null,
};

beforeEach(stubFetch);
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("BlocksListPage", () => {
  it("polls when it is showing the tip", async () => {
    const fetchMock = stubFetch();

    render(<BlocksListPage {...blocksProps} newestHref={null} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  });

  it("does NOT poll on a paged view", async () => {
    // `newestHref` being set is what says "there is a newer page than this one", so rows from
    // the tip do not belong here. Polling anyway would prepend them onto page 7.
    const fetchMock = stubFetch();

    render(<BlocksListPage {...blocksProps} newestHref="/blocks" />);

    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("TxsListPage", () => {
  it("polls with the ACTIVE filter, not the unfiltered list", async () => {
    const fetchMock = stubFetch();

    render(<TxsListPage {...txsProps} activeKind="shielded" newestHref={null} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(queries(fetchMock)[0]).toContain("kind=shielded");
  });

  it("does NOT poll on a paged view", async () => {
    const fetchMock = stubFetch();

    render(<TxsListPage {...txsProps} newestHref="/txs" />);

    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("CrossChainListPage", () => {
  it("polls with the active DIRECTION, which the endpoint applies", async () => {
    const fetchMock = stubFetch();

    render(
      <CrossChainListPage
        {...transfersProps}
        filters={{ ...EMPTY_CROSSCHAIN_FILTERS, direction: "in" }}
        newestHref={null}
      />,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(queries(fetchMock)[0]).toContain("direction=in");
  });

  it("keeps polling under a filter rather than switching the feed off", async () => {
    // A filter narrows the feed rather than stopping it: a page that disabled itself whenever
    // anything was selected would look identical to one whose poll had died.
    const fetchMock = stubFetch();

    render(
      <CrossChainListPage
        {...transfersProps}
        filters={{ ...EMPTY_CROSSCHAIN_FILTERS, sourceChains: ["BTC"] }}
        newestHref={null}
      />,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  });

  it("does NOT poll on a paged view", async () => {
    const fetchMock = stubFetch();

    render(
      <CrossChainListPage
        {...transfersProps}
        filters={EMPTY_CROSSCHAIN_FILTERS}
        newestHref="/cross-chain"
      />,
    );

    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
