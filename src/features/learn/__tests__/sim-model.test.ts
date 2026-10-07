import { describe, expect, it } from "vitest";
import {
  BUY_ZAT,
  DEFAULT_FRIEND_ZAT,
  SIM_ADDRESSES,
  SIM_FEES,
  explainQuestion,
  initialSimState,
  maxSendZat,
  simHint,
  simReducer,
  validateSend,
} from "../sim-model";
import type { SimAction, SimState } from "../sim-model";

const PRICE = 1300.06;

/** Dispatch a sequence, landing each pending transaction in its block as it goes. */
function run(state: SimState, ...actions: SimAction[]): SimState {
  let s = state;
  for (const action of actions) {
    s = simReducer(s, action);
    if (s.pending) s = simReducer(s, { type: "confirm" });
  }
  return s;
}

const fresh = (exchange: "transparent-only" | "accepts-shielded" = "transparent-only") =>
  initialSimState(exchange, true);

describe("practice simulator: the common exchange (transparent only)", () => {
  it("refuses a shielded address the way most exchanges do, then takes the transparent one", () => {
    let s = run(fresh(), { type: "buy", priceUsd: PRICE });
    s = simReducer(s, { type: "withdraw" });
    expect(s.refused).toBe(true);
    expect(s.pending).toBeNull();
    expect(simHint(s)).toContain("refused");

    s = run(s, { type: "useTransparent" }, { type: "withdraw" });
    expect(s.transparentZat).toBe(BUY_ZAT);
    expect(s.exchangeZat).toBe(0);
    expect(simHint(s)).toContain("press shield");
  });

  it("adds up to the zatoshi across shield, private send and unshield", () => {
    const s = run(
      fresh(),
      { type: "buy", priceUsd: PRICE },
      { type: "useTransparent" },
      { type: "withdraw" },
      { type: "shield" },
      { type: "send", amountZat: DEFAULT_FRIEND_ZAT, memo: true },
    );
    const afterShield = BUY_ZAT - SIM_FEES.shielding;
    expect(s.shieldedZat).toBe(afterShield - DEFAULT_FRIEND_ZAT - SIM_FEES.shielded);

    const out = run(
      s,
      { type: "sendTo", to: "deposit" },
      { type: "send", amountZat: maxSendZat({ ...s, sendTo: "deposit" }), memo: false },
    );
    expect(out.shieldedZat).toBe(0);
    expect(out.exchangeZat).toBe(s.shieldedZat - SIM_FEES.unshielding);
    expect(simHint(out)).toContain("Most exchanges work like this one");
  });

  it("prices the purchase at the price it was given, and says nothing in dollars without one", () => {
    const priced = run(fresh(), { type: "buy", priceUsd: PRICE });
    expect(priced.cashCents).toBe(50_000 - 13_001);
    expect(priced.exchangeKnows.at(-1)?.text).toContain("$130.01");

    const unpriced = run(fresh(), { type: "buy", priceUsd: null });
    expect(unpriced.exchangeZat).toBe(BUY_ZAT);
    expect(unpriced.exchangeKnows.at(-1)?.text).not.toContain("$");
  });

  it("warns about a round trip only when the same amount goes straight back out", () => {
    const shielded = run(
      fresh(),
      { type: "buy", priceUsd: PRICE },
      { type: "useTransparent" },
      { type: "withdraw" },
      { type: "shield" },
      { type: "sendTo", to: "deposit" },
    );
    const roundTrip = run(shielded, { type: "send", amountZat: maxSendZat(shielded), memo: false });
    expect(roundTrip.seen.filter((n) => n.warn)).toHaveLength(1);

    const spentFirst = run(
      { ...shielded, sendTo: "friend" },
      { type: "send", amountZat: DEFAULT_FRIEND_ZAT, memo: false },
      { type: "sendTo", to: "deposit" },
    );
    const after = run(spentFirst, { type: "send", amountZat: maxSendZat(spentFirst), memo: false });
    expect(after.seen.filter((n) => n.warn)).toHaveLength(0);
  });

  it("adds nothing to what a watcher sees when the send is fully shielded", () => {
    const s = run(
      fresh(),
      { type: "buy", priceUsd: PRICE },
      { type: "useTransparent" },
      { type: "withdraw" },
      { type: "shield" },
    );
    const before = s.seen.length;
    const sent = run(s, { type: "send", amountZat: DEFAULT_FRIEND_ZAT, memo: false });
    expect(sent.seen).toHaveLength(before);
    expect(sent.ledger[0]).toMatchObject({ kind: "tx", shape: "shielded" });
  });
});

