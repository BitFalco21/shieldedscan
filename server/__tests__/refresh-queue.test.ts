import { describe, expect, it } from "vitest";
import { createRefreshQueue, type RefreshJob } from "../refresh-queue";

/** A job that records when it ran and finishes only when released. */
function gated(name: string, trace: string[]) {
  let release: () => void = () => undefined;
  const done = new Promise<void>((resolve) => {
    release = resolve;
  });
  const job: RefreshJob = {
    name,
    refresh: async () => {
      trace.push(`start ${name}`);
      await done;
      trace.push(`end ${name}`);
    },
  };
  return { job, release };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the refresh queue", () => {
  it("runs one refresh at a time, across groups, in the order queued", async () => {
    const trace: string[] = [];
    const queue = createRefreshQueue(() => undefined);
    const a = gated("a", trace);
    const b = gated("b", trace);
    const c = gated("c", trace);
    queue.enqueue([a.job, b.job]);
    queue.enqueue([c.job]);
    await tick();
    expect(trace).toEqual(["start a"]);
    a.release();
    await tick();
    expect(trace).toEqual(["start a", "end a", "start b"]);
    b.release();
    c.release();
    await queue.idle();
    expect(trace).toEqual(["start a", "end a", "start b", "end b", "start c", "end c"]);
  });

  it("skips a view that is still queued or running, and says so", async () => {
    const trace: string[] = [];
    const lines: string[] = [];
    const queue = createRefreshQueue((line) => lines.push(line));
    const a = gated("a", trace);
    const b = gated("b", trace);
    queue.enqueue([a.job, b.job]);
    queue.enqueue([a.job, b.job]);
    expect(lines.filter((l) => l.includes("SKIPPED"))).toHaveLength(2);
    a.release();
    b.release();
    await queue.idle();
    expect(trace).toEqual(["start a", "end a", "start b", "end b"]);
    // Once a pass is done, the view can be queued again.
    queue.enqueue([a.job]);
    await queue.idle();
    expect(trace.filter((t) => t === "start a")).toHaveLength(2);
  });

  it("keeps going after a failed refresh, and logs it", async () => {
    const lines: string[] = [];
    const queue = createRefreshQueue((line) => lines.push(line));
    let ran = false;
    queue.enqueue([
      { name: "broken", refresh: () => Promise.reject(new Error("boom")) },
      {
        name: "fine",
        refresh: async () => {
          ran = true;
          return 7;
        },
      },
    ]);
    await queue.idle();
    expect(ran).toBe(true);
    expect(lines.some((l) => l.startsWith("broken refresh FAILED") && l.includes("boom"))).toBe(
      true,
    );
    expect(lines.some((l) => /^fine refreshed in \d+ms \(7 rows changed\)$/.test(l))).toBe(true);
  });

  it("starts a new pass for a job queued right after the queue ran dry", async () => {
    const trace: string[] = [];
    const queue = createRefreshQueue(() => undefined);
    queue.enqueue([{ name: "first", refresh: async () => void trace.push("first") }]);
    await queue.idle();
    queue.enqueue([{ name: "second", refresh: async () => void trace.push("second") }]);
    await queue.idle();
    expect(trace).toEqual(["first", "second"]);
  });

  it("treats a synchronous throw as a failure, runs the next job, and lets the view run again", async () => {
    const lines: string[] = [];
    const queue = createRefreshQueue((line) => lines.push(line));
    let attempts = 0;
    const broken: RefreshJob = {
      name: "broken",
      refresh: () => {
        attempts += 1;
        throw new Error("sync");
      },
    };
    let ran = false;
    queue.enqueue([broken, { name: "next", refresh: async () => void (ran = true) }]);
    await queue.idle();
    expect(ran).toBe(true);
    expect(lines.some((l) => l.startsWith("broken refresh FAILED") && l.includes("sync"))).toBe(
      true,
    );
    queue.enqueue([broken]);
    await queue.idle();
    expect(attempts).toBe(2);
  });
});
