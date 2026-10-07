import { describe, expect, it } from "vitest";
import { AgentTools } from "../tools";
import { makeChain, makeV1, FIXTURE_NOW_MS } from "../testing/fixture-world";

const tools = () => new AgentTools(makeV1(), makeChain(), () => FIXTURE_NOW_MS);
const window = (args: Record<string, unknown>) =>
  tools().dispatch("chain_activity", JSON.stringify({ mode: "window", ...args }));

interface Bucket {
  transparentTxs: number;
  mixedTxs: number;
  shieldedTxs: number;
  shieldingTxs: number;
  unshieldingTxs: number;
  indeterminateTxs: number;
  avgDifficulty: number | null;
}

/** The JSON body out of the `<data>` envelope every aggregate is wrapped in. */
function parse(out: { content: string }): {
  groups: Bucket[];
  ranking: Record<string, number | string>;
  totals: unknown;
} {
  return JSON.parse(out.content.slice(out.content.indexOf("{")).split("\n</data>")[0] ?? "{}");
}

const txs = (g: Bucket) => g.transparentTxs + g.mixedTxs + g.shieldedTxs;

/**
 * Ranking, at the tool boundary. The domain tests prove the ordering; these prove what only the
 * tool can get wrong: that a ranking cannot be asked for where it would be meaningless, that the
 * payload stops claiming to be date-ordered once it is not, and that the note carries the tie rule
 * instead of the ordering sentence it replaces.
 */

describe("a ranking is refused where it would answer a question nobody asked", () => {
  it("rejects sort with groupBy none", async () => {
    // One bucket covering the whole window: ranking it would present the window as its own busiest
    // period — a well-formed answer to nothing.
    const out = await window({ from: "2026-07-01", to: "2026-08-01", sort: "transactions" });
    expect(out.content).toMatch(/sort needs groupBy day or month/);
    expect(out.endpoints).toEqual([]);
  });

  it("rejects an unknown measure by naming the ones that exist", async () => {
    const out = await window({ groupBy: "day", sort: "hashrate" });
    expect(out.content).toMatch(/sort must be one of/);
    expect(out.content).toMatch(/shielded-transactions/);
  });

  it("bounds top", async () => {
    const out = await window({ groupBy: "day", sort: "fees", top: 500 });
    expect(out.content).toMatch(/top must be between 1 and 30/);
  });
});

describe("the payload says how it is ordered", () => {
  it("returns the periods in ranked order, over every bucket in the window", async () => {
    const body = parse(await window({ groupBy: "day", sort: "transactions", top: 3 }));
    expect(body.ranking.measure).toBe("transactions");
    expect(body.ranking.order).toBe("highest");
    // The fixture's five days total 9,000 / 6,000 / 5,000 / 3,000 / 2,000 transactions and the
    // busiest is not first in date order, so a payload that forgot to sort, or sorted the wrong
    // way, fails here.
    expect(body.groups.map(txs)).toEqual([9_000, 6_000, 5_000]);
    expect(body.ranking.considered).toBe(5);
    expect(body.ranking.groupsInWindow).toBe(5);
    expect(body.ranking.tiedAtTop).toBe(1);
  });

  it("ranks lowest-first when asked, which is what a 'quietest' question needs", async () => {
    const body = parse(
      await window({ groupBy: "day", sort: "transactions", order: "lowest", top: 2 }),
    );
    expect(body.groups.map(txs)).toEqual([2_000, 3_000]);
  });

  /*
   * The two rules a superlative gets wrong. A tie is reported rather than resolved (the fixture
   * ties two days at 900,000,000 zatoshi of fees). And a null difficulty is dropped rather than
   * ranked as zero; sorted ascending it would otherwise publish an unmeasured day as the
   * lowest-difficulty day on record.
   */
  it("reports a tie at the top instead of picking a winner", async () => {
    expect(parse(await window({ groupBy: "day", sort: "fees" })).ranking.tiedAtTop).toBe(2);
  });

  it("drops an unmeasured period rather than ranking it as zero", async () => {
    const body = parse(await window({ groupBy: "day", sort: "difficulty", order: "lowest" }));
    expect(body.ranking.unmeasured).toBe(1);
    expect(body.ranking.considered).toBe(4);
    // 59,000,000 is the lowest measured difficulty; the null day would sort below it.
    expect(body.groups[0]?.avgDifficulty).toBe(59_000_000);
  });

  /*
   * The unranked note says `groups` is ordered oldest first and that "the last N days" means its
   * final entries. Under a ranking that is false, and carrying both sentences would leave the model
   * to choose between them.
   */
  it("replaces the date-ordering sentence rather than appending to it", async () => {
    const ranked = await window({ groupBy: "day", sort: "fees" });
    expect(ranked.content).toMatch(/ORDERED BY THE RANKING, BEST FIRST/);
    expect(ranked.content).not.toMatch(/ordered OLDEST FIRST/);

    const plain = await window({ groupBy: "day" });
    expect(plain.content).toMatch(/ordered OLDEST FIRST/);
    expect(plain.content).not.toMatch(/ORDERED BY THE RANKING/);
  });

  it("carries the tie rule and the unmeasured rule in the note", async () => {
    const out = await window({ groupBy: "day", sort: "difficulty" });
    expect(out.content).toMatch(/tiedAtTop/);
    expect(out.content).toMatch(/must not name one/);
    expect(out.content).toMatch(/unmeasured, never zero/);
    // Ranking fees ranks floors, and a reader has to be told when a ranked row is short.
    expect(out.content).toMatch(/RANKING BY FEES IS RANKING FLOORS/);
  });

  it("leaves totals covering the whole window, not the ranked rows", async () => {
    const plain = await window({ groupBy: "day" });
    const ranked = await window({ groupBy: "day", sort: "transactions", top: 1 });
    expect(parse(ranked).totals).toEqual(parse(plain).totals);
    // The ranked payload really did drop rows, so the equality above is a claim about `totals`
    // surviving rather than about nothing having happened.
    expect(parse(ranked).groups.length).toBe(1);
    expect(parse(plain).groups.length).toBe(5);
  });
});

