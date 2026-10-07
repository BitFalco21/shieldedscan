import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every read-path connection pool must bound its queries: an unbounded query on a small pool
 * denies service to every unrelated request sharing it, which is indistinguishable from an
 * outage (a slow cold query holding both connections of a `max: 2` pool blocks a 64 kB matview
 * read behind it).
 *
 * A source-text assertion: these pools are constructed at module load against a real database,
 * so the check that runs in CI reads the code. It cannot prove the timeout fires, only that the
 * guard is present.
 */

const SERVER_DIR = join(process.cwd(), "server");

/**
 * Files whose pools serve HTTP reads, with the count of such pools in each. Stated rather than
 * inferred, so adding a read pool fails this test until someone decides whether it needs a bound.
 *
 * Excluded, because a short deadline there would be the bug: `postgres-chain-store.ts` and
 * `repair-fees-main.ts` (ingest and repair, whose writes legitimately run for minutes), and the
 * price and rate history pool in `app/jobs.ts` (a background backfill).
 */
const READ_PATH_POOLS: Record<string, number> = {
  "analytics-routes.ts": 1,
  "reorg-routes.ts": 1,
  "postgres-crosschain-store.ts": 1,
  // The site's chain index and the public surface's.
  "app/stores.ts": 2,
  // The /v1 core pool, the windowed analytics, the daily series, the address walks and the miners.
  "app/v1.ts": 5,
};

function source(file: string): string {
  return readFileSync(join(SERVER_DIR, file), "utf8");
}

/** `statement_timeout` occurrences outside comment lines — the code, not the prose. */
function guardCount(text: string): number {
  return (
    text
      .split("\n")
      .filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//"))
      .join("\n")
      .split("statement_timeout").length - 1
  );
}

describe("read-path pools bound their queries", () => {
  it.each(Object.entries(READ_PATH_POOLS))(
    "%s guards all %d of its read pools with a statement_timeout",
    (file, expected) => {
      expect(guardCount(source(file))).toBeGreaterThanOrEqual(expected);
    },
  );

  it("the analytics pool is wider than the two connections that starved it", () => {
    // Two was the whole margin: two slow queries and nothing else could run. The exact
    // number matters less than that it is not 2, so this asserts the floor, not a value.
    // Read from the code, not the comment above it that quotes the old `max: 2`.
    const text = source("analytics-routes.ts");
    const max = Number(text.match(/const POOL = \{ max: (\d+)/)?.[1] ?? 0);
    expect(max).toBeGreaterThanOrEqual(4);
  });

  it("timeouts are long enough for honest work and short enough to end a hang", () => {
    // A timeout below a few seconds would kill legitimate cold-cache analytics and leave
    // the panels permanently unavailable after a restart — trading an outage for a
    // different outage. Anything past a minute stops being a guard at all.
    const text = Object.keys(READ_PATH_POOLS).map(source).join("\n");
    const timeouts = [...text.matchAll(/statement_timeout:\s*([0-9_]+)/g)].map((m) =>
      Number((m[1] ?? "").replace(/_/g, "")),
    );
    expect(timeouts.length).toBeGreaterThan(0);
    for (const t of timeouts) {
      expect(t).toBeGreaterThanOrEqual(5_000);
      expect(t).toBeLessThanOrEqual(60_000);
    }
  });
});
