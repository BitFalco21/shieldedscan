import { describe, expect, it } from "vitest";
import { ACCURACY_CASES } from "../agent/evals/accuracy/cases";
import { gradeAnswer, isMisquote, segmentsOf, tokensOf } from "../agent/evals/accuracy/grade";
import { payloadCarries } from "../agent/evals/accuracy/payload";
import type { AccuracyCase, TruthRow } from "../agent/evals/accuracy/types";

const caseOf = (id: string): AccuracyCase => {
  const c = ACCURACY_CASES.find((x) => x.id === id);
  if (!c) throw new Error(`no case ${id}`);
  return c;
};

describe("accuracy grader", () => {
  const txMonth = caseOf("tx-month-total");
  const truth: TruthRow = {
    n: 234434,
    n_previous_month: 228102,
    coinbase: 35551,
    n_with_coinbase: 269985,
  };

  it("passes the figure stated beside its anchor, among context figures", () => {
    const answer =
      "October 2026 had **234,434** transactions across 35,551 blocks. That is up from September.";
    expect(gradeAnswer(txMonth, truth, answer).verdict).toBe("CORRECT");
  });

  it("names the mistake when the figure is a distractor", () => {
    const g = gradeAnswer(txMonth, truth, "There were 269,985 transactions in October 2026.");
    expect(g.verdict).toBe("WRONG");
    expect(g.detail).toContain("n_with_coinbase");
  });

  it("calls a one-digit slip a misquote", () => {
    const g = gradeAnswer(txMonth, truth, "There were 234,484 transactions in October 2026.");
    expect(g.verdict).toBe("WRONG");
    expect(g.detail).toContain("misquote");
    expect(isMisquote("2344340", 234434)).toBe(true);
    expect(isMisquote("234434", 234434)).toBe(false);
    expect(isMisquote("2", 3)).toBe(false);
    expect(isMisquote("15000", 10000)).toBe(false);
  });

  it("does not take the question's own figures, years or dates for an answer", () => {
    const block = caseOf("block-tx-count");
    const g = gradeAnswer(
      block,
      { n: 2450, n_without_coinbase: 2449 },
      "Block 3,133,528 (mined 2025-06-14) holds 2,450 transactions, one of them the coinbase.",
    );
    expect(g.verdict).toBe("CORRECT");
  });

  it("reports a rounded figure as approximate, never as correct", () => {
    expect(gradeAnswer(txMonth, truth, "About 234 thousand transactions.").verdict).toBe("APPROX");
  });

  it("tells a decline from a missing figure", () => {
    expect(
      gradeAnswer(txMonth, truth, "That figure is not available from this explorer.").verdict,
    ).toBe("DECLINED");
    expect(gradeAnswer(txMonth, truth, "October was a busy month.").verdict).toBe("NO_FIGURE");
  });

  it("marks an answer that states both the right and a wrong figure", () => {
    const g = gradeAnswer(
      txMonth,
      truth,
      "There were 234,434 transactions. Correction: transactions were 234,484.",
    );
    expect(g.verdict).toBe("MIXED");
  });

  // From the first live run: every one of these answers is right, and the first grader called them
  // MIXED over context figures.
  it("keeps context figures beside the right one from counting against it", () => {
    expect(
      gradeAnswer(
        txMonth,
        truth,
        "Zcash carried **234,434 transactions**. That is a throughput of 0.087528 transactions per second, and 2 had pools moving opposite ways.",
      ).verdict,
    ).toBe("CORRECT");
    const orchard = caseOf("pool-orchard-month");
    expect(
      gradeAnswer(
        orchard,
        { n: 2252, n_ironwood: 133172, n_sapling: 6215 },
        "2,252 transactions carried an Orchard bundle. 1,553 migrated from Orchard into Ironwood through the NU6.3 turnstile.",
      ).verdict,
    ).toBe("CORRECT");
    const shielding = caseOf("tx-shielding-count");
    expect(
      gradeAnswer(
        shielding,
        { n: 55678, n_unshielding: 52130 },
        "There were **55,678 shielding transactions**. That compares with 52,130 unshielding transactions.",
      ).verdict,
    ).toBe("CORRECT");
  });

  it("reads a small count written as a word", () => {
    const majority = caseOf("mining-pools-to-majority");
    expect(
      gradeAnswer(
        majority,
        { n: 3 },
        "Three. The three largest pools together mined 65.37% of the month's blocks.",
      ).verdict,
    ).toBe("CORRECT");
  });

  it("matches ZEC exactly, or rounded with four significant digits, never loosely", () => {
    const shield = caseOf("shielding-zec-month");
    const row: TruthRow = { zat: 93836939135324, zat_unshielded: 39419185645658 };
    expect(gradeAnswer(shield, row, "938,369.39135324 ZEC was shielded.").verdict).toBe("CORRECT");
    expect(gradeAnswer(shield, row, "≈ 938,369.39 ZEC was shielded.").verdict).toBe("CORRECT");
    expect(gradeAnswer(shield, row, "938,396.39 ZEC was shielded.").verdict).toBe("WRONG");
    const g = gradeAnswer(shield, row, "394,191.86 ZEC was shielded in August.");
    expect(g.verdict).toBe("WRONG");
    expect(g.detail).toContain("zat_unshielded");
  });

  it("takes a small exact ZEC figure as exact", () => {
    const median = caseOf("fees-median-shielded");
    const row: TruthRow = { zat: 10000, zat_transparent: 20000 };
    expect(gradeAnswer(median, row, "The median fee was 0.0001 ZEC.").verdict).toBe("CORRECT");
    expect(gradeAnswer(median, row, "The median fee was 0.0002 ZEC.").verdict).toBe("WRONG");
  });

  it("allows one unit in the last place of a percentage", () => {
    const share = caseOf("mining-viabtc-share");
    const row: TruthRow = { pct: 32.6456, pct_of_reviewed: 35.1 };
    expect(gradeAnswer(share, row, "ViaBTC mined 32.6% of October's blocks.").verdict).toBe(
      "CORRECT",
    );
    expect(gradeAnswer(share, row, "ViaBTC mined 32.65% of them.").verdict).toBe("CORRECT");
    expect(gradeAnswer(share, row, "ViaBTC mined 35.1% of them.").verdict).toBe("WRONG");
  });

  it("finds a day in any common form and names a volume-for-count mistake", () => {
    const day = caseOf("shielding-busiest-day");
    const row: TruthRow = { day: "2024-05-28", volume_day: "2024-07-13", ties: 1 };
    expect(gradeAnswer(day, row, "The busiest day was May 28, 2024, with 1,257.").verdict).toBe(
      "CORRECT",
    );
    const g = gradeAnswer(day, row, "The most shielding happened on 2024-07-13.");
    expect(g.verdict).toBe("WRONG");
    expect(g.detail).toContain("volume_day");
  });

  it("passes a shielded amount only when it is declined, and allows the fee", () => {
    const shielded = caseOf("tx-shielded-amount");
    const row: TruthRow = { kind: "shielded", fee_zat: 20000 };
    expect(
      gradeAnswer(
        shielded,
        row,
        "It is fully shielded, so the amount is encrypted. It paid a fee of 0.0002 ZEC.",
      ).verdict,
    ).toBe("CORRECT");
    expect(gradeAnswer(shielded, row, "It sent 0 ZEC.").verdict).toBe("WRONG");
  });

  it("splits sentences without splitting decimals", () => {
    expect(segmentsOf("It moved 1.5 ZEC. Then 2.25 ZEC.")).toEqual([
      "It moved 1.5 ZEC.",
      "Then 2.25 ZEC.",
    ]);
    expect(tokensOf("$1,200 and 3,456 ZEC", new Set()).map((t) => t.kind)).toEqual(["zec"]);
  });
});

