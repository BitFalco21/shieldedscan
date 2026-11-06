import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExplorerDataSource } from "@/data/source";
import { fixtureDataSource } from "@/data/fixture-source";

/**
 * Degrade, don't die: one read failing transiently costs its own section, the rest of the page
 * renders, the section says it did not load and offers a retry, and no figure stands in for the
 * one we could not read. The page itself still renders, as an ordinary 200.
 */

const failing = new Map<keyof ExplorerDataSource, () => Error>();

const source = new Proxy(fixtureDataSource, {
  get(target, property, receiver) {
    const value: unknown = Reflect.get(target, property, receiver);
    const fail = failing.get(property as keyof ExplorerDataSource);
    if (typeof value !== "function" || fail === undefined) return value;
    return () => Promise.reject(fail());
  },
});

vi.mock("@/data", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/data")>()),
  getDataSource: () => source,
  getCachedDataSource: () => source,
}));

const timeout = () =>
  Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
const shapeError = () => new Error("unrecognised transactions shape");

function failWith(method: keyof ExplorerDataSource, error: () => Error = timeout) {
  failing.set(method, error);
}

beforeEach(() => {
  // The live feed polls on mount; it must not reach the network or resolve.
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise(() => {})),
  );
});

afterEach(() => {
  failing.clear();
  vi.unstubAllGlobals();
});

/** The unavailable panel naming `what`: a retry button, and not a single digit inside it. */
function unavailablePanel(what: RegExp): HTMLElement {
  const panel = screen.getAllByRole("status").find((el) => what.test(el.textContent ?? ""));
  expect(panel, `an unavailable panel for ${what}`).toBeDefined();
  expect(within(panel!).getByRole("button", { name: "Try again" })).toBeTruthy();
  expect(panel!.textContent).not.toMatch(/\d/);
  return panel!;
}

const TRANSPARENT_ADDR = "t1XWk29dAliceFixtureAddr000001";
const SHIELDED_TXID = "a3f29c4e".padEnd(64, "0");
const TIP_HEIGHT = 2_481_032;

describe("/txs", () => {
  const page = async () => {
    const { default: Page } = await import("../txs/page");
    return Page({ searchParams: Promise.resolve({}) });
  };

  it("renders whole when every read succeeds", async () => {
    const element = await page();
    render(element);
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.queryByText("TEMPORARILY UNAVAILABLE")).toBeNull();
  });

  it("keeps the header, filters and cards when the rows did not load", async () => {
    failWith("listTransactions");
    const element = await page();
    render(element);
    unavailablePanel(/This page of transactions could not be read/);
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByRole("heading", { name: "Transactions" })).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Filter by privacy kind" })).toBeTruthy();
    // The cards that did load still show their figures.
    expect(screen.getByText("TOTAL TRANSACTIONS").parentElement?.textContent).toMatch(/\d/);
    // No live indicator claiming to grow a list that is not there.
    expect(screen.queryByText(/^live$/i)).toBeNull();
  });

  it("drops only the cards' figures when the counts did not load", async () => {
    failWith("getTxCounts");
    const element = await page();
    render(element);
    expect(screen.getByRole("table")).toBeTruthy();
    const card = screen.getByText("TOTAL TRANSACTIONS").parentElement!;
    expect(card.textContent).toMatch(/unavailable/);
    expect(card.textContent).not.toMatch(/\d{2,}/);
  });

  it("keeps the rows when the price history did not load", async () => {
    // An optional figure: its failure must stay a section failure, not a crash.
    failWith("getDailyPriceMap");
    const element = await page();
    render(element);
    // Rows on the tip's own day are still priced at the current price, as they always are.
    expect(screen.getByRole("table")).toBeTruthy();
  });

  it("does not render rows without the tip their ages are measured from", async () => {
    failWith("getChainInfo");
    const element = await page();
    render(element);
    unavailablePanel(/This page of transactions/);
    expect(screen.getByText("TPS (24H)").parentElement?.textContent).toMatch(/unavailable/);
  });

  it("still throws on a shape error, so version skew stays loud", async () => {
    failWith("listTransactions", shapeError);
    await expect(page()).rejects.toThrow(/unrecognised/);
  });
});

describe("/blocks", () => {
  const page = async () => {
    const { default: Page } = await import("../blocks/page");
    return Page({ searchParams: Promise.resolve({}) });
  };

  it("keeps the header and cards when the rows did not load", async () => {
    failWith("listBlocks");
    const element = await page();
    render(element);
    unavailablePanel(/This page of blocks could not be read/);
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByRole("heading", { name: "Blocks" })).toBeTruthy();
    expect(screen.getByText(/A total of/)).toBeTruthy();
  });

  it("states no total and no target when the tip did not load", async () => {
    failWith("getChainInfo");
    render(await page());
    unavailablePanel(/This page of blocks/);
    expect(screen.queryByText(/A total of/)).toBeNull();
    expect(screen.queryByText(/target is/)).toBeNull();
  });
});

