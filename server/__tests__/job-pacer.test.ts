import { describe, expect, it } from "vitest";
import {
  createPacer,
  IngestionBehindError,
  ioPressureAvg10,
  type PacerDeps,
  type PacerOptions,
} from "../job-pacer";
import { MAX_CHUNK, MIN_CHUNK, nextChunkSpan, spanAfterTimeout } from "../tx-count-backfill";

/**
 * The pacer's policy, tested without a database and without waiting: the clock, the sleep and
 * both signals are injected, so "how long does it rest, and when does it give up" is answerable
 * inside a test. Each test names the mutation that must break it.
 */

/**
 * A pacer wired to scripted lag samples, recording every sleep instead of performing it.
 *
 * `behind` is in blocks behind the node, not seconds since the last commit: a quiet chain can go
 * minutes without a block while the follower sits at the tip. Every `commitAgeSeconds` below is
 * pinned high, so a test that would pass only because that number is small fails instead.
 */
function harness(behind: number[], options: PacerOptions = {}, pressures: (number | null)[] = []) {
  const slept: number[] = [];
  const logs: string[] = [];
  let lagIndex = 0;
  let pressureIndex = 0;

  const deps: PacerDeps = {
    // The last scripted value repeats, so a test only lists the samples it cares about.
    ingestLag: () =>
      Promise.resolve({
        blocksBehind: behind[Math.min(lagIndex++, behind.length - 1)] ?? 0,
        commitAgeSeconds: 600,
      }),
    ioPressure: () =>
      Promise.resolve(
        pressures.length === 0
          ? null
          : (pressures[Math.min(pressureIndex++, pressures.length - 1)] ?? null),
      ),
    sleep: (ms) => {
      slept.push(ms);
      return Promise.resolve();
    },
    log: (m) => logs.push(m),
  };

  return { pacer: createPacer(deps, options), slept, logs };
}

