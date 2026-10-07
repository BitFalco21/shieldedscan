import { classifyZcashAddress, decodeUnifiedAddress } from "@/domain";
import type { LearnShape, UnifiedReceiver } from "@/domain";
import { base58checkDecode } from "@/domain/encoding/base58check";
import type { LearnExampleShape } from "@/lib/learn-lookup";

/**
 * The rules of the real-mode guide on `/learn`: what each step expects, what the reader is told
 * when a pasted transaction is something else, and what a pasted address turns out to be. Pure,
 * so every message a beginner can see is pinned by a test.
 */

export type RealStepId = "wallet" | "receive" | "shield" | "send" | "unshield" | "done";
export type TxStepId = "receive" | "shield" | "send" | "unshield";

/** Whether a step asks for a transaction ID, as every step but the first and last does. */
export function isTxStep(id: RealStepId): id is TxStepId {
  return id === "receive" || id === "shield" || id === "send" || id === "unshield";
}

/** What either checker says when the pasted text looks like a wallet's recovery phrase. */
export const RECOVERY_PHRASE_WARNING = {
  title: "! that looks like a recovery phrase",
  text: "Never paste it anywhere. Anyone who has it can take your ZEC. The box has been cleared and nothing was kept.",
} as const;

/** The example each transaction step shows: the shape that step is about. */
export const STEP_EXAMPLE: Readonly<Record<TxStepId, LearnExampleShape>> = {
  // Most exchanges send to a transparent address, so that is the example a beginner meets first.
  receive: "transparent",
  shield: "shielding",
  send: "shielded",
  unshield: "unshielding",
};

export type StepVerdict = { ok: true; skipsShield: boolean } | { ok: false; message: string };

const OK: StepVerdict = { ok: true, skipsShield: false };

export function stepVerdict(step: TxStepId, shape: LearnShape): StepVerdict {
  switch (step) {
    case "receive":
      if (shape === "transparent") return OK;
      if (shape === "shielding" || shape === "shielded") return { ok: true, skipsShield: true };
      if (shape === "unshielding") {
        return {
          ok: false,
          message:
            "That moved ZEC out of a shielded pool to a t1… address. Paste the transaction that paid your address.",
        };
      }
      if (shape === "coinbase")
        return {
          ok: false,
          message: "That’s a block reward paid to a miner, not a payment to you.",
        };
      return {
        ok: false,
        message:
          "That one moved value into one shielded pool and out of another. Paste the transaction that paid your address.",
      };
    case "shield":
      if (shape === "shielding") return OK;
      if (shape === "transparent") {
        return {
          ok: false,
          message:
            "That’s a transparent transaction: nothing went into a shielded pool. Use your wallet’s Shield action, then paste that transaction’s ID.",
        };
      }
      if (shape === "shielded")
        return {
          ok: false,
          message: "That one was already fully shielded, so there was nothing to shield.",
        };
      if (shape === "unshielding")
        return {
          ok: false,
          message: "That moved ZEC out of a shielded pool. Shielding moves it in.",
        };
      return {
        ok: false,
        message:
          "This step expects a shielding: ZEC moving from a t1… address into a shielded pool.",
      };
    case "send":
      if (shape === "shielded") return OK;
      if (shape === "unshielding") {
        return {
          ok: false,
          message:
            "That’s an unshielding: it sent ZEC to a public t1… address, so the amount and the receiver are visible. To stay private, send to a u1… or zs1… address.",
        };
      }
      if (shape === "shielding") {
        return {
          ok: false,
          message:
            "That moved ZEC into a shielded pool. Now send from your shielded balance to a shielded address.",
        };
      }
      if (shape === "transparent") {
        return {
          ok: false,
          message:
            "That’s a transparent transaction: everything about it is public. Send from your shielded balance to a u1… or zs1… address.",
        };
      }
      return {
        ok: false,
        message:
          "This step expects a fully shielded transaction, from your shielded balance to a shielded address.",
      };
    case "unshield":
      if (shape === "unshielding") return OK;
      if (shape === "shielded") {
        return {
          ok: false,
          message:
            "That one stayed shielded. Unshielding means sending to an address that starts with t1.",
        };
      }
      return {
        ok: false,
        message:
          "This step expects an unshielding: ZEC moving from your shielded balance to a t1… address.",
      };
  }
}

/** Twelve or more short words: almost certainly a recovery phrase, and it must not go anywhere. */
export function looksLikeRecoveryPhrase(text: string): boolean {
  const words = text.trim().split(/\s+/);
  return words.length >= 12 && words.every((w) => /^[a-z]{3,8}$/i.test(w));
}

export type AddressCheck =
  | { kind: "empty" }
  | { kind: "phrase" }
  | { kind: "invalid" }
  | { kind: "typo"; addressKind: "transparent" | "unified" }
  | { kind: "testnet" }
  | { kind: "transparent"; address: string }
  | { kind: "sapling"; address: string }
  | { kind: "unified"; address: string; receivers: readonly UnifiedReceiver[] };

const MAINNET_T_PREFIXES = new Set(["1cb8", "1cbd"]);

/**
 * What a pasted address is, checked entirely in the browser. A checksum failure is a typo, said
 * as one, because the next thing a beginner does with this address is ask an exchange to send
 * real money to it.
 */
export function checkAddress(raw: string): AddressCheck {
  const text = raw.trim();
  if (!text) return { kind: "empty" };
  if (looksLikeRecoveryPhrase(text)) return { kind: "phrase" };
  const kind = classifyZcashAddress(text);
  if (kind === "transparent") {
    if (!/^t[13]/.test(text)) return { kind: "testnet" };
    const payload = base58checkDecode(text);
    if (!payload || payload.length !== 22) return { kind: "typo", addressKind: "transparent" };
    const prefix = Array.from(payload.subarray(0, 2), (b) => b.toString(16).padStart(2, "0")).join(
      "",
    );
    return MAINNET_T_PREFIXES.has(prefix)
      ? { kind: "transparent", address: text }
      : { kind: "typo", addressKind: "transparent" };
  }
  if (kind === "sapling")
    return text.startsWith("zs1") ? { kind: "sapling", address: text } : { kind: "testnet" };
  if (kind === "unified") {
    if (!text.startsWith("u1")) return { kind: "testnet" };
    const decoded = decodeUnifiedAddress(text);
    return decoded
      ? { kind: "unified", address: text, receivers: decoded.receivers }
      : { kind: "typo", addressKind: "unified" };
  }
  return { kind: "invalid" };
}

/**
 * The transparent addresses that are the reader's own, from what they pasted at step 1 — so a
 * later result can mark "you". Arithmetic on their own input, never an inference about anyone.
 */
export function ownTransparentAddresses(check: AddressCheck | null): ReadonlySet<string> {
  if (!check) return new Set();
  if (check.kind === "transparent") return new Set([check.address]);
  if (check.kind === "unified") {
    return new Set(
      check.receivers.flatMap((r) => (r.kind === "p2pkh" || r.kind === "p2sh" ? [r.address] : [])),
    );
  }
  return new Set();
}
