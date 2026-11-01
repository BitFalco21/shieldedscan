import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { transactions } from "@/fixtures/transactions";
import { TxsListPage, type TxsListPageProps } from "../TxsListPage";

/** The pool filter's claims: named and removable when applied, and no rows when it was not. */

const props: TxsListPageProps = {
  txs: [transactions[0]!],
  now: transactions[0]!.timestamp,
  activeKind: "all",
  activePool: null,
  poolUnavailable: false,
  totalForKind: null,
  dailyUsd: {},
  priceUsd: null,
  counts: { all: 100, shielded: 40 },
  fees24h: null,
  txCount24h: null,
  newerHref: null,
  olderHref: null,
  newestHref: "/txs",
  oldestHref: null,
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise(() => {})),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const poolFilter = () => screen.queryByRole("navigation", { name: "Active pool filter" });

describe("TxsListPage pool filter", () => {
  it("names the applied pool as a removable filter, with no kind chip lit", () => {
    render(<TxsListPage {...props} activePool="sprout" />);
    const nav = poolFilter();
    expect(nav).not.toBeNull();
    const remove = within(nav!).getByRole("link", { name: /Remove SPROUT/ });
    expect(remove.getAttribute("href")).toBe("/txs");
    const kinds = screen.getByRole("navigation", { name: "Filter by privacy kind" });
    expect(kinds.querySelector('[aria-current="page"]')).toBeNull();
    // Kind chips leave the pool view rather than combining with it.
    expect(within(kinds).getByRole("link", { name: "SHIELDED" }).getAttribute("href")).toBe(
      "/txs?kind=shielded",
    );
    expect(screen.getByRole("table")).toBeTruthy();
  });

  it("shows no rows, and says the filter is unavailable, when the pool was not applied", () => {
    render(<TxsListPage {...props} activePool="orchard" poolUnavailable txs={[]} />);
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText(/Filtering by pool is/).textContent).toMatch(/unavailable/);
    // Still removable, so the reader has a way back.
    expect(poolFilter()).not.toBeNull();
  });

  it("names the pool in its empty state", () => {
    render(<TxsListPage {...props} activePool="ironwood" txs={[]} />);
    expect(screen.getByText(/No Ironwood transactions/)).toBeTruthy();
  });

  it("renders no pool filter and keeps the kind chip lit without a pool", () => {
    render(<TxsListPage {...props} activeKind="shielded" />);
    expect(poolFilter()).toBeNull();
    const kinds = screen.getByRole("navigation", { name: "Filter by privacy kind" });
    expect(kinds.querySelector('[aria-current="page"]')?.textContent).toBe("SHIELDED");
  });
});
