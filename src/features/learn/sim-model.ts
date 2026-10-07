import { ZATS_PER_ZEC } from "@/domain";
import { formatZec, formatUsdExact } from "@/lib/format";

/**
 * The practice simulator on `/learn`: a test exchange, a test wallet and a test chain, as a pure
 * reducer so every rule below is a unit test.
 *
 * It models the real world, not a convenient one: most exchanges only send to transparent
 * addresses and answer a shielded one with "invalid address"; some (Gemini) accept shielded
 * ones; a wallet shows a Shield button once a transparent balance arrives and only spends
 * shielded funds. Run one is the common case, and the reader is offered the other once it ends,
 * so nobody is asked to choose an address type blind.
 */

export type ExchangeKind = "transparent-only" | "accepts-shielded";
export type SimShape = "transparent" | "shielding" | "shielded" | "unshielding";

/**
 * These look exactly like real addresses but each has a deliberately broken checksum (a valid
 * address with one character changed), so every wallet rejects them: a reader who copies one out
 * of the simulator can never send real ZEC anywhere. `sim-addresses.test.ts` proves each one
 * fails with this site's own decoders.
 */
export const SIM_ADDRESSES = {
  yourTransparent: "t1ZY8weaf5eVuMWgmymTdLkYjkyUsY46Yfv",
  yourShielded:
    "u12cz7lplgh0ks459st074ypmzcqvsr6pn5zapx9jdvmf6cljyhnz5h77qrrpfh5rctchuafg2g3pvd7ks7z9kxhmllypj6nege9aqhwzmta2pm92u9fh0eeehgy856us04zuqj78zh8qey0mddspgsa0laj7f4jwgnxmsa8t4zw0fze0w",
  exchangeWallet: "t1VtpZ8UrF2ZfnziUJwBEk2ucP25K2rUhmE",
  exchangeDeposit: "t1XYqFZc6sVMHh42jPEokdvzGastJGrAhn6",
} as const;

/** What one purchase buys. Small on purpose: the lesson is the path, not the amount. */
export const BUY_ZAT = 10_000_000;
/** Each test transaction waits this long for its block (the real target is 75 seconds). */
export const SIM_BLOCK_MS = 1_100;
/** ZIP 317: 5,000 zatoshis per logical action, at least two. Real transactions of these shapes pay exactly this. */
export const SIM_FEES: Readonly<Record<SimShape, number>> = {
  transparent: 10_000,
  shielding: 15_000,
  shielded: 10_000,
  unshielding: 15_000,
};
const START_CASH_CENTS = 50_000;
/** What a friend is sent by default, so a beginner can just press send. */
export const DEFAULT_FRIEND_ZAT = 3_000_000;

export type SimLeg =
  | { kind: "address"; address: string; owner: "you" | "exchange"; valueZat: number }
  | { kind: "pool"; valueZat: number }
  | { kind: "hidden"; what: "sender" | "recipient" | "amount" | "memo" };

export type SimLedgerRow =
  | { kind: "offchain"; time: string; text: string }
  | {
      kind: "tx";
      time: string;
      shape: SimShape;
      feeZat: number;
      from: SimLeg[];
      to: SimLeg[];
      note?: string;
    };

/** One line of what someone knows. `lead` is an address, set in bold before the sentence. */
export interface SimNote {
  lead?: string;
  text: string;
  warn?: boolean;
}

export type SimPending =
  | { kind: "withdraw"; to: "shielded" | "transparent"; amountZat: number }
  | { kind: "shield"; amountZat: number }
  | { kind: "send"; to: "friend" | "deposit"; amountZat: number; memo: boolean };

export interface SimState {
  exchange: ExchangeKind;
  withdrawTo: "shielded" | "transparent";
  refused: boolean;
  cashCents: number;
  exchangeZat: number;
  transparentZat: number;
  shieldedZat: number;
  minute: number;
  seedAcknowledged: boolean;
  walletView: "receive" | "send";
  sendTo: "friend" | "deposit";
  /** Newest first. */
  ledger: SimLedgerRow[];
  /** What anyone watching the chain can see, oldest first. */
  seen: SimNote[];
  exchangeKnows: SimNote[];
  pending: SimPending | null;
  /** The amount that last entered the pool, for the round-trip warning. */
  inPoolZat: number | null;
  spentSinceIn: boolean;
  sentPrivately: boolean;
  arrivedShielded: boolean;
  shieldedOnce: boolean;
  deposited: boolean;
  tourDone: boolean;
}

