import type { ZenoExpression } from "@/features/agent/zeno-mood";
import { formatZec } from "@/lib/format";
import { BUY_ZAT, DEFAULT_FRIEND_ZAT, initialSimState, simReducer } from "./sim-model";
import type { SimAction, SimState } from "./sim-model";

/**
 * The guided tour, as data: the common run, one beat at a time, each beat a line Zeno says and the
 * control (or row) the arrow points at while he says it. It is the first thing a newcomer does on
 * the page, so every action beat names the one button to press.
 *
 * A beat's `press` is the reader's press it stands for, made on the way IN to the beat — so a
 * beat shows the result of the press before it and points at the next one. Because the presses
 * are the same reducer actions the buttons dispatch, the tour can never show something the reader
 * could not do, and the state at any beat is a pure function of the script (`tourStateAt`), which
 * is what lets `back` restore an earlier beat exactly instead of trying to undo a press.
 */

/** What a beat points at: the `learn-<target>` id of a control or a region. */
export type TourTarget =
  "seed" | "buy" | "withdraw" | "use-transparent" | "shield" | "send" | "ledger-new" | "knows";

/** Targets the reader presses themselves; the others are results to look at. */
const ACTIONS: ReadonlySet<TourTarget> = new Set([
  "seed",
  "buy",
  "withdraw",
  "use-transparent",
  "shield",
  "send",
]);

export function isActionTarget(target: TourTarget | null): boolean {
  return target !== null && ACTIONS.has(target);
}

export interface TourBeat {
  target: TourTarget | null;
  say: string;
  expression: ZenoExpression;
  press?: (priceUsd: number | null) => SimAction;
  /** The press broadcasts a transaction: the beat's line appears once its block has landed. */
  lands?: boolean;
}

const BUY = formatZec(BUY_ZAT);
const FRIEND = formatZec(DEFAULT_FRIEND_ZAT);

/**
 * Zeno's first words, on the card that opens the page: who he is, what the tour is, and how long it
 * takes. The page's first impression, so it says nothing else.
 */
export const TOUR_WELCOME =
  "Hi, I’m Zeno! I’ll show you how to make your first private Zcash payment, step by step, with test money. It takes about two minutes.";

export const TOUR: readonly TourBeat[] = [
  {
    target: "seed",
    expression: "ready",
    say: "This is your new wallet. A real one shows you a secret recovery phrase now: write it on paper, and never type it into a website. Press “got it”.",
  },
  {
    target: "buy",
    expression: "ready",
    press: () => ({ type: "ackSeed" }),
    say: `Most people get their first ZEC on an exchange. Press “buy” to get ${BUY}, in test money.`,
  },
  {
    target: "withdraw",
    expression: "ready",
    press: (priceUsd) => ({ type: "buy", priceUsd }),
    say: "Now move it to your own wallet. Press “withdraw”: your shielded address is filled in, and it’s always the one to try first.",
  },
  {
    target: "use-transparent",
    expression: "reading",
    press: () => ({ type: "withdraw" }),
    say: "Refused! Most exchanges only send to transparent addresses, and that’s normal. Press the button to use your transparent address instead. It starts with t1.",
  },
  {
    target: "withdraw",
    expression: "ready",
    press: () => ({ type: "useTransparent" }),
    say: "Press “withdraw” again. On the real network a transaction lands in a new block about every 75 seconds.",
  },
  {
    target: "ledger-new",
    expression: "reading",
    press: () => ({ type: "withdraw" }),
    lands: true,
    say: "It arrived. This transaction is public: both addresses and the exact amount, for anyone to see, forever.",
  },
  {
    target: "shield",
    expression: "ready",
    say: "Right now everyone can see your ZEC. Let’s make it private: press “shield”.",
  },
  {
    target: "ledger-new",
    expression: "reading",
    press: () => ({ type: "shield" }),
    lands: true,
    say: "Shielded! The amount going in is public, but where it goes from here is hidden.",
  },
  {
    target: "send",
    expression: "ready",
    say: `Now send ${FRIEND} to a friend, privately. Press “send”.`,
  },
  {
    target: "ledger-new",
    expression: "reading",
    press: () => ({ type: "send", amountZat: DEFAULT_FRIEND_ZAT, memo: false }),
    lands: true,
    say: "Fully private: the sender, the recipient, the amount and the memo are encrypted. Only that it happened, and its fee, are public.",
  },
  {
    // Before the reader leaves the practice: a real wallet will not look like this one. Zodl's
    // support article describes the Shield button and its prompt; Vizor lists shielding
    // transparent funds without saying how, so the line says no more about it than that.
    target: null,
    expression: "reading",
    say: "One thing before you do it for real: every wallet shields its own way. Zodl shows a “Shield” button when ZEC lands on your transparent address; Vizor and other wallets have their own screens for it. Look for “shield” in yours.",
  },
  {
    target: "knows",
    expression: "answered",
    press: () => ({ type: "tourDone", done: true }),
    say: "You did it! Everything a watcher learned about you is lit up: it stopped growing once you shielded. Now try it yourself, or watch again.",
  },
];

/** The last beat ends the tour; the beats before it are the steps the reader moves through. */
export const TOUR_STEPS = TOUR.length - 1;

/**
 * The simulation as it stands at beat `k`: every press up to and including that beat's own,
 * each transaction landed in its block. Pure, so stepping back is a restore, not an undo.
 */
export function tourStateAt(k: number, priceUsd: number | null): SimState {
  let s = initialSimState("transparent-only", false);
  for (const beat of TOUR.slice(1, k + 1)) {
    if (!beat.press) continue;
    s = simReducer(s, beat.press(priceUsd));
    if (beat.lands) s = simReducer(s, { type: "confirm" });
  }
  return s;
}