/**
 * One word, one meaning, inside one tool. If `shielding` named a transaction class in
 * `recent-transactions` and a zatoshi volume in `sort`, nothing in the schema would separate them
 * and a count question could be answered with a volume. Asserted over the tool's real schema, since
 * the schema is all a model can see.
 */
describe("the ranking measures do not restate a transaction kind", () => {
  const schema = async () => {
    const def = (await tools().defs()).find((d) => d.function.name === "chain_activity");
    const params = def!.function.parameters as unknown as {
      properties: {
        sort: { enum: readonly string[] };
        kind: { enum: readonly string[] };
      };
    };
    return { measures: params.properties.sort.enum, kinds: params.properties.kind.enum };
  };

  it("shares no name between sort and kind", async () => {
    const { measures, kinds } = await schema();
    // Both halves are non-empty, so an emptied enum cannot pass this by having nothing to collide.
    expect(measures.length).toBeGreaterThan(0);
    expect(kinds.length).toBeGreaterThan(0);
    expect(measures.filter((m) => kinds.includes(m))).toEqual([]);
  });

  /**
   * A measure that ranks zatoshis says ZEC in its own name: the enum value is where units must be
   * stated, because a description sits paragraphs away from the value the model chooses.
   */
  it("names the unit on the measures that rank a ZEC amount", async () => {
    const { measures } = await schema();
    expect(measures).toContain("zec-shielded");
    expect(measures).toContain("zec-unshielded");
  });
});

/**
 * `shielded-transactions` counts fully shielded transactions, a different class from shielding
 * ones, and sits one word away from a shielding-count question — so the note keeps the adjacent
 * figures apart where the choice is made.
 */
describe("the note keeps the four adjacent figures apart", () => {
  it("distinguishes fully shielded from shielding, and says where the all-time counts are", async () => {
    const out = await window({ groupBy: "day", sort: "zec-shielded" });
    expect(out.content).toMatch(/fully shielded/i);
    expect(out.content).toMatch(/tx-counts/);
    // The ZEC measures are described as amounts, so quoting one as a count is not left open.
    expect(out.content).toMatch(/AMOUNTS, never counts/);
  });
});

/**
 * The fixture's shielding peak is the fourth day (900) while the busiest day for transactions,
 * fully shielded transactions and unshielding is the second, so each assertion fails on a different
 * wrong column rather than on a wrong figure.
 */
describe("ranking by shielding transactions", () => {
  const dayOf = (out: { content: string }, i: number) => parse(out).groups[i];

  it("ranks by the shielding column, not by mixed, fully shielded or unshielding", async () => {
    const out = await window({ groupBy: "day", sort: "shielding-transactions", top: 1 });
    expect(dayOf(out, 0)!.shieldingTxs).toBe(900);
    // Not a neighbouring column: this day is not the busiest by any of them.
    expect(dayOf(out, 0)!.unshieldingTxs).toBe(98);
    expect(dayOf(out, 0)!.shieldedTxs).toBe(600);
  });

  it("ranks unshielding separately, landing on a different day", async () => {
    const out = await window({ groupBy: "day", sort: "unshielding-transactions", top: 1 });
    expect(dayOf(out, 0)!.unshieldingTxs).toBe(1_295);
    expect(dayOf(out, 0)!.shieldingTxs).toBe(700);
  });

  it("carries a split that partitions the mixed count exactly", async () => {
    const out = await window({ groupBy: "day" });
    for (const g of parse(out).groups) {
      expect(g.shieldingTxs + g.unshieldingTxs + g.indeterminateTxs).toBe(g.mixedTxs);
    }
  });
});