export type SimAction =
  | { type: "reset"; exchange: ExchangeKind; seedAcknowledged: boolean }
  | { type: "ackSeed" }
  | { type: "buy"; priceUsd: number | null }
  | { type: "withdraw" }
  | { type: "useTransparent" }
  | { type: "shield" }
  | { type: "send"; amountZat: number; memo: boolean }
  | { type: "confirm" }
  | { type: "view"; view: "receive" | "send" }
  | { type: "sendTo"; to: "friend" | "deposit" }
  | { type: "tourDone"; done: boolean }
  /** The guided run stepping back: the state of an earlier beat, computed from its script. */
  | { type: "restore"; state: SimState };

export function initialSimState(exchange: ExchangeKind, seedAcknowledged: boolean): SimState {
  return {
    exchange,
    withdrawTo: "shielded",
    refused: false,
    cashCents: START_CASH_CENTS,
    exchangeZat: 0,
    transparentZat: 0,
    shieldedZat: 0,
    minute: 0,
    seedAcknowledged,
    walletView: "receive",
    sendTo: "friend",
    ledger: [],
    seen: [],
    exchangeKnows: [{ text: "your name and ID, from signing up" }],
    pending: null,
    inPoolZat: null,
    spentSinceIn: false,
    sentPrivately: false,
    arrivedShielded: false,
    shieldedOnce: false,
    deposited: false,
    tourDone: false,
  };
}

