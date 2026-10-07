import { describe, expect, it } from "vitest";
import type { Transaction } from "@/domain";
import { transactions, transactionsById } from "@/fixtures/transactions";
import { mempoolTransactions } from "@/fixtures/mempool";
import { hex64 } from "@/fixtures/ids";
import { txCardFacts } from "../tx-card-facts";

const DAY_CLOSES = { "2026-08-30": 700 };
const NOW = Math.floor(Date.UTC(2026, 7, 31) / 1000);

function facts(tx: Transaction) {
  return txCardFacts(tx, { dailyUsd: DAY_CLOSES, currentUsd: 650, nowSeconds: NOW });
}

// One fixture per branch the card can take, named by what it exercises rather than by id.
const fullyShielded = transactionsById.get(hex64("a3f29c4e"))!;
const sproutUnshielding = transactionsById.get(hex64("750b0dc0"))!;
const transparent = transactionsById.get(hex64("77d10b12"))!;
const migration = transactionsById.get(hex64("ea0a65f6"))!;
const mixed = transactionsById.get(hex64("c0ffee01"))!;
const coinbase = transactions.find((t) => t.isCoinbase)!;

describe("txCardFacts", () => {
  it("names the verdict with the same words the transaction page uses", () => {
    // Never a word of its own: the card and the page must not disagree about what a
    // transaction IS, which is why this reads txKindLabel rather than restating it.
    expect(facts(fullyShielded).verdict).toBe("SHIELDED");
    expect(facts(sproutUnshielding).verdict).toBe("UNSHIELDING");
    expect(facts(coinbase).verdict).toBe("COINBASE");
  });

  it("shows the Veil for a shielded value — never a zero and never a dash", () => {
    const value = facts(fullyShielded).value;
    expect(value?.kind).toBe("shielded");
    // The card draws bars rather than printing a figure, so there must be no amount at all
    // on this branch: a `0` here is the fabrication the whole design exists to refuse.
    expect(JSON.stringify(value)).not.toMatch(/\d/);
  });

  it("prices a public amount at its OWN day's close, never today's", () => {
    // The card is permanent — a scraper caches it and a screenshot outlives the moment —
    // so today's rate against a past amount would value nothing that happened.
    const tx: Transaction = {
      ...transparent,
      timestamp: Math.floor(Date.UTC(2026, 7, 30, 12) / 1000),
      transparentOutputs: [{ address: "t1abc", valueZat: 100_000_000 }],
    };
    const { value } = facts(tx);
    if (value?.kind !== "public") throw new Error("expected a public amount");
    // 1 ZEC at the stored close of $700, not at the current $650.
    expect(value.usd).toContain("700");
    expect(value.usdBasis).toBe("AT THE 30 AUG 2026 CLOSE");
  });

  it("does not call today's live price a close", () => {
    // Today's close does not exist yet, so `feeUsdAtDay` falls back to the current price, and
    // the card must not label that figure a close.
    const tx: Transaction = {
      ...transparent,
      // An hour into the same UTC day as the clock — NOW is midnight, so an hour BEFORE it
      // is yesterday, which has a stored close and would not exercise this at all.
      timestamp: NOW + 3600,
      transparentOutputs: [{ address: "t1abc", valueZat: 100_000_000 }],
    };
    const { value } = facts(tx);
    if (value?.kind !== "public") throw new Error("expected a public amount");
    expect(value.usd).toContain("650");
    expect(value.usdBasis).not.toMatch(/CLOSE/);
    // The day still travels with the figure: a card cached from today must still say which
    // day's price it quoted.
    expect(value.usdBasis).toContain("31 AUG 2026");
  });

  it("omits the dollar figure entirely when that day has no close", () => {
    const tx: Transaction = {
      ...transparent,
      timestamp: Math.floor(Date.UTC(2019, 0, 5) / 1000),
      transparentOutputs: [{ address: "t1abc", valueZat: 100_000_000 }],
    };
    const { value } = facts(tx);
    if (value?.kind !== "public") throw new Error("expected a public amount");
    expect(value.usd).toBeNull();
    expect(value.usdBasis).toBeNull();
  });

  it("distinguishes a coinbase's absent fee from an unknown one", () => {
    // A coinbase COLLECTS fees rather than paying one, so `none` is a fact and `unknown`
    // would claim we lost a figure that never existed. The page draws the same line.
    expect(facts(coinbase).fee).toEqual({ kind: "none" });
    expect(facts({ ...mixed, feeZat: null }).fee).toEqual({ kind: "unknown" });
    expect(facts({ ...mixed, feeZat: 10_000 }).fee?.kind).toBe("amount");
  });

  it("draws a flow path only where the chain settles one", () => {
    expect(facts(migration).path).toBe("ORCHARD SAPLING → IRONWOOD");
    // `mixed` has pools moving in opposite directions, so txFlowPath refuses and the card
    // must print no arrow — an arrow claims each end named moved that way.
    expect(facts(mixed).path).toBeNull();
  });

  it("states that an unconfirmed transaction is not in a block yet", () => {
    const pending = mempoolTransactions[0]!;
    expect(pending.blockHeight).toBeNull();
    expect(facts(pending).stamp).toMatch(/MEMPOOL/);
    expect(facts(pending).confirmed).toBe(false);
  });

  it("never states a confirmation count", () => {
    // Confirmations change every 75 seconds and a cached image cannot follow them, so a
    // number here would be wrong for as long as the card exists.
    const all = [fullyShielded, migration, mixed, coinbase].map((tx) =>
      JSON.stringify(facts(tx)).toLowerCase(),
    );
    for (const json of all) expect(json).not.toContain("confirmation");
  });

  it("names no address and narrates no payment", () => {
    // Deciding which output was the payment is an inference this site refuses, and a name
    // would travel on a permanent image with no basis beside it.
    for (const tx of [mixed, coinbase, migration]) {
      const json = JSON.stringify(facts(tx));
      for (const input of tx.transparentInputs) expect(json).not.toContain(input.address);
      for (const output of tx.transparentOutputs) expect(json).not.toContain(output.address);
      expect(json).not.toMatch(/sent .* to/i);
    }
  });

  it("draws the site's shield, and refuses one it could not stand behind", () => {
    // The same three-state grammar the rows use, from the same function — never a second
    // mapping. A coinbase is the deliberate hole: `privacyVariantFor` calls every coinbase
    // transparent, which would put an outline shield beside a path naming Orchard.
    expect(facts(fullyShielded).shield).toBe("shielded");
    expect(facts(mixed).shield).toBe("mixed");
    expect(facts(transparent).shield).toBe("transparent");
    expect(facts(coinbase).shield).toBeNull();
  });

  it("pluralises the action count, and says the in/out counts are transparent", () => {
    // Plurals agree with the count, and a bare "0 IN" beside a shielded transaction would read
    // as nothing moved, where what is true is that nothing moved transparently.
    const one = facts({ ...fullyShielded, orchard: { actions: 1, valueBalanceZat: 0 } }).shape;
    expect(one).toContain("1 SHIELDED ACTION");
    expect(one).not.toContain("ACTIONS");
    expect(facts(fullyShielded).shape).toMatch(/SHIELDED ACTIONS/);
    expect(facts(fullyShielded).shape).toContain("TRANSPARENT IN");
  });

  it("elides the txid but keeps both ends checkable", () => {
    const { txidShort } = facts(fullyShielded);
    expect(txidShort).toContain(fullyShielded.txid.slice(0, 8));
    expect(txidShort).toContain(fullyShielded.txid.slice(-6));
    expect(txidShort.length).toBeLessThan(fullyShielded.txid.length);
  });
});
