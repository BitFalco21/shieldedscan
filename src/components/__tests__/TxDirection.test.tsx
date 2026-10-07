import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Transaction } from "@/domain";
import { TxDirection } from "../TxDirection";
import { DIRECTION_CELL_CLASS, DIRECTION_COLUMN, TxDirectionCell } from "../TxDirectionCell";

/**
 * The DIRECTION cell.
 *
 * Which paths are claimable is `txFlowPath`'s question and is tested against the domain. What is
 * tested here is the drawing: the order names appear in, the arrow's spoken name, and the
 * binding that stops a wrap from orphaning it. Order is asserted as a sequence rather than as
 * presence — `IRONWOOD ORCHARD` for an Orchard→Ironwood migration is true as a set and useless
 * as a sentence.
 */

const base: Transaction = {
  txid: "ab".repeat(32),
  blockHeight: 3_449_072,
  blockHash: "0b".repeat(32),
  timestamp: 1_783_875_480,
  isCoinbase: false,
  version: 5,
  sizeBytes: 1000,
  lockTime: 0,
  expiryHeight: 140,
  rawHex: null,
  feeZat: 10_000,
  bindingSigValid: true,
  transparentInputs: [],
  transparentOutputs: [],
  sprout: null,
  sapling: null,
  orchard: null,
  ironwood: null,
};

/** Mainnet-shaped: Orchard and Sapling drain into Ironwood, leaving the fee behind. */
const migration: Transaction = {
  ...base,
  sapling: { spends: 1, outputs: 2, valueBalanceZat: -10_554_966_347 },
  orchard: { actions: 22, valueBalanceZat: -199_396_763_179 },
  ironwood: { actions: 2, valueBalanceZat: 209_951_599_526 },
};

