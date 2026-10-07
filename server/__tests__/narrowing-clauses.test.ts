import { describe, expect, it } from "vitest";
import type { ListOptions } from "@/data/crosschain/store";
import { narrowingClauses } from "../postgres-crosschain-store";

/**
 * The bind placeholders, structurally: every value `narrowingClauses` pushes into `params` must
 * be referenced by a `$N` in some clause, exactly once each, with no `$N` past the array.
 *
 * A lost `$` (e.g. `String.prototype.replace` treating `$$` as one literal dollar) leaves valid
 * SQL that compares against the parameter index, which the in-memory store never runs and the
 * database suites skip without `TEST_DATABASE_URL`. This asks the structural question with no
 * database in the loop.
 */

/** Every narrowing at once, so every push site in the function runs. */
const EVERY_NARROWING: ListOptions = {
  includeProtocolLegs: false,
  protocol: "maya",
  direction: "in",
  sourceChains: ["BTC", "ZEC"],
  destinationChains: ["ETH", "ZEC"],
  counterpartChains: ["BTC", "ETH"],
  minUsdAtSwap: 10_000,
  minZecZat: 500_000_000_000,
  fromTimestamp: 1_750_000_000,
  toTimestamp: 1_780_000_000,
};

/** Options exercising the single-arm branches the full set cannot reach at the same time. */
const FOREIGN_ONLY_SIDES: ListOptions = {
  sourceChains: ["BTC"],
  destinationChains: ["ETH"],
};

function placeholderIndexes(clauses: readonly string[]): number[] {
  return clauses
    .join(" ")
    .split(/\$(\d+)/)
    .filter((_, i) => i % 2 === 1)
    .map(Number);
}

describe("narrowingClauses bind placeholders", () => {
  for (const [name, options] of [
    ["every narrowing at once", EVERY_NARROWING],
    ["foreign-only chain sides", FOREIGN_ONLY_SIDES],
    ["no narrowing at all", {}],
  ] as const) {
    it(`references every pushed param exactly once — ${name}`, () => {
      const params: unknown[] = [];
      const clauses = narrowingClauses(options, params);
      const indexes = placeholderIndexes(clauses).sort((a, b) => a - b);
      // Exactly $1..$N, each once: a missing index is a pushed value the statement never
      // references (Postgres rejects the bind), a duplicate or out-of-range one is a clause
      // reading the wrong slot.
      expect(indexes).toEqual(params.map((_, i) => i + 1));
    });
  }

  it("carries no bare integer comparison where a placeholder belongs", () => {
    // The mangled form is VALID SQL (`usd_value_at_swap >= 2` compares against the literal
    // parameter index), which is what let it ship twice — so the shape is forbidden by name:
    // a comparison operator followed by a bare small integer that equals a parameter index.
    const params: unknown[] = [];
    const clauses = narrowingClauses(EVERY_NARROWING, params);
    for (const clause of clauses) {
      expect(clause).not.toMatch(/(?:>=|<=|<>|=|<|>)\s*\d+\s*$/);
    }
  });
});