describe("job pacer", () => {
  describe("preflight", () => {
    it("refuses to start when the follower is already behind the node", async () => {
      const { pacer } = harness([9]);
      await expect(pacer.preflight()).rejects.toThrow(IngestionBehindError);
    });

    it("names the lag it saw, so the operator does not have to go looking", async () => {
      const { pacer } = harness([9]);
      await expect(pacer.preflight()).rejects.toThrow(/9 blocks behind/);
    });

    it("starts against a follower at the tip", async () => {
      const { pacer } = harness([0]);
      await expect(pacer.preflight()).resolves.toBeUndefined();
    });

    it("starts when one block is outstanding, which is ordinary", async () => {
      // The follower polls every 5 s, so it is briefly one block behind whenever a block is mined.
      // Treating that as a stall would refuse most healthy starts.
      const { pacer } = harness([1]);
      await expect(pacer.preflight()).resolves.toBeUndefined();
    });

    it("starts on a quiet chain, however long since the last block", async () => {
      // The regression that motivated the signal change: 0 blocks behind, 600 s since the last
      // commit. Nothing is wrong — no block has been mined. Mutation: trigger on
      // `commitAgeSeconds` and this is the test that fails.
      const { pacer } = harness([0]);
      await expect(pacer.preflight()).resolves.toBeUndefined();
    });

    it("refuses when the lag cannot be determined at all", async () => {
      // `readIngestLag` yields Infinity when the node or our tip cannot be read, so "no evidence"
      // must not read as "ingestion is fine".
      const { pacer } = harness([Number.POSITIVE_INFINITY]);
      await expect(pacer.preflight()).rejects.toThrow(IngestionBehindError);
    });
  });

  describe("resting in proportion to the work done", () => {
    it("sleeps for as long as the unit took at duty 0.5", async () => {
      const { pacer, slept } = harness([0], { duty: 0.5 });
      await expect(pacer.afterUnit(7_000)).resolves.toBe("continue");
      expect(slept).toEqual([7_000]);
    });

    it("sleeps three times the work at duty 0.25", async () => {
      const { pacer, slept } = harness([0], { duty: 0.25 });
      await pacer.afterUnit(7_000);
      expect(slept).toEqual([21_000]);
    });

    it("does not sleep at all at duty 1", async () => {
      const { pacer, slept } = harness([0], { duty: 1 });
      await pacer.afterUnit(7_000);
      expect(slept).toEqual([]);
    });

    it("rejects a duty outside (0, 1]", () => {
      expect(() => createPacer({} as PacerDeps, { duty: 0 })).toThrow(/duty/);
      expect(() => createPacer({} as PacerDeps, { duty: 1.5 })).toThrow(/duty/);
    });

    it("rests a second time when io pressure is high", async () => {
      const { pacer, slept } = harness([0], { duty: 0.5, pressureThreshold: 60 }, [90]);
      await pacer.afterUnit(7_000);
      expect(slept).toEqual([7_000, 7_000]);
    });

    it("does not rest twice when pressure is unreadable", async () => {
      // Null is "no signal", and the lag check below is what actually protects ingestion.
      const { pacer, slept } = harness([0], { duty: 0.5 }, [null]);
      await pacer.afterUnit(7_000);
      expect(slept).toEqual([7_000]);
    });
  });

  describe("stall detection", () => {
    it("continues through a single bad sample that then recovers", async () => {
      // The follower has been observed catching up 50 blocks at once, so a sample taken mid-burst
      // shows a large lag while the follower is working, not failing.
      const { pacer } = harness([9, 1], { duty: 1, stallSamples: 2, stallBlocks: 5 });
      await expect(pacer.afterUnit(1_000)).resolves.toBe("continue");
    });

    it("aborts once the stall is sustained across consecutive samples", async () => {
      const { pacer } = harness([9, 12], { duty: 1, stallSamples: 2, stallBlocks: 5 });
      await expect(pacer.afterUnit(1_000)).resolves.toBe("abort");
    });

    it("backs off between stall samples rather than spinning", async () => {
      const { pacer, slept } = harness([9, 12], {
        duty: 1,
        stallSamples: 2,
        stallBlocks: 5,
        stallBackoffMs: 30_000,
      });
      await pacer.afterUnit(1_000);
      expect(slept).toEqual([30_000]);
    });

    it("resets the count after a recovery, so two isolated blips never abort", async () => {
      // The failure this pins: counting stalls cumulatively instead of consecutively would abort
      // any long run, since two catch-up bursts across two hours are inevitable.
      const { pacer } = harness([9, 1, 9, 1], { duty: 1, stallSamples: 2, stallBlocks: 5 });
      await expect(pacer.afterUnit(1_000)).resolves.toBe("continue");
      await expect(pacer.afterUnit(1_000)).resolves.toBe("continue");
    });

    it("treats the threshold as inclusive", async () => {
      const { pacer } = harness([5, 5], { duty: 1, stallSamples: 2, stallBlocks: 5 });
      await expect(pacer.afterUnit(1_000)).resolves.toBe("abort");
    });

    it("never aborts on a quiet chain the follower is keeping up with", async () => {
      // The whole point of counting blocks rather than seconds: this run aborts under the first
      // implementation with nothing wrong.
      const { pacer } = harness([0], { duty: 1, stallSamples: 2, stallBlocks: 5 });
      for (let i = 0; i < 5; i += 1) {
        await expect(pacer.afterUnit(1_000)).resolves.toBe("continue");
      }
      expect(pacer.stats.stallSamples).toBe(0);
    });
  });

  describe("stats", () => {
    it("records the worst lag seen and the total rest, for the completion log", async () => {
      const { pacer } = harness([0, 3, 1], { duty: 0.5 });
      await pacer.afterUnit(1_000);
      await pacer.afterUnit(1_000);
      expect(pacer.stats.sleptMs).toBe(2_000);
      expect(pacer.stats.maxBlocksBehind).toBe(3);
      expect(pacer.stats.stallSamples).toBe(0);
    });

    it("counts stall samples that recovered, not only ones that aborted", async () => {
      const { pacer } = harness([9, 1], { duty: 1, stallSamples: 2, stallBlocks: 5 });
      await pacer.afterUnit(1_000);
      expect(pacer.stats.stallSamples).toBe(1);
    });
  });

  describe("ioPressureAvg10", () => {
    const REAL = [
      "some avg10=40.65 avg60=61.72 avg300=28.79 total=15078310321",
      "full avg10=39.35 avg60=60.11 avg300=27.94 total=14527044070",
    ].join("\n");

    it("reads `some avg10` from the real file's format", async () => {
      // Captured verbatim from a live host.
      await expect(ioPressureAvg10(() => Promise.resolve(REAL))).resolves.toBeCloseTo(40.65);
    });

    it("takes `some`, not `full`", async () => {
      // `full` is "every task stalled"; `some` is the earlier, more sensitive warning.
      await expect(ioPressureAvg10(() => Promise.resolve(REAL))).resolves.not.toBeCloseTo(39.35);
    });

    it("returns null when the file is unreadable", async () => {
      await expect(ioPressureAvg10(() => Promise.reject(new Error("ENOENT")))).resolves.toBeNull();
    });

    it("returns null rather than 0 when the format is unrecognised", async () => {
      // 0 would read as "perfectly quiet" and is the one wrong answer here.
      await expect(ioPressureAvg10(() => Promise.resolve("unexpected"))).resolves.toBeNull();
    });
  });
});

