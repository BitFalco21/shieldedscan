import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { combineFlows, EXCHANGES, type ExchangeFlowWindow } from "@/domain";
import { getExchangeFlows, getExchangeMovements } from "@/fixtures/exchange-flows";
import { formatZecWhole } from "@/lib/format";
import { ExchangeFlowsPage } from "../ExchangeFlowsPage";
import { EXCHANGE_FLOW_TIPS } from "../flow-copy";

const href = () => "/exchanges";

function page(flows: ExchangeFlowWindow = getExchangeFlows(30), exchange: "gemini" | null = null) {
  return render(
    <ExchangeFlowsPage
      flows={flows}
      movements={getExchangeMovements(30, exchange, flows.counted!.to)}
      reserves={null}
      range="30d"
      exchange={exchange}
      href={href}
    />,
  );
}

describe("ExchangeFlowsPage", () => {
  it("states every exchange together, a move between two of them left out of in and out", () => {
    const flows = getExchangeFlows(30);
    const all = combineFlows(flows.totals, EXCHANGES)!;
    page(flows);
    expect(all.betweenZat).toBeGreaterThan(0);
    const between = screen.getByText("EXCHANGE TO EXCHANGE").closest(".stat-card")!;
    expect(within(between as HTMLElement).getByText(formatZecWhole(all.betweenZat))).toBeTruthy();
    const inCard = screen.getByText("IN").closest(".stat-card")!;
    expect(within(inCard as HTMLElement).getByText(formatZecWhole(all.in.zat))).toBeTruthy();
  });

  it("gives no transaction count for every exchange together, which would count a move twice", () => {
    page();
    const inCard = screen.getByText("IN").closest(".stat-card")!;
    expect(inCard.textContent).not.toMatch(/transactions/);
    expect(screen.getByText("WHERE IT CAME FROM").closest("section")!.textContent).not.toMatch(
      /transactions/,
    );
  });

  it("keeps the page and its controls when the flows cannot be read", () => {
    render(
      <ExchangeFlowsPage
        flows={null}
        movements={null}
        reserves={null}
        range="30d"
        exchange={null}
        href={href}
      />,
    );
    expect(screen.getByRole("heading", { name: "Exchange flows" })).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Window" })).toBeTruthy();
    expect(screen.getByText(/The exchange flows/)).toBeTruthy();
  });

  it("states net as in − out − own-wallet fees, the change in what they hold", () => {
    const flows = getExchangeFlows(30);
    const one = combineFlows(flows.totals, ["gemini"])!;
    page(flows, "gemini");
    const net = one.in.zat - one.out.zat - one.internalFeeZat;
    const card = screen.getByText("NET").closest(".stat-card")!;
    expect(card.textContent).toContain(formatZecWhole(Math.abs(net)));
    expect(screen.getByText("OWN-WALLET MOVES")).toBeTruthy();
  });

  it("says what Gemini's figures leave out, on the table and when it is chosen", () => {
    page(getExchangeFlows(30), "gemini");
    // Once in the table's tip, once as the line under the stats.
    expect(screen.getAllByText(EXCHANGE_FLOW_TIPS.gemini!)).toHaveLength(2);
  });

  it("names a fee below a coin, never rounds it to zero", () => {
    page();
    const went = screen.getByText("WHERE IT WENT").closest("section")!;
    const fees = within(went as HTMLElement)
      .getAllByText("Fees")[0]!
      .closest(".py-2")!;
    // The desktop figure: jsdom renders the phone form beside it, as CSS would hide one.
    const wide = fees.querySelector('[title$="zatoshi"] .sm\\:inline')!;
    expect(wide.textContent).toMatch(/^0\.\d+ ZEC$/);
  });

  it("opens other exchanges into one row each", () => {
    page(getExchangeFlows(30), "gemini");
    const came = screen.getByText("WHERE IT CAME FROM").closest("section")!;
    const details = (came as HTMLElement).querySelector("details")!;
    expect(details.querySelector("summary")!.textContent).toMatch(/Other exchanges \(\d\)/);
    expect(details.querySelectorAll("img").length).toBeGreaterThan(0);
  });

  it("shows an exchange it cannot count as unmeasured, never as zero", () => {
    const flows = getExchangeFlows(30);
    page({ ...flows, totals: { ...flows.totals, okx: null } });
    const table = screen.getByRole("table", { name: /each exchange/ });
    const row = within(table).getByRole("link", { name: "OKX" }).closest("tr")!;
    expect(row.textContent).toMatch(/unavailable/i);
    // Every exchange together cannot be stated without it.
    const inCard = screen.getByText("IN").closest(".stat-card")!;
    expect(inCard.textContent).toMatch(/unavailable/i);
  });
});