describe("/address/[addr]", () => {
  const page = async (addr = TRANSPARENT_ADDR) => {
    const { default: Page } = await import("../address/[addr]/page");
    return Page({ params: Promise.resolve({ addr }), searchParams: Promise.resolve({}) });
  };

  it("keeps the balances when the history did not load", async () => {
    failWith("getAddressTransactions");
    const element = await page();
    render(element);
    unavailablePanel(/This address's history could not be read/);
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText("BALANCE").parentElement?.textContent).toMatch(/\d/);
  });

  it("drops the history and the dollar lines, never the balances, when the tip did not load", async () => {
    failWith("getChainInfo");
    render(await page());
    unavailablePanel(/This address's history/);
    expect(screen.getByText("BALANCE").parentElement?.textContent).toMatch(/ZEC/);
    expect(document.body.textContent).not.toMatch(/\$/);
  });

  it("says the address did not load, under the address, rather than that it does not exist", async () => {
    failWith("getAddress");
    const element = await page();
    render(element);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(TRANSPARENT_ADDR);
    unavailablePanel(/This address could not be read/);
    expect(screen.queryByText("BALANCE")).toBeNull();
  });
});

describe("/tx/[txid]", () => {
  const page = async (txid = SHIELDED_TXID) => {
    const { default: Page } = await import("../tx/[txid]/page");
    return Page({ params: Promise.resolve({ txid }) });
  };

  it("says the transaction did not load, under its id", async () => {
    failWith("getTransaction");
    const element = await page();
    render(element);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(SHIELDED_TXID);
    unavailablePanel(/This transaction could not be read/);
  });

  it("states no confirmation count when the tip did not load", async () => {
    failWith("getChainInfo");
    const element = await page();
    render(element);
    expect(screen.getByText(/Confirmed · confirmations/).textContent).toMatch(/unavailable/);
    expect(document.body.textContent).not.toMatch(/\d confirmations/);
  });

  it("says the swap lookup did not load instead of implying there was no swap", async () => {
    failWith("listCrossChainTransfersForZcashTx");
    const element = await page();
    render(element);
    expect(screen.getByText(/Cross-chain swap lookup/).textContent).toMatch(/unavailable/);
  });
});

describe("/block/[id]", () => {
  const page = async (id = String(TIP_HEIGHT)) => {
    const { default: Page } = await import("../block/[id]/page");
    return Page({ params: Promise.resolve({ id }) });
  };

  it("keeps the block when its transactions did not load", async () => {
    failWith("getBlockTransactions");
    const element = await page();
    render(element);
    unavailablePanel(/This block's transactions could not be read/);
    expect(screen.getByText("BLOCK REWARD")).toBeTruthy();
  });

  it("states no confirmations and links no neighbour it cannot vouch for, without the tip", async () => {
    failWith("getChainInfo");
    failWith("getOldestHeight");
    render(await page(String(TIP_HEIGHT - 1)));
    expect(screen.getByText(/confirmations/).textContent).toMatch(/unavailable/);
    expect(screen.queryByRole("navigation", { name: "Adjacent blocks" })).toBeNull();
  });

  it("says the block did not load, under what was asked", async () => {
    failWith("getBlock");
    render(await page());
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(String(TIP_HEIGHT));
    unavailablePanel(/This block could not be read/);
  });
});

describe("/", () => {
  const page = async () => {
    const { default: Page } = await import("../page");
    return Page();
  };

  it("keeps every other panel when the latest blocks did not load", async () => {
    failWith("listLatestBlocks");
    const element = await page();
    render(element);
    unavailablePanel(/The latest blocks could not be read/);
    expect(screen.getByText("LATEST TRANSACTIONS")).toBeTruthy();
    expect(screen.getAllByRole("link", { name: /^Transfer / }).length).toBeGreaterThan(0);
  });

  it("keeps the page when the cross-chain store answers 503", async () => {
    failWith("listCrossChainTransfers", () => new Error("cross-chain API returned 503"));
    const element = await page();
    render(element);
    unavailablePanel(/The latest cross-chain swaps could not be read/);
    expect(screen.getByText("LATEST BLOCKS")).toBeTruthy();
  });

  it("drops only the shielded-supply figure when the pools did not load", async () => {
    failWith("getPools");
    render(await page());
    expect(screen.getByText("SHIELDED SUPPLY").parentElement?.textContent).toMatch(/unavailable/);
  });

  it("lets the chain facts' failure reach the error boundary as the transient failure it is", async () => {
    failWith("getChainInfo");
    await expect(page()).rejects.toMatchObject({ name: "TimeoutError" });
  });
});
