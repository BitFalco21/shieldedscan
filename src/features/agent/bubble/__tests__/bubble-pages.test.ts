import { describe, expect, it } from "vitest";
import { bubbleSuggestions, describeBubblePage, type BubblePageKind } from "../bubble-pages";

const TXID = "a3f29c4e".padEnd(64, "0");
const UNIFIED = `u1${"qpw9zx7k3mn4vr8sd2hf6tgy5jc0lb".repeat(6)}`;

describe("describeBubblePage", () => {
  it.each<[string, BubblePageKind, string]>([
    ["/", "home", "the home page"],
    [`/tx/${TXID}`, "transaction", "tx a3f2…0000"],
    ["/block/2481032", "block", "block 2,481,032"],
    [`/block/${TXID}`, "block", "block a3f2…0000"],
    ["/address/t1XWk29dAliceFixtureAddr000001", "address", "address t1XW…0001"],
    ["/shielded", "pools", "shielded pools"],
    ["/shielded/pools", "pools", "shielded pools"],
    ["/stats/shielded", "pools", "shielded pools"],
    ["/charts", "charts", "charts"],
    ["/charts/shielded-supply", "charts", "charts"],
    ["/mempool", "other", "/mempool"],
  ])("%s is a %s page labelled %j", (path, kind, label) => {
    const page = describeBubblePage(path);
    expect(page.kind).toBe(kind);
    expect(page.label).toBe(label);
  });

  it("keeps the subject exactly as the URL carries it", () => {
    expect(describeBubblePage(`/tx/${TXID}`).subject?.id).toBe(TXID);
    expect(describeBubblePage(`/address/${UNIFIED}`).subject?.id).toBe(UNIFIED);
  });

  it.each([
    "/tx/not-a-hash",
    `/tx/${TXID}00`,
    "/block/-1",
    "/address/short",
    "/address/t1%3Cscript%3E000000000000000",
    "/tx/%E0%A4%A",
  ])("gives %s no subject", (path) => {
    expect(describeBubblePage(path).subject).toBeUndefined();
  });
});

describe("bubbleSuggestions", () => {
  const kinds: [BubblePageKind, string][] = [
    ["transaction", `/tx/${TXID}`],
    ["block", "/block/2481032"],
    ["address", `/address/${UNIFIED}`],
    ["pools", "/shielded"],
    ["charts", "/charts"],
    ["home", "/"],
    ["other", "/mempool"],
  ];

  it.each(kinds)("offers three short, distinct questions on a %s page", (_kind, path) => {
    const suggestions = bubbleSuggestions(describeBubblePage(path));
    expect(suggestions).toHaveLength(3);
    expect(new Set(suggestions.map((s) => s.question)).size).toBe(3);
    for (const s of suggestions) expect(s.label.length).toBeLessThanOrEqual(64);
  });

  it("each page type gets its own questions", () => {
    const sets = kinds.map(([, path]) =>
      bubbleSuggestions(describeBubblePage(path))
        .map((s) => s.label)
        .join("|"),
    );
    expect(new Set(sets).size).toBe(kinds.length);
  });

  it("a question naming the page's subject carries it whole, and goes to the box", () => {
    const [first] = bubbleSuggestions(describeBubblePage(`/tx/${TXID}`));
    expect(first?.question).toContain(TXID);
    expect(first?.label).toContain("a3f2…0000");
    expect(first?.label).not.toContain(TXID);
    expect(first?.send).toBe(false);
  });

  it("a question naming nothing of the reader's is sent at once", () => {
    for (const path of ["/", "/shielded", "/charts", "/mempool"]) {
      for (const s of bubbleSuggestions(describeBubblePage(path))) {
        expect(s.send).toBe(true);
        expect(s.label).toBe(s.question);
      }
    }
    const general = bubbleSuggestions(describeBubblePage(`/address/${UNIFIED}`)).find(
      (s) => !s.question.includes(UNIFIED),
    );
    expect(general?.send).toBe(true);
  });
});
