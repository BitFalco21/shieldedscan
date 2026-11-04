import { formatCount, shortHash } from "@/lib/format";

/**
 * What the bubble knows about the page it is open on, and the questions it offers there.
 *
 * Zeno is told none of this. The API accepts no page but `/learn` (`server/agent/ask-pages.ts`),
 * and the page's subject — a transaction, an address — may be the reader's own: it reaches the
 * model only inside a question the reader sends from the composer, under the key warning (the rule
 * `LearnZeno` states for its buttons). So a suggestion that names the subject fills the composer
 * rather than sending, and one that does not is sent at once, as the console's examples are.
 */

export type BubblePageKind =
  "transaction" | "block" | "address" | "pools" | "charts" | "home" | "other";

export interface BubbleSubject {
  /** How a question names it: "transaction", "block", "address". */
  noun: string;
  /** Exactly as the URL carries it, so a lookup finds it. */
  id: string;
  /** Short enough for a chip and a suggestion in a 420px panel. */
  short: string;
}

export interface BubblePage {
  kind: BubblePageKind;
  /** Where the reader is, for the chip: "tx a3f2…0000", "shielded pools". */
  label: string;
  subject?: BubbleSubject;
}

export interface BubbleSuggestion {
  /** The button's text: the question with the subject shortened. */
  label: string;
  /** The full question, as it would be sent. */
  question: string;
  /** False when the question names the page's subject: it goes to the composer instead. */
  send: boolean;
}

const HASH = /^[0-9a-f]{64}$/i;
const HEIGHT = /^\d{1,9}$/;
/** Transparent, Sapling, unified and TEX addresses are all plain alphanumerics. */
const ADDRESS = /^[a-z0-9]{20,1000}$/i;

function segment(raw: string | undefined): string | null {
  if (raw === undefined || raw === "") return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

function subject(noun: string, id: string): BubbleSubject {
  const short = HEIGHT.test(id) ? formatCount(Number(id)) : id.length > 12 ? shortHash(id) : id;
  return { noun, id, short };
}

function withSubject(kind: BubblePageKind, s: BubbleSubject): BubblePage {
  // "tx" in the chip, as the nav says it: the chip shares its row with "add to question".
  return { kind, label: `${kind === "transaction" ? "tx" : s.noun} ${s.short}`, subject: s };
}

export function describeBubblePage(pathname: string): BubblePage {
  const [first, second] = pathname.split("/").filter((part) => part !== "");
  const id = segment(second);

  if (first === undefined) return { kind: "home", label: "the home page" };
  if (first === "tx" && id !== null && HASH.test(id)) {
    return withSubject("transaction", subject("transaction", id));
  }
  if (first === "block" && id !== null && (HEIGHT.test(id) || HASH.test(id))) {
    return withSubject("block", subject("block", id));
  }
  if (first === "address" && id !== null && ADDRESS.test(id)) {
    return withSubject("address", subject("address", id));
  }
  if (first === "shielded" || (first === "stats" && second === "shielded")) {
    return { kind: "pools", label: "shielded pools" };
  }
  if (first === "charts") return { kind: "charts", label: "charts" };
  return { kind: "other", label: pathname };
}

/** Three questions per kind; `{id}` stands for the page's subject. Short, in the console's voice. */
const QUESTIONS: Record<BubblePageKind, readonly [string, string, string]> = {
  transaction: [
    "what happened in transaction {id}?",
    "which pools did transaction {id} use?",
    "what fee did transaction {id} pay?",
  ],
  block: [
    "what happened in block {id}?",
    "how many shielded txs are in block {id}?",
    "what fees were paid in block {id}?",
  ],
  address: [
    "what does the chain show for address {id}?",
    "what kind of address is {id}?",
    "what does a viewing key reveal?",
  ],
  pools: [
    "how much ZEC is shielded right now?",
    "which shielded pool is growing fastest?",
    "what is the difference between Sapling and Orchard?",
  ],
  charts: [
    "how has the shielded supply changed this year?",
    "how many transactions were shielded last week?",
    "how has the ZEC price moved this month?",
  ],
  home: [
    "what happened in the latest block?",
    "how much ZEC is shielded right now?",
    "when is the next halving?",
  ],
  other: [
    "what happened in the latest block?",
    "how much ZEC is shielded right now?",
    "what is a shielded transaction?",
  ],
};

export function bubbleSuggestions(page: BubblePage): BubbleSuggestion[] {
  return QUESTIONS[page.kind].map((template) => {
    const names = template.includes("{id}");
    // A subject kind always has a subject (`describeBubblePage`); the fallback only keeps the
    // types honest.
    const s = page.subject;
    return {
      label: s === undefined ? template : template.replace("{id}", s.short),
      question: s === undefined ? template : template.replace("{id}", s.id),
      send: !names,
    };
  });
}
