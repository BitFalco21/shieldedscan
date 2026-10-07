import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { LearnTx } from "@/domain";
import { TxCheckResult, explainTxQuestion } from "../TxCheckResult";

const base: LearnTx = {
  txid: "ab".repeat(32),
  shape: "transparent",
  blockHeight: 3_505_053,
  timestamp: 1_791_043_391,
  feeZat: 10_000,
  inputs: [{ address: "t1VPyM1j4kRbQRzD6fudpv6fzMJzeRoF83x", valueZat: 10_964_248 }],
  outputs: [
    { address: "t1TjYk4jwVyvATrWwDBgreDeJ6HKq2NF9i5", valueZat: 2_000_000 },
    { address: "t1VPyM1j4kRbQRzD6fudpv6fzMJzeRoF83x", valueZat: 8_954_248 },
  ],
  inputCount: 1,
  outputCount: 2,
  inputTotalZat: 10_964_248,
  outputTotalZat: 10_954_248,
  pools: [],
  poolMoves: [],
};

const none: ReadonlySet<string> = new Set();

describe("TxCheckResult", () => {
  it("shows a transparent transaction's amounts to the zatoshi, and marks the reader's own address", () => {
    render(
      <TxCheckResult
        tx={base}
        example={false}
        yours={new Set(["t1TjYk4jwVyvATrWwDBgreDeJ6HKq2NF9i5"])}
        priceUsd={1300.06}
      />,
    );
    expect(screen.getByText("0.10964248 ZEC")).toBeTruthy();
    expect(screen.getByText("you")).toBeTruthy();
    expect(screen.getByText(/found in block 3,505,053/)).toBeTruthy();
    expect(screen.queryAllByRole("img", { name: /value shielded/ })).toHaveLength(0);
  });

  it("never shows a number for a fully shielded transaction: every hidden field is the veil", () => {
    const { container } = render(
      <TxCheckResult
        tx={{
          ...base,
          shape: "shielded",
          inputs: [],
          outputs: [],
          inputCount: 0,
          outputCount: 0,
          inputTotalZat: 0,
          outputTotalZat: 0,
          pools: ["ironwood"],
          poolMoves: [{ pool: "ironwood", valueBalanceZat: -10_000 }],
        }}
        example
        yours={none}
        priceUsd={null}
      />,
    );
    const veils = screen.getAllByRole("img", { name: /value shielded/ });
    expect(veils).toHaveLength(4);
    for (const veil of veils) expect(veil.getAttribute("title")).toMatch(/hidden by design/);
    // The fee is public; nothing else on the card may be a ZEC amount.
    const amounts = container.textContent?.match(/[\d,]+\.\d+ ZEC/g) ?? [];
    expect(amounts).toEqual(["0.0001 ZEC"]);
    expect(screen.getByText(/example · a real recent transaction/)).toBeTruthy();
  });

  it("states a shielding's public side and hides who received it", () => {
    render(
      <TxCheckResult
        tx={{
          ...base,
          shape: "shielding",
          outputs: [],
          outputCount: 0,
          outputTotalZat: 0,
          feeZat: 15_000,
          pools: ["ironwood"],
          poolMoves: [{ pool: "ironwood", valueBalanceZat: 10_949_248 }],
        }}
        example={false}
        yours={none}
        priceUsd={null}
      />,
    );
    expect(screen.getByText("Ironwood pool")).toBeTruthy();
    expect(screen.getByText("0.10949248 ZEC")).toBeTruthy();
    expect(screen.getAllByRole("img", { name: /value shielded/ })).toHaveLength(1);
  });

  it("says a mempool transaction is waiting for its block rather than inventing a height", () => {
    render(
      <TxCheckResult
        tx={{ ...base, blockHeight: null }}
        example={false}
        yours={none}
        priceUsd={null}
      />,
    );
    expect(screen.getByText(/waiting for its first block/)).toBeTruthy();
  });

  it("never narrates who paid whom", () => {
    const { container } = render(
      <TxCheckResult tx={base} example={false} yours={none} priceUsd={null} />,
    );
    expect(container.textContent).not.toMatch(/sent .* to/);
  });
});

describe("what Zeno is asked about a checked transaction", () => {
  it("sends an example's ID, so Zeno can look it up and explain it with its real figures", () => {
    expect(explainTxQuestion(base, true)).toContain(base.txid);
  });

  it("never sends the reader's own transaction, only its kind", () => {
    for (const shape of [
      "transparent",
      "shielding",
      "shielded",
      "unshielding",
      "coinbase",
      "mixed",
    ] as const) {
      const question = explainTxQuestion({ ...base, shape }, false);
      expect(question).not.toContain(base.txid);
      expect(question).not.toMatch(/t1[A-Za-z0-9]{20,}/);
      expect(question).not.toMatch(/\d/);
    }
    expect(explainTxQuestion({ ...base, shape: "shielding" }, false)).toBe(
      "What can anyone see in a shielding transaction?",
    );
  });
});