describe("practice simulator: an exchange that accepts shielded addresses", () => {
  it("arrives shielded, so there is nothing to shield", () => {
    const s = run(
      fresh("accepts-shielded"),
      { type: "buy", priceUsd: PRICE },
      { type: "withdraw" },
    );
    expect(s.refused).toBe(false);
    expect(s.shieldedZat).toBe(BUY_ZAT);
    expect(s.transparentZat).toBe(0);
    expect(simHint(s)).toContain("nothing to shield");
    expect(s.ledger[0]).toMatchObject({ kind: "tx", shape: "shielding" });
  });
});

describe("send validation says exactly what is wrong", () => {
  const ready = run(
    fresh(),
    { type: "buy", priceUsd: PRICE },
    { type: "useTransparent" },
    { type: "withdraw" },
  );

  it("asks to shield first when only transparent ZEC is held", () => {
    expect(validateSend(ready, "0.03")).toEqual({
      error: "This wallet spends shielded ZEC only. Shield your transparent ZEC first.",
    });
  });

  it("rejects an amount that is not a number, and one that is too large", () => {
    const shielded = run(ready, { type: "shield" });
    expect(validateSend(shielded, "abc")).toEqual({ error: "Enter an amount, like 0.03." });
    expect(validateSend(shielded, "5")).toMatchObject({
      error: expect.stringContaining("Not enough"),
    });
    expect(validateSend(shielded, "0,03")).toEqual({ amountZat: 3_000_000 });
  });

  it("ignores a send that would overspend even if a caller skipped validation", () => {
    const shielded = run(ready, { type: "shield" });
    expect(
      simReducer(shielded, { type: "send", amountZat: 999 * BUY_ZAT, memo: false }).pending,
    ).toBeNull();
  });
});

describe("practice simulator: restoring a state", () => {
  it("adopts the given state whole, which is how the guided run steps back", () => {
    const later = run(fresh(), { type: "buy", priceUsd: PRICE }, { type: "useTransparent" });
    const earlier = fresh();
    expect(simReducer(later, { type: "restore", state: earlier })).toBe(earlier);
  });
});

describe("what Zeno is asked about a practice transaction", () => {
  it("describes every transaction the ledger can hold, and nothing off-chain", () => {
    // Both runs: the common exchange, then one that accepts shielded addresses, then unshielding.
    let s = run(fresh(), { type: "buy", priceUsd: PRICE });
    s = run(s, { type: "withdraw" }, { type: "useTransparent" }, { type: "withdraw" });
    s = run(s, { type: "shield" }, { type: "send", amountZat: DEFAULT_FRIEND_ZAT, memo: false });
    s = run(
      s,
      { type: "sendTo", to: "deposit" },
      { type: "send", amountZat: 1_000_000, memo: false },
    );
    const other = run(
      fresh("accepts-shielded"),
      { type: "buy", priceUsd: PRICE },
      { type: "withdraw" },
    );
    const rows = [...s.ledger, ...other.ledger];

    const questions = rows.map(explainQuestion);
    expect(questions.filter((q) => q === null)).toHaveLength(2); // the two purchases
    const asked = questions.filter((q): q is string => q !== null);
    expect(asked).toHaveLength(5);
    for (const question of asked) {
      expect(question).toMatch(/^In the practice /);
      expect(question).toMatch(/what can anyone see in that transaction\?$/);
      // Test addresses exist nowhere on the chain: naming one only sends the model hunting.
      for (const address of Object.values(SIM_ADDRESSES)) expect(question).not.toContain(address);
    }
    expect(asked.some((q) => q.includes("I shielded 0.10 ZEC"))).toBe(true);
    expect(asked.some((q) => q.includes("straight to my shielded address"))).toBe(true);
  });
});
