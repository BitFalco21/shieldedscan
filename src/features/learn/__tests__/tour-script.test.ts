import { describe, expect, it } from "vitest";
import { formatZec } from "@/lib/format";
import { BUY_ZAT, DEFAULT_FRIEND_ZAT, buyCostCents, simReducer, validateSend } from "../sim-model";
import type { SimState } from "../sim-model";
import { TOUR, TOUR_STEPS, isActionTarget, tourStateAt } from "../tour-script";
import type { TourTarget } from "../tour-script";

const PRICE = 1300.06;

/**
 * What the arrow points at must be on screen and pressable in that beat's state — the run's whole
 * promise is that it shows the reader's own path, so a beat pointing at a control that is absent
 * or disabled would be teaching a step that does not exist.
 */
const PRESENT: Readonly<Record<TourTarget, (s: SimState) => boolean>> = {
  seed: (s) => !s.seedAcknowledged,
  buy: (s) => {
    const cost = buyCostCents(PRICE);
    return s.exchangeZat === 0 && !s.pending && (cost === null || s.cashCents >= cost);
  },
  withdraw: (s) => s.exchangeZat > 0 && !s.refused && !s.pending,
  "use-transparent": (s) => s.refused,
  shield: (s) => s.transparentZat > 0 && !s.pending,
  send: (s) =>
    s.walletView === "send" &&
    !s.pending &&
    !("error" in validateSend(s, formatZec(DEFAULT_FRIEND_ZAT).replace(" ZEC", ""))),
  "ledger-new": (s) => s.ledger[0]?.kind === "tx",
  knows: (s) => s.tourDone,
};

describe("the guided run's script", () => {
  it("points, at every beat, at something the reader could press in that beat's state", () => {
    TOUR.forEach((beat, k) => {
      if (beat.target === null) return;
      expect(PRESENT[beat.target](tourStateAt(k, PRICE)), `beat ${k} → ${beat.target}`).toBe(true);
    });
  });

  it("makes only presses that do something, and lands every transaction it broadcasts", () => {
    TOUR.forEach((beat, k) => {
      if (!beat.press) return;
      const before = tourStateAt(k - 1, PRICE);
      const after = simReducer(before, beat.press(PRICE));
      expect(after, `beat ${k}'s press changed nothing`).not.toEqual(before);
      // A press that broadcasts leaves a transaction waiting for its block, and only those do.
      expect(after.pending !== null, `beat ${k}`).toBe(beat.lands === true);
    });
  });

  it("ends where a reader's own run ends: sent privately, nothing pending", () => {
    const end = tourStateAt(TOUR.length - 1, PRICE);
    expect(end.sentPrivately).toBe(true);
    expect(end.tourDone).toBe(true);
    expect(end.pending).toBeNull();
    expect(end.ledger.map((row) => (row.kind === "tx" ? row.shape : "offchain"))).toEqual([
      "shielded",
      "shielding",
      "transparent",
      "offchain",
    ]);
    // What a watcher learned stopped growing at the shielding, as the closing line says.
    expect(end.seen).toHaveLength(2);
  });

  it("restores any beat exactly, so stepping back is never an approximation", () => {
    for (let k = 0; k < TOUR.length; k++) {
      expect(tourStateAt(k, PRICE)).toEqual(tourStateAt(k, PRICE));
    }
    // Back from the shield's result is the moment before it: transparent ZEC, nothing shielded.
    const beforeShield = tourStateAt(
      TOUR.findIndex((beat) => beat.target === "shield"),
      PRICE,
    );
    expect(beforeShield.transparentZat).toBe(BUY_ZAT);
    expect(beforeShield.shieldedZat).toBe(0);
  });

  it("says the amounts the simulator actually uses", () => {
    expect(TOUR.some((beat) => beat.say.includes(formatZec(BUY_ZAT)))).toBe(true);
    expect(TOUR.some((beat) => beat.say.includes(formatZec(DEFAULT_FRIEND_ZAT)))).toBe(true);
  });

  it("closes on what a watcher learned, and counts only the beats before the close", () => {
    const closing = TOUR[TOUR.length - 1];
    expect(closing?.target).toBe("knows");
    expect(closing?.press?.(PRICE)).toEqual({ type: "tourDone", done: true });
    expect(TOUR_STEPS).toBe(TOUR.length - 1);
  });
});

describe("the tour speaks to someone who knows nothing", () => {
  it("names, at every step that needs a press, the button to press", () => {
    for (const beat of TOUR) {
      if (isActionTarget(beat.target)) expect(beat.say, beat.target ?? "").toMatch(/press/i);
    }
  });

  it("starts at the wallet, with nothing pressed yet", () => {
    expect(TOUR[0]?.target).toBe("seed");
    expect(TOUR[0]?.press).toBeUndefined();
  });
});
