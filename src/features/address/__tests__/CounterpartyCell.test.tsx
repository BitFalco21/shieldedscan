import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Transaction } from "@/domain";
import { CounterpartyCell } from "../CounterpartyCell";
import { COUNTERPARTY_LIST_LIMIT } from "../CounterpartyList";

const ME = "t1MKn34KBa8Xh4g8qU8psibBXvURafphVn7";
const party = (n: number) => `t1Party${String(n).padStart(26, "0")}`;

const base: Transaction = {
  txid: "ab".repeat(32),
  blockHeight: 3_426_950,
  blockHash: "0b".repeat(32),
  timestamp: 1_783_875_480,
  isCoinbase: false,
  version: 5,
  sizeBytes: 400,
  lockTime: 0,
  expiryHeight: null,
  rawHex: null,
  feeZat: 10_000,
  bindingSigValid: null,
  transparentInputs: [],
  transparentOutputs: [],
  sprout: null,
  sapling: null,
  orchard: null,
  ironwood: null,
};

function cell(tx: Partial<Transaction>) {
  const { container } = render(
    <table>
      <tbody>
        <tr>
          <CounterpartyCell tx={{ ...base, ...tx }} address={ME} />
        </tr>
      </tbody>
    </table>,
  );
  return container.querySelector("td")!;
}

describe("CounterpartyCell", () => {
  it("names a single other party inline, with no list to open", () => {
    const td = cell({
      transparentInputs: [{ address: party(1), valueZat: 500 }],
      transparentOutputs: [{ address: ME, valueZat: 490 }],
    });
    expect(td.textContent).toMatch(/^from/);
    expect(td.querySelector("details")).toBeNull();
    expect(td.querySelector(`a[href="/address/${party(1)}"]`)).not.toBeNull();
  });

  it("summarises several by a count that names nobody, and lists them all in on-chain order", () => {
    const td = cell({
      transparentInputs: [3, 1, 2].map((n) => ({ address: party(n), valueZat: 100 })),
      transparentOutputs: [{ address: ME, valueZat: 290 }],
    });
    const summary = td.querySelector("summary")!;
    expect(summary.textContent).toBe("3 inputs");
    expect(summary.getAttribute("aria-label")).toBe("3 inputs");
    expect(summary.querySelector("a")).toBeNull();
    const panel = td.querySelector("details > div")!;
    expect(within(panel as HTMLElement).getByText("INPUTS")).toBeTruthy();
    const hrefs = [...panel.querySelectorAll("a[href^='/address/']")].map((a) =>
      a.getAttribute("href"),
    );
    expect(hrefs).toEqual([3, 1, 2].map((n) => `/address/${party(n)}`));
  });

  it("opens in place below lg and floats only from lg, where the table no longer scrolls", () => {
    const td = cell({
      transparentInputs: [{ address: ME, valueZat: 1_000 }],
      transparentOutputs: [
        { address: party(1), valueZat: 400 },
        { address: party(2), valueZat: 590 },
      ],
    });
    const panel = td.querySelector("details > div")!;
    expect(panel.className).toContain("lg:absolute");
    expect(panel.className).not.toMatch(/(^|\s)absolute/);
    expect(td.querySelector("summary")!.textContent).toBe("2 outputs");
    expect(within(panel as HTMLElement).getByText("OTHER OUTPUTS")).toBeTruthy();
  });

  it("names the pool a shielding went into before counting the change", () => {
    const td = cell({
      transparentInputs: [{ address: ME, valueZat: 1_000 }],
      transparentOutputs: [{ address: party(1), valueZat: 190 }],
      ironwood: { actions: 2, valueBalanceZat: 800 },
    });
    expect(td.querySelector("summary")!.textContent).toBe("ironwood + 1 output");
  });

  it("caps a sweep's list and points to the transaction", () => {
    const many = COUNTERPARTY_LIST_LIMIT + 7;
    const td = cell({
      transparentInputs: Array.from({ length: many }, (_, i) => ({
        address: party(i),
        valueZat: 1,
      })),
      transparentOutputs: [{ address: ME, valueZat: many - 1 }],
    });
    const panel = td.querySelector("details > div")!;
    expect(panel.querySelectorAll("li")).toHaveLength(COUNTERPARTY_LIST_LIMIT);
    expect(screen.getByText(/First 50 of 57: see the transaction/)).toBeTruthy();
  });

  it("says itself when nobody else took part", () => {
    const td = cell({
      transparentInputs: [{ address: ME, valueZat: 1_000 }],
      transparentOutputs: [{ address: ME, valueZat: 990 }],
    });
    expect(td.textContent).toBe("itself");
  });

  it("draws no amount for a pool that publishes none, never a zero", () => {
    const td = cell({
      transparentOutputs: [{ address: ME, valueZat: 500 }],
      sprout: { joinSplits: 1 },
    });
    expect(td.textContent).toMatch(/from\s*sprout/i);
    expect(td.textContent).not.toMatch(/\b0\b/);
  });
});