describe("adaptive chunk sizing", () => {
  /**
   * Transaction density varies ~45x along this chain (a 10,000-block chunk takes seconds near the
   * tip and minutes in the dense eras), so a fixed span produces statements from seconds to
   * minutes and gives the pacer only one yield point per statement.
   */
  it("shrinks the span when a chunk overran its target", () => {
    // 10,000 blocks took 140 s against a 20 s target, so aim for about a seventh.
    expect(nextChunkSpan(10_000, 140_000, 20_000)).toBe(2_500);
  });

  it("grows the span when a chunk finished early", () => {
    expect(nextChunkSpan(10_000, 5_000, 20_000)).toBe(20_000);
  });

  it("never grows more than 2x in one step", () => {
    // A single anomalously fast chunk must not send the size oscillating.
    expect(nextChunkSpan(1_000, 1, 20_000)).toBe(2_000);
  });

  it("never shrinks more than 4x in one step", () => {
    expect(nextChunkSpan(10_000, 10_000_000, 20_000)).toBe(2_500);
  });

  it("holds the span when a chunk hit its target exactly", () => {
    expect(nextChunkSpan(4_000, 20_000, 20_000)).toBe(4_000);
  });

  it("clamps to the bounds", () => {
    expect(nextChunkSpan(MIN_CHUNK, 10_000_000, 20_000)).toBe(MIN_CHUNK);
    expect(nextChunkSpan(MAX_CHUNK, 1, 20_000)).toBe(MAX_CHUNK);
  });

  it("grows rather than dividing by zero when a chunk returned instantly", () => {
    expect(nextChunkSpan(1_000, 0, 20_000)).toBe(2_000);
  });
});

describe("retrying a timed-out span", () => {
  /**
   * A span grown to its ceiling through a light era can meet a much denser one and exceed the
   * statement timeout. `nextChunkSpan` learns only from chunks that succeed, so without halving
   * the run dies at the first density cliff instead of adapting.
   */
  it("halves the span", () => {
    expect(spanAfterTimeout(25_000)).toBe(12_500);
    expect(spanAfterTimeout(12_500)).toBe(6_250);
  });

  it("halves rather than dropping straight to the floor", () => {
    // The observed overshoot was ~3x, so one or two halvings is the usual cure. Going to MIN_CHUNK
    // immediately would crawl a dense era at 200 blocks per chunk.
    expect(spanAfterTimeout(25_000)).toBeGreaterThan(MIN_CHUNK);
  });

  it("never goes below the floor", () => {
    expect(spanAfterTimeout(MIN_CHUNK * 2 - 1)).toBe(MIN_CHUNK);
  });

  it("gives up at the floor, so a genuinely impossible chunk still surfaces", () => {
    // Null is what makes the loop rethrow. Without it a chunk that cannot complete at any size
    // would retry forever and the run would look like it was still working.
    expect(spanAfterTimeout(MIN_CHUNK)).toBeNull();
    expect(spanAfterTimeout(1)).toBeNull();
  });
});
