import type { ReactNode } from "react";
import type { RealStepId } from "./learn-checks";

/**
 * What each real step tells the reader to do. Short on purpose: page copy stays brief.
 *
 * Exchange behaviour reflects the vendors' own pages: most exchanges only send to transparent
 * addresses and answer a shielded one with "invalid address" (as Zodl's support article puts
 * it); Gemini accepts unified addresses (its announcement of 2025-08-06). Exchange support
 * changes, so the Gemini line carries its date on the page.
 */

export interface RealStepContent {
  id: RealStepId;
  /** The rail's short name. */
  label: string;
  title: string;
  todo: readonly ReactNode[];
  /** The checker's label and the hint inside its box; absent on the last step. */
  ask?: string;
  placeholder?: string;
  note?: string;
  next?: string;
  /** The general question the step's "ask zeno" button offers. */
  question: string;
}

const TX_NOTE =
  "Checking asks this site’s server about the transaction. It’s optional, and nothing is stored.";

export const REAL_STEP_CONTENT: readonly RealStepContent[] = [
  {
    id: "wallet",
    label: "wallet",
    title: "Get a wallet",
    todo: [
      <>
        Install a wallet that supports shielded ZEC.{" "}
        <a
          href="https://www.zcashcommunity.com/wallets/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-green underline-offset-2 hover:underline"
        >
          This list ↗
        </a>{" "}
        says which ones do.
      </>,
      "Write your recovery phrase on paper. Never type it into a website, this one included.",
      "Your wallet shows two addresses: shielded (u1…) for everyday use, and transparent (t1…) for exchanges that need it. Copy the shielded one.",
    ],
    ask: "paste your shielded address",
    placeholder: "u1…",
    note: "Checked in your browser. Your address never leaves this page.",
    next: "next: get some ZEC",
    question: "What’s the difference between a shielded and a transparent address?",
  },
  {
    id: "receive",
    label: "get ZEC",
    title: "Get some ZEC",
    todo: [
      "Buy a small amount of ZEC on an exchange, or ask a friend to send you some.",
      "Withdraw to your shielded address. If the exchange says “invalid address”, use your transparent address (t1…) instead: most exchanges need it. Gemini accepts shielded addresses (as of October 2026).",
      "Copy the transaction ID from the exchange’s withdrawal history, or from your wallet.",
    ],
    ask: "paste the transaction id",
    placeholder: "64 characters, from your wallet or the exchange",
    note: `We’ll tell you whether you need step 3. ${TX_NOTE}`,
    question: "Why will most exchanges only send my ZEC to a transparent address?",
  },
  {
    id: "shield",
    label: "shield",
    title: "Shield it",
    todo: [
      "Only needed if your ZEC arrived at a t1… address.",
      "In your wallet, shield your transparent balance. Every wallet does it its own way: Zodl shows a “Shield” button when ZEC lands on your t1… address; in Vizor and others, look for “shield”.",
      "Once your wallet shows it confirmed, copy the transaction ID.",
    ],
    ask: "paste the transaction id",
    placeholder: "64 characters, from your wallet",
    note: TX_NOTE,
    next: "next: send privately",
    question: "What does shielding do, and what stays public?",
  },
  {
    id: "send",
    label: "send privately",
    title: "Send privately",
    todo: [
      "Send some ZEC to a friend’s shielded address, or to another wallet of your own.",
      "Add a memo if you like. Only the recipient can read it.",
      "Copy the transaction ID.",
    ],
    ask: "paste the transaction id",
    placeholder: "64 characters, from your wallet",
    note: TX_NOTE,
    next: "next: unshield",
    question: "What can anyone see about a fully shielded transaction?",
  },
  {
    id: "unshield",
    label: "unshield",
    title: "Unshield, only when you need to",
    todo: [
      "Optional. You need public ZEC only to sell on an exchange or to pay a t1… address.",
      "Send to that t1… address. That’s unshielding.",
      "Copy the transaction ID.",
    ],
    ask: "paste the transaction id",
    placeholder: "64 characters, from your wallet",
    note: TX_NOTE,
    next: "finish",
    question: "When should I unshield, and what becomes public?",
  },
  {
    id: "done",
    label: "done",
    title: "You did it",
    todo: [],
    question: "What is a viewing key, and why should I never share it?",
  },
];
