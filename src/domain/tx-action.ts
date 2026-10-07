import type { CrossChainProtocol } from "./crosschain";
import { protocolLabel } from "./crosschain";
import { netShieldedZat, reportsValueBalance, txDirection, txKind } from "./classify";
import type { PoolName } from "./pool";
import { poolMigration, txPools } from "./pool";
import type { Transaction } from "./transaction";
import type { FlowEnd, TxTypeName } from "./tx-flow-path";
import { txFlowPath } from "./tx-flow-path";
import { publicValueZat } from "./value";
import { capitalise, formatZecAmount } from "@/lib/format";

/**
 * One piece of a transaction-action sentence.
 *
 * The sentence is data rather than prose so the words and the marks inside it cannot disagree:
 * each part is built once by a builder (`txAction`, `transferAction`) from the domain functions
 * that decide what is claimable; `ActionSentence` decides only how each part is drawn.
 */
export type ActionPart =
  | { kind: "text"; text: string }
  /** The verb that opens the sentence. `shielded` takes the privacy green, as the shields do. */
  | { kind: "verb"; text: string; tone: "shielded" | "plain" }
  /** A ZEC amount with the coin's mark. `null` is encrypted on-chain and draws the Veil. */
  | { kind: "zec"; zat: number | null }
  /**
   * A pool or the transparent side, drawn as the DIRECTION column's own chip. `before` and
   * `after` are words that must never wrap away from it ("2 [transparent] outputs"). A
   * non-breaking space does not glue text to an inline-block, so they render inside one
   * `nowrap` span with the chip.
   */
  | { kind: "end"; end: TxTypeName; before?: string; after?: string }
  /** An amount of an asset on another chain, as the venue published it. */
  | { kind: "asset"; amount: string; ticker: string; chain: string }
  /** A chain, as a chip with its brand mark. Dashed when it is not Zcash: not indexed here. */
  | { kind: "chain"; chain: string; label: string }
  /** The public swap venue that carried a crossing. */
  | { kind: "venue"; protocol: CrossChainProtocol; before?: string };

/**
 * What a transaction did, as one sentence of parts — built only from what the chain states. The
 * pools are drawn as the DIRECTION column's own chips, so the page and the tables read alike; the
 * caveat is a separate `limit` line.
 *
 * No guessing at recipients. A transparent transaction's outputs usually split into payment and
 * change, and picking which is which is the heuristic chain-analysis uses to deanonymise people. So
 * the transparent sentence counts inputs and outputs and totals the public value, never names one
 * output as "the" payment, and `limit` says the split is not knowable.
 *
 * Every amount is a published figure: an output total, a pool's own value balance, or a migration's
 * destination balance. Directional words (`from`, `into`, `to`) appear only where `txFlowPath`
 * would draw an arrow; where pools moved opposite ways the sentence says so instead of choosing a
 * direction.
 */
export interface TxAction {
  parts: ActionPart[];
  /** The public amount the sentence states, for the page to price; null when it states none. */
  amountZat: number | null;
  /** What the chain does not record about this action. */
  limit: string;
  limitLabel: "NOT ON CHAIN" | "ON CHAIN";
}

const text = (t: string): ActionPart => ({ kind: "text", text: t });
const verb = (t: string, tone: "shielded" | "plain" = "plain"): ActionPart => ({
  kind: "verb",
  text: t,
  tone,
});
const zec = (zat: number | null): ActionPart => ({ kind: "zec", zat });
const end = (e: FlowEnd): ActionPart => ({ kind: "end", end: e });

/** "[a]", "[a] and [b]", "[a], [b] and [c]" — chips joined the way prose joins words. */
function ends(list: readonly FlowEnd[]): ActionPart[] {
  return list.flatMap((e, i) => {
    const sep = i === 0 ? [] : [text(i === list.length - 1 ? " and " : ", ")];
    return [...sep, end(e)];
  });
}