describe("TxDirection", () => {
  it("draws a migration source-first, with the destination after the arrow", () => {
    const { container } = render(<TxDirection tx={migration} />);
    expect(container.textContent).toBe("orchard+sapling→ironwood");
  });

  it("joins two names on one end with a spoken `+`, kept with the extra end", () => {
    // Without chip borders, `ORCHARD SAPLING` read as one phrase. The `+` sits on the side
    // away from the arrow, so the step stays whole and no line starts with a bare `+`.
    const { container } = render(<TxDirection tx={migration} />);
    const plus = screen.getByRole("img", { name: "and" });
    expect(plus.textContent).toBe("+");
    expect(plus.parentElement?.className).toContain("whitespace-nowrap");
    expect(plus.parentElement?.textContent).toBe("orchard+");
    expect(container.querySelectorAll("[aria-label='moved to']")).toHaveLength(1);
  });

  it("gives the arrow a spoken name rather than leaving it as 'right arrow'", () => {
    render(<TxDirection tx={migration} />);
    expect(screen.getByRole("img", { name: "moved to" })).toBeDefined();
  });

  it("binds the arrow to the chip it points at, so a wrap cannot orphan it", () => {
    const { container } = render(<TxDirection tx={migration} />);
    const arrow = container.querySelector("[aria-label='moved to']");

    expect(arrow?.parentElement?.className).toContain("whitespace-nowrap");
    expect(arrow?.parentElement?.textContent).toBe("→ironwood");
  });

  it("holds the last source, the arrow and the destination on one row from xl up", () => {
    const { container } = render(<TxDirection tx={migration} />);
    const step = container.querySelector("[aria-label='moved to']")?.parentElement?.parentElement;

    expect(step?.className).toContain("xl:flex-nowrap");
    // The extra source stays outside the step: a multi-pool path may still wrap there.
    expect(step?.textContent).toBe("sapling→ironwood");
  });

  it("puts a whole one-pool-to-one-pool path inside that step, the case reported", () => {
    const { container } = render(<TxDirection tx={base} />);
    const step = container.querySelector("[aria-label='moved to']")?.parentElement?.parentElement;

    expect(container.textContent).toBe("transparent→transparent");
    expect(step?.textContent).toBe(container.textContent);
  });

  it("names both ends of a crossing, in the direction value moved", () => {
    const shielding: Transaction = {
      ...base,
      transparentInputs: [{ address: "t1Somebody", valueZat: 100_000_000 }],
      orchard: { actions: 2, valueBalanceZat: 60_000_000 },
      ironwood: { actions: 2, valueBalanceZat: 39_990_000 },
    };
    expect(render(<TxDirection tx={shielding} />).container.textContent).toBe(
      "transparent→ironwood+orchard",
    );

    // The mirror, asserted separately: an implementation that hardcoded one side would pass
    // the case above and be backwards here.
    const unshielding: Transaction = {
      ...base,
      transparentOutputs: [{ address: "t1Somebody", valueZat: 99_990_000 }],
      orchard: { actions: 2, valueBalanceZat: -99_990_000 },
    };
    expect(render(<TxDirection tx={unshielding} />).container.textContent).toBe(
      "orchard→transparent",
    );
  });

  it("says a transfer stayed inside its own pool, rather than leaving the cell to imply it", () => {
    const inside: Transaction = { ...base, ironwood: { actions: 2, valueBalanceZat: -10_000 } };
    expect(render(<TxDirection tx={inside} />).container.textContent).toBe("ironwood→ironwood");
  });

  it("sources a coinbase from MINED, never from a pool or a fabricated transparent origin", () => {
    const coinbase: Transaction = {
      ...base,
      isCoinbase: true,
      feeZat: null,
      transparentOutputs: [{ address: "t1Miner", valueZat: 250_000_000 }],
    };
    expect(render(<TxDirection tx={coinbase} />).container.textContent).toBe("mined→transparent");

    // ZIP 213: consensus lets a coinbase pay into a pool, and then where it landed is the
    // interesting half. `coinbase` is deliberately NOT the source chip — the TYPE column
    // beside this one already says COINBASE, and repeating it would spend the cell on nothing.
    const shieldedCoinbase: Transaction = {
      ...coinbase,
      orchard: { actions: 2, valueBalanceZat: 250_000_000 },
    };
    expect(render(<TxDirection tx={shieldedCoinbase} />).container.textContent).toBe(
      "mined→transparent+orchard",
    );
  });

  it("falls back to a flat list, with no arrow, where the direction is not a fact", () => {
    // Two pools gaining: naming one destination would be the apportioning this site refuses.
    // The TYPE column reads MIXED beside this, which is the explanation for the missing arrow.
    const ambiguous: Transaction = {
      ...base,
      orchard: { actions: 4, valueBalanceZat: -200_000_000 },
      sapling: { spends: 1, outputs: 1, valueBalanceZat: 100_000_000 },
      ironwood: { actions: 2, valueBalanceZat: 99_990_000 },
    };
    const { container } = render(<TxDirection tx={ambiguous} />);

    expect(screen.queryByRole("img", { name: "moved to" })).toBeNull();
    // "and", not a bare pair: two chips in a column headed DIRECTION read as ordered, which
    // is the claim this branch withholds. Real spaces, so the copied text says it too: an
    // ordinary one before "and" (where a line may break) and a non-breaking one after it.
    expect(container.textContent).toBe("ironwood and\u00A0orchard and\u00A0sapling");
  });

  it("writes the pools as plain text in their ink — no bordered chip in the cell", () => {
    // Pool names are plain text in this column; the TYPE pill stays boxed.
    const { container } = render(<TxDirection tx={migration} />);
    expect(container.querySelector(".border, [class*='rounded']")).toBeNull();
    expect(screen.getByText("ironwood").className).toContain("text-green");
    expect(screen.getByText("sapling").className).toContain("text-green-dim");
  });

  it("hides on a phone in the header and the cell together", () => {
    // A header hidden without its cells shifts every row by one column.
    expect(DIRECTION_COLUMN.className).toBe(DIRECTION_CELL_CLASS);
    const { container } = render(
      <table>
        <tbody>
          <tr>
            <TxDirectionCell tx={migration} />
          </tr>
        </tbody>
      </table>,
    );
    expect(container.querySelector("td")?.className).toBe(DIRECTION_CELL_CLASS);
    expect(container.querySelector("td")?.textContent).toBe("orchard+sapling→ironwood");
  });
});