function simClock(minute: number): string {
  const total = 14 * 60 + minute;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** An address as the ledger and the lists show it: shortened, like an explorer does. */
function shortAddress(address: string): string {
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

export function buyCostCents(priceUsd: number | null): number | null {
  return priceUsd === null ? null : Math.round((BUY_ZAT / ZATS_PER_ZEC) * priceUsd * 100);
}

export function sendFeeZat(to: "friend" | "deposit"): number {
  return to === "friend" ? SIM_FEES.shielded : SIM_FEES.unshielding;
}

export function maxSendZat(s: SimState): number {
  return Math.max(0, s.shieldedZat - sendFeeZat(s.sendTo));
}

/** Parse what the reader typed, or say exactly what is wrong. */
export function validateSend(s: SimState, raw: string): { amountZat: number } | { error: string } {
  const text = raw.trim().replace(",", ".");
  const zec = Number(text);
  if (!text || !Number.isFinite(zec) || zec <= 0) return { error: "Enter an amount, like 0.03." };
  const amountZat = Math.round(zec * ZATS_PER_ZEC);
  if (s.shieldedZat === 0 && s.transparentZat > 0) {
    return { error: "This wallet spends shielded ZEC only. Shield your transparent ZEC first." };
  }
  const fee = sendFeeZat(s.sendTo);
  if (amountZat + fee > s.shieldedZat) {
    return {
      error: `Not enough shielded ZEC: you have ${formatZec(s.shieldedZat)} and the fee is ${formatZec(fee)}.`,
    };
  }
  return { amountZat };
}

const EXPLAIN_ASK = "In plain words, what can anyone see in that transaction?";

/**
 * The question Zeno is asked about one practice transaction: what the row shows, in words. Never
 * the test addresses — they exist nowhere on the chain, so naming them would only send the model
 * looking up strings it cannot find. Off-chain rows (a purchase) have no transaction to explain.
 */
export function explainQuestion(row: SimLedgerRow): string | null {
  if (row.kind !== "tx") return null;
  const fromYou = row.from.find((leg) => leg.kind === "address" && leg.owner === "you");
  const toYou = row.to.find((leg) => leg.kind === "address" && leg.owner === "you");
  const toExchange = row.to.find((leg) => leg.kind === "address" && leg.owner === "exchange");
  const intoPool = row.to.find((leg) => leg.kind === "pool");
  const value = (leg: SimLeg | undefined) =>
    leg !== undefined && leg.kind !== "hidden" ? formatZec(leg.valueZat) : "some ZEC";
  switch (row.shape) {
    case "transparent":
      return `In the practice I withdrew ${value(toYou)} from an exchange to my transparent address. ${EXPLAIN_ASK}`;
    case "shielding":
      return fromYou !== undefined
        ? `In the practice I shielded ${value(fromYou)} from my transparent address. ${EXPLAIN_ASK}`
        : `In the practice an exchange sent ${value(intoPool)} straight to my shielded address. ${EXPLAIN_ASK}`;
    case "shielded":
      return `In the practice I sent ZEC to a friend’s shielded address from my shielded balance. ${EXPLAIN_ASK}`;
    case "unshielding":
      return `In the practice I sent ${value(toExchange)} from my shielded balance back to an exchange’s deposit address. ${EXPLAIN_ASK}`;
  }
}

function pendingLabel(p: SimPending): string {
  if (p.kind === "withdraw") return "The exchange is sending your ZEC";
  if (p.kind === "shield") return "Shielding";
  return p.to === "friend" ? "Sending privately" : "Unshielding";
}

/** The one line of guidance at the top: what to do next, in plain words. */
export function simHint(s: SimState): string {
  if (s.pending) {
    return `${pendingLabel(s.pending)} · waiting for the next block (about 75 seconds on the real network)`;
  }
  const common = s.exchange === "transparent-only";
  if (s.deposited) {
    return common
      ? "That’s the whole loop. Most exchanges work like this one."
      : "That’s the whole loop, with an exchange that accepts shielded addresses.";
  }
  if (!s.ledger.length && s.exchangeZat === 0) {
    return s.seedAcknowledged
      ? "Buy some test ZEC on the exchange."
      : "Your new wallet has a note for you. Then buy some test ZEC on the exchange.";
  }
  if (s.refused) {
    return "The exchange refused your shielded address. Most exchanges do. Use your transparent address instead.";
  }
  if (s.exchangeZat > 0) {
    return s.withdrawTo === "shielded"
      ? "Withdraw it to your wallet. Your shielded address is filled in: always try that one first."
      : "Withdraw it to your transparent address.";
  }
  if (s.transparentZat > 0) {
    return "It arrived at your transparent address, where everyone can see it. In your wallet, press shield. Real wallets each show this their own way.";
  }
  if (!s.sentPrivately) {
    return s.arrivedShielded && !s.shieldedOnce
      ? "It arrived shielded, so there’s nothing to shield. Now send some to a friend, privately."
      : "Now send some to a friend, privately.";
  }
  return "Optional: send some back to the exchange. That’s unshielding.";
}

const you = (valueZat: number): SimLeg => ({
  kind: "address",
  address: SIM_ADDRESSES.yourTransparent,
  owner: "you",
  valueZat,
});
const exchangeAt = (address: string, valueZat: number): SimLeg => ({
  kind: "address",
  address,
  owner: "exchange",
  valueZat,
});
const hidden = (what: "sender" | "recipient" | "amount" | "memo"): SimLeg => ({
  kind: "hidden",
  what,
});

type Pending<K extends SimPending["kind"]> = Extract<SimPending, { kind: K }>;

/**
 * The pending transaction lands in a block: balances move, the ledger gains its row, and the
 * watcher's and the exchange's lists gain what each can now see. One function per kind of
 * transaction, each given the state with the pending cleared and the clock advanced.
 */
function confirm(s: SimState): SimState {
  const p = s.pending;
  if (!p) return s;
  const minute = s.minute + 2;
  const time = simClock(minute);
  const base: SimState = { ...s, pending: null, minute };
  switch (p.kind) {
    case "withdraw":
      return p.to === "transparent"
        ? landTransparentWithdraw(s, p, base, time)
        : landShieldedWithdraw(s, p, base, time);
    case "shield":
      return landShield(s, p, base, time);
    case "send":
      return p.to === "friend" ? landPrivateSend(s, p, base, time) : landUnshield(s, p, base, time);
  }
}

/** The exchange pays a transparent address: public, and tied to the exchange's wallet. */
function landTransparentWithdraw(
  s: SimState,
  p: Pending<"withdraw">,
  base: SimState,
  time: string,
): SimState {
  const fee = SIM_FEES.transparent;
  return {
    ...base,
    exchangeZat: s.exchangeZat - p.amountZat,
    transparentZat: s.transparentZat + p.amountZat,
    ledger: [
      {
        kind: "tx",
        time,
        shape: "transparent",
        feeZat: fee,
        from: [exchangeAt(SIM_ADDRESSES.exchangeWallet, p.amountZat + fee)],
        to: [you(p.amountZat)],
      },
      ...s.ledger,
    ],
    seen: [
      ...s.seen,
      {
        lead: shortAddress(SIM_ADDRESSES.yourTransparent),
        text: `received ${formatZec(p.amountZat)} from an exchange’s wallet. Exchange wallets are often publicly labelled, so this links your address to that exchange.`,
      },
    ],
    exchangeKnows: [
      ...s.exchangeKnows,
      {
        text: `you withdrew ${formatZec(p.amountZat)} to ${shortAddress(SIM_ADDRESSES.yourTransparent)}`,
      },
    ],
  };
}

/** The exchange pays a shielded address: the amount enters the pool, the recipient is hidden. */
function landShieldedWithdraw(
  s: SimState,
  p: Pending<"withdraw">,
  base: SimState,
  time: string,
): SimState {
  const fee = SIM_FEES.shielding;
  return {
    ...base,
    exchangeZat: s.exchangeZat - p.amountZat,
    shieldedZat: s.shieldedZat + p.amountZat,
    inPoolZat: p.amountZat,
    spentSinceIn: false,
    arrivedShielded: true,
    walletView: "send",
    ledger: [
      {
        kind: "tx",
        time,
        shape: "shielding",
        feeZat: fee,
        from: [exchangeAt(SIM_ADDRESSES.exchangeWallet, p.amountZat + fee)],
        to: [{ kind: "pool", valueZat: p.amountZat }, hidden("recipient")],
      },
      ...s.ledger,
    ],
    seen: [
      ...s.seen,
      {
        text: `An exchange’s wallet sent ${formatZec(p.amountZat)} into the shielded pool. Who received it is hidden.`,
      },
    ],
    exchangeKnows: [
      ...s.exchangeKnows,
      {
        text: `you withdrew ${formatZec(p.amountZat)} to your shielded address. The chain hides it; the exchange doesn’t.`,
      },
    ],
  };
}

/** Shielding your own transparent balance. */
function landShield(s: SimState, p: Pending<"shield">, base: SimState, time: string): SimState {
  const fee = SIM_FEES.shielding;
  const out = p.amountZat - fee;
  return {
    ...base,
    transparentZat: s.transparentZat - p.amountZat,
    shieldedZat: s.shieldedZat + out,
    inPoolZat: out,
    spentSinceIn: false,
    shieldedOnce: true,
    walletView: "send",
    ledger: [
      {
        kind: "tx",
        time,
        shape: "shielding",
        feeZat: fee,
        from: [you(p.amountZat)],
        to: [{ kind: "pool", valueZat: out }, hidden("recipient")],
      },
      ...s.ledger,
    ],
    seen: [
      ...s.seen,
      {
        lead: shortAddress(SIM_ADDRESSES.yourTransparent),
        text: `moved ${formatZec(out)} into the shielded pool. Where it goes next is hidden.`,
      },
    ],
  };
}

/** A fully shielded payment to a friend: nothing new for a watcher. */
function landPrivateSend(s: SimState, p: Pending<"send">, base: SimState, time: string): SimState {
  const fee = sendFeeZat(p.to);
  return {
    ...base,
    shieldedZat: s.shieldedZat - p.amountZat - fee,
    sentPrivately: true,
    spentSinceIn: true,
    ledger: [
      {
        kind: "tx",
        time,
        shape: "shielded",
        feeZat: fee,
        from: [hidden("sender")],
        to: [hidden("recipient"), hidden("amount"), hidden("memo")],
        note: `Nothing new for anyone watching. Your friend sees ${formatZec(p.amountZat)}${p.memo ? " and your memo." : "."}`,
      },
      ...s.ledger,
    ],
  };
}

/** Unshielding back to the exchange's deposit address. */
function landUnshield(s: SimState, p: Pending<"send">, base: SimState, time: string): SimState {
  const fee = sendFeeZat(p.to);
  // Nearly the same amount straight back out of the pool, with nothing spent in between, is the
  // "round trip" researchers use to link the two.
  const roundTrip =
    s.inPoolZat !== null &&
    !s.spentSinceIn &&
    Math.abs(s.inPoolZat - (p.amountZat + fee)) <= 2 * SIM_FEES.unshielding;
  return {
    ...base,
    shieldedZat: s.shieldedZat - p.amountZat - fee,
    exchangeZat: s.exchangeZat + p.amountZat,
    deposited: true,
    walletView: "receive",
    inPoolZat: null,
    ledger: [
      {
        kind: "tx",
        time,
        shape: "unshielding",
        feeZat: fee,
        from: [{ kind: "pool", valueZat: p.amountZat + fee }, hidden("sender")],
        to: [exchangeAt(SIM_ADDRESSES.exchangeDeposit, p.amountZat)],
      },
      ...s.ledger,
    ],
    seen: [
      ...s.seen,
      {
        text: `${formatZec(p.amountZat)} left the shielded pool to an exchange’s deposit address. The amount is public; who sent it is not.`,
      },
      ...(roundTrip
        ? [
            {
              warn: true,
              text: "Almost the same amount went into the pool and back out, minutes apart. A watcher can guess it’s the same money; researchers call this a round trip. Spending some privately first, or waiting, makes the guess harder.",
            },
          ]
        : []),
    ],
    exchangeKnows: [...s.exchangeKnows, { text: `you deposited ${formatZec(p.amountZat)} back` }],
  };
}

export function simReducer(s: SimState, a: SimAction): SimState {
  switch (a.type) {
    case "reset":
      return initialSimState(a.exchange, a.seedAcknowledged);
    case "ackSeed":
      return { ...s, seedAcknowledged: true };
    case "buy": {
      const cost = buyCostCents(a.priceUsd);
      if (s.pending || (cost !== null && s.cashCents < cost)) return s;
      const minute = s.minute + 2;
      return {
        ...s,
        minute,
        cashCents: cost === null ? s.cashCents : s.cashCents - cost,
        exchangeZat: s.exchangeZat + BUY_ZAT,
        ledger: [
          {
            kind: "offchain",
            time: simClock(minute),
            text: `bought ${formatZec(BUY_ZAT)} on the exchange · not on the blockchain`,
          },
          ...s.ledger,
        ],
        exchangeKnows: [
          ...s.exchangeKnows,
          {
            text: `you bought ${formatZec(BUY_ZAT)}${cost === null ? "" : ` for ${formatUsdExact(cost / 100)}`}`,
          },
        ],
      };
    }
    case "withdraw":
      if (s.pending || s.exchangeZat === 0 || s.refused) return s;
      if (s.withdrawTo === "shielded" && s.exchange === "transparent-only") {
        return { ...s, refused: true };
      }
      return { ...s, pending: { kind: "withdraw", to: s.withdrawTo, amountZat: s.exchangeZat } };
    case "useTransparent":
      return { ...s, withdrawTo: "transparent", refused: false };
    case "shield":
      if (s.pending || s.transparentZat === 0) return s;
      return { ...s, pending: { kind: "shield", amountZat: s.transparentZat } };
    case "send":
      if (s.pending || a.amountZat <= 0 || a.amountZat + sendFeeZat(s.sendTo) > s.shieldedZat)
        return s;
      return {
        ...s,
        pending: {
          kind: "send",
          to: s.sendTo,
          amountZat: a.amountZat,
          memo: s.sendTo === "friend" && a.memo,
        },
      };
    case "confirm":
      return confirm(s);
    case "view":
      return { ...s, walletView: a.view };
    case "sendTo":
      return { ...s, sendTo: a.to };
    case "tourDone":
      return { ...s, tourDone: a.done };
    case "restore":
      return a.state;
  }
}