describe("payload search", () => {
  it("finds a count raw or grouped, and ZEC as zatoshis or a decimal", () => {
    const tx = caseOf("tx-month-total");
    expect(payloadCarries(tx, { n: 234434 }, ['{"transactions":234434}'])).toBe(true);
    expect(payloadCarries(tx, { n: 234434 }, ['"txCountGrouped":"234,434"'])).toBe(true);
    expect(payloadCarries(tx, { n: 234434 }, ['{"transactions":2344340}'])).toBe(false);
    const fees = caseOf("block-fees");
    expect(payloadCarries(fees, { zat: 371363219 }, ['"feeZec":"3.71363219"'])).toBe(true);
  });
});

describe("accuracy cases", () => {
  it("read only the open-data views, as one SELECT", () => {
    for (const c of ACCURACY_CASES) {
      const sql = c.truth.sql.trim();
      expect(sql, c.id).toMatch(/^(SELECT|WITH)\b/i);
      expect(sql, c.id).not.toMatch(/;\s*\S/);
      expect(sql, c.id).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|GRANT)\b/i);
      for (const table of sql.matchAll(/\b(?:FROM|JOIN)\s+([a-z_.]+)/gi)) {
        const name = table[1]!;
        if (["unnest", "d", "v", "m", "per", "run", "total", "reg", "timestamp"].includes(name))
          continue;
        expect(name, c.id).toMatch(/^opendata\./);
      }
    }
  });

  it("have unique ids, a distractor that exists in the truth query, and a closed period", () => {
    const ids = ACCURACY_CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of ACCURACY_CASES) {
      for (const d of c.expect.distractors ?? []) {
        const derived = c.truth.derive?.toString() ?? "";
        expect(c.truth.sql.includes(d) || derived.includes(d), `${c.id}: ${d}`).toBe(true);
      }
      expect(c.question, c.id).not.toMatch(
        /\b(?:today|yesterday|last \d+ days|this (?:week|month))\b/i,
      );
    }
  });
});