/** "Orchard", "Sapling and Orchard" — pool names for the plain-text `limit` line. */
function poolWords(pools: readonly PoolName[]): string {
  const names = pools.map(capitalise);
  return names.length <= 1
    ? (names[0] ?? "the pool")
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** `N [transparent] output(s)` / `input(s)`, the transparent side counted, never addressed. */
function transparentSide(n: number, noun: "input" | "output"): ActionPart[] {
  return [
    { kind: "end", end: "transparent", before: `${n} `, after: ` ${noun}${n === 1 ? "" : "s"}` },
  ];
}

export function txAction(tx: Transaction): TxAction {
  const kind = txKind(tx);
  const pools = txPools(tx);
  const ins = tx.transparentInputs.length;
  const outs = tx.transparentOutputs.length;

  if (kind === "coinbase") {
    // Issued value: the transparent outputs plus whatever a ZIP-213 coinbase paid into a pool,
    // which that pool's own balance publishes. Both public, so the total is a fact.
    const outputs = tx.transparentOutputs.reduce((s, o) => s + o.valueZat, 0);
    const total = outputs + (reportsValueBalance(tx) ? Math.max(0, netShieldedZat(tx)) : 0);
    const to = txFlowPath(tx)?.to ?? [];
    const paidTo = to.flatMap((e, i) => [
      ...(i === 0 ? [] : [text(" and ")]),
      ...(e === "transparent" ? transparentSide(outs, "output") : [end(e)]),
    ]);
    return {
      parts: [
        verb("Paid out"),
        text(" "),
        zec(total),
        text(" — new coins plus the block’s fees — from "),
        end("mined"),
        text(" to "),
        ...paidTo,
      ],
      amountZat: total,
      limitLabel: pools.length === 0 ? "ON CHAIN" : "NOT ON CHAIN",
      limit:
        pools.length === 0
          ? "Nothing withheld: a coinbase spends no input, and every output it pays is public."
          : `Who holds the share paid into ${poolWords(pools)} — the recipient is encrypted.`,
    };
  }

  if (kind === "shielded") {
    const migration = poolMigration(tx);
    if (migration !== null) {
      return {
        parts: [
          verb("Migrated", "shielded"),
          text(" "),
          zec(migration.amountZat),
          text(" from "),
          ...ends(migration.fromPools),
          text(" into "),
          end(migration.toPool),
        ],
        amountZat: migration.amountZat,
        limitLabel: "NOT ON CHAIN",
        limit:
          "Who moved it. The amount is the pools’ own published balances, so naming it reveals no one.",
      };
    }
    return {
      parts: [
        verb("Moved", "shielded"),
        text(" "),
        zec(null),
        text(pools.length === 1 ? " privately inside " : " privately across "),
        ...ends(pools),
      ],
      amountZat: null,
      limitLabel: "NOT ON CHAIN",
      limit:
        "The amount, the parties and the memo — readable only by the parties and holders of a viewing key.",
    };
  }

  if (kind === "transparent") {
    const value = publicValueZat(tx);
    if (value === null || outs === 0) {
      return {
        parts: [
          verb("Spent"),
          text(" "),
          ...transparentSide(ins, "input"),
          text(" with no standard-addressed output"),
        ],
        amountZat: null,
        limitLabel: "NOT ON CHAIN",
        limit: "Where the value went — no output names an address this explorer can decode.",
      };
    }
    return {
      parts: [
        verb("Moved"),
        text(" "),
        zec(value),
        text(" from "),
        ...transparentSide(ins, "input"),
        text(" to "),
        ...transparentSide(outs, "output"),
      ],
      amountZat: value,
      limitLabel: "NOT ON CHAIN",
      limit: "Which output is the payment and which is change.",
    };
  }

  // Mixed: transparent on at least one side, a shielded pool on the other.
  const direction = txDirection(tx);
  const path = txFlowPath(tx);
  // Sprout publishes no per-bundle balance, so a Sprout-only crossing has no amount to state —
  // "value" rather than a fabricated 0.00.
  const crossedZat = reportsValueBalance(tx) ? Math.abs(netShieldedZat(tx)) : null;
  const amount = crossedZat === null ? [text("value")] : [zec(crossedZat)];
  const bothSides = ins > 0 && outs > 0;
  const opposite = (): ActionPart[] => [
    text(" net, while "),
    ...ends(["transparent", ...pools]),
    text(" moved in opposite directions"),
  ];

  if (direction === "shielding") {
    const where = poolWords(pools);
    return {
      parts: [
        verb("Shielded", "shielded"),
        text(" "),
        ...amount,
        ...(path === null
          ? opposite()
          : [
              text(" from "),
              end("transparent"),
              text(" into "),
              ...ends(path.to),
              ...(bothSides ? [text(", and paid "), ...transparentSide(outs, "output")] : []),
            ]),
      ],
      amountZat: crossedZat,
      limitLabel: "NOT ON CHAIN",
      limit:
        path === null
          ? "Which pool received it — the pools moved in opposite directions, so none is named."
          : bothSides
            ? `Who holds it inside ${where}, and which transparent output is a payment and which is change.`
            : `Who holds it inside ${where}, and where it goes next.`,
    };
  }

  if (direction === "unshielding") {
    return {
      parts: [
        verb("Unshielded", "shielded"),
        text(" "),
        ...amount,
        ...(path === null
          ? opposite()
          : [
              text(" from "),
              ...ends(path.from),
              text(" to "),
              ...transparentSide(outs, "output"),
              ...(bothSides ? [text(", alongside "), ...transparentSide(ins, "input")] : []),
            ]),
      ],
      amountZat: crossedZat,
      limitLabel: "NOT ON CHAIN",
      limit:
        path === null
          ? "Which pool it left — the pools moved in opposite directions, so none is named."
          : `Where it came from inside ${poolWords(pools)}.`,
    };
  }

  return {
    parts: [verb("Moved value both ways"), text(" between "), ...ends(["transparent", ...pools])],
    amountZat: null,
    limitLabel: "NOT ON CHAIN",
    limit: "One overall direction — the pools moved opposite ways, so none is claimed.",
  };
}

/** How a sentence part reads in plain text — the page draws chips; an API answer has words. */
function partText(p: ActionPart): string {
  switch (p.kind) {
    case "text":
    case "verb":
      return p.text;
    case "zec":
      // Encrypted on-chain: the page draws the Veil; in words it is said, never a number.
      return p.zat === null ? "an encrypted amount" : `${formatZecAmount(p.zat)} ZEC`;
    case "end": {
      const name =
        p.end === "transparent"
          ? "transparent"
          : p.end === "mined" || p.end === "coinbase"
            ? "the coinbase"
            : capitalise(p.end);
      return `${p.before ?? ""}${name}${p.after ?? ""}`;
    }
    case "asset":
      return `${p.amount} ${p.ticker}`;
    case "chain":
      return p.label;
    case "venue":
      return `${p.before ?? ""}${protocolLabel(p.protocol)}`;
  }
}

/**
 * The same sentence as plain text, for `/v1/transactions/{txid}`, so an assistant describes a
 * transaction in the site's own words — which never name an output as the payment. `notOnChain` is
 * the `limit` line.
 */
export function txActionText(tx: Transaction): { text: string; notOnChain: string } {
  const action = txAction(tx);
  return { text: `${action.parts.map(partText).join("")}.`, notOnChain: action.limit };
}
