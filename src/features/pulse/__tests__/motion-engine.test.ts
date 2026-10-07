import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureDataSource } from "@/data/fixture-source";
import { PulseMotionEngine } from "../motion-engine";
import { pulseLayout } from "../pulse-layout";
import type { PulseCollapsedBlock } from "../pulse-scheduler";

/**
 * The engine's count-only marks — the ones that stand where an amount cannot.
 *
 * At ×600 a replay collapses every block and crosses an hour in six seconds, so a fresh mark per
 * block would stack glowing rects on one point until their glows summed into a blob. Brightness
 * that tracks how many marks overlap measures nothing. One mark per node; the arithmetic goes
 * into the number and the title, which names the range of blocks it stands for.
 */

const frame = await fixtureDataSource.getPulseFrame();
const ribbons = await fixtureDataSource.getPulseRibbons();

const NS = "http://www.w3.org/2000/svg";

function build(still = false) {
  const stage = document.createElementNS(NS, "svg");
  const root = document.createElementNS(NS, "g");
  const pendingRoot = document.createElementNS(NS, "g");
  stage.append(root, pendingRoot);
  document.body.append(stage);
  const layout = pulseLayout({
    stocks: frame.stocks,
    ribbons: ribbons === null ? null : ribbons.windows.all,
    events: [],
    windowLabel: "all time",
  });
  return {
    engine: new PulseMotionEngine({ root, pendingRoot, stage, layout, still }),
    root,
  };
}

const collapsed = (over: Partial<PulseCollapsedBlock>): PulseCollapsedBlock => ({
  edges: [],
  veils: [],
  hubs: 0,
  height: 100,
  ...over,
});

describe("the collapsed count marks", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it("merges three collapsed blocks at one pool into ONE mark carrying the sum", () => {
    const { engine, root } = build();
    // Three blocks a few hundred milliseconds apart — what ×600 produces, where a block goes by
    // roughly every 125 ms and a count mark lives for seconds.
    engine.spawnCollapsed(collapsed({ height: 100, veils: [{ pool: "ironwood", count: 3 }] }), 0);
    engine.spawnCollapsed(collapsed({ height: 101, veils: [{ pool: "ironwood", count: 4 }] }), 200);
    engine.spawnCollapsed(collapsed({ height: 102, veils: [{ pool: "ironwood", count: 5 }] }), 400);

    // one rect, not three stacked on the same point.
    expect(root.querySelectorAll(".pulse-veil")).toHaveLength(1);
    expect(root.querySelectorAll(".pulse-counter")).toHaveLength(1);
    expect(root.querySelector(".pulse-counter")?.textContent).toBe("×12");
    // And the title names what it now stands for, rather than the first block of the three.
    expect(root.querySelector("title")?.textContent).toBe(
      "12 inside ironwood · amounts private by design · blocks 100–102",
    );
  });

  it("keeps the rect 44×12 whatever the count — it is not a size", () => {
    const { engine, root } = build();
    for (let i = 0; i < 20; i += 1) {
      engine.spawnCollapsed(
        collapsed({ height: 100 + i, veils: [{ pool: "ironwood", count: 50 }] }),
        i * 50,
      );
    }
    const rect = root.querySelector(".pulse-veil")!;
    expect(rect.getAttribute("width")).toBe("44");
    expect(rect.getAttribute("height")).toBe("12");
  });

  it("keeps one mark per NODE, so two pools are two marks", () => {
    const { engine, root } = build();
    engine.spawnCollapsed(
      collapsed({
        height: 100,
        veils: [
          { pool: "ironwood", count: 2 },
          { pool: "orchard", count: 3 },
        ],
      }),
      0,
    );
    engine.spawnCollapsed(
      collapsed({
        height: 101,
        veils: [
          { pool: "ironwood", count: 1 },
          { pool: "orchard", count: 1 },
        ],
      }),
      100,
    );
    const counts = [...root.querySelectorAll(".pulse-counter")].map((n) => n.textContent);
    expect(counts.sort()).toEqual(["×3", "×4"]);
  });

  it("merges the hub's mark too, and never into a pool's", () => {
    const { engine, root } = build();
    engine.spawnCollapsed(
      collapsed({ height: 100, hubs: 2, veils: [{ pool: "sapling", count: 1 }] }),
      0,
    );
    engine.spawnCollapsed(collapsed({ height: 101, hubs: 5 }), 150);
    const titles = [...root.querySelectorAll("title")].map((n) => n.textContent);
    expect(titles).toContain("7 unsettled · direction not settled by the chain · blocks 100–101");
    // The pool's redaction mark is untouched: it means "encrypted on-chain" where the hub's
    // plain ink means "the direction is missing", and folding one into the other would state
    // the wrong caveat over a true number.
    expect(titles).toContain("1 inside sapling · amounts private by design · block 100");
  });

  it("prints ONE block where the merged range has not moved", () => {
    const { engine, root } = build();
    engine.spawnCollapsed(collapsed({ height: 100, veils: [{ pool: "ironwood", count: 1 }] }), 0);
    engine.spawnCollapsed(collapsed({ height: 100, veils: [{ pool: "ironwood", count: 1 }] }), 50);
    // `blocks 100–100` would state a span that is not there.
    expect(root.querySelector("title")?.textContent).toBe(
      "2 inside ironwood · amounts private by design · block 100",
    );
  });

  it("starts a fresh mark once the old one has expired, rather than counting into nothing", () => {
    const { engine, root } = build();
    engine.spawnCollapsed(collapsed({ height: 100, veils: [{ pool: "ironwood", count: 3 }] }), 0);
    // Well past the mark's life: `frame` removes it from the document.
    engine.frame(60_000);
    expect(root.querySelectorAll(".pulse-veil")).toHaveLength(0);

    engine.spawnCollapsed(
      collapsed({ height: 200, veils: [{ pool: "ironwood", count: 2 }] }),
      60_001,
    );
    expect(root.querySelector(".pulse-counter")?.textContent).toBe("×2");
    expect(root.querySelector("title")?.textContent).toBe(
      "2 inside ironwood · amounts private by design · block 200",
    );
  });

  it("clears the merge state with everything else, so a scrub does not resume a count", () => {
    const { engine, root } = build();
    engine.spawnCollapsed(collapsed({ height: 100, veils: [{ pool: "ironwood", count: 3 }] }), 0);
    engine.clearAll();
    engine.spawnCollapsed(collapsed({ height: 500, veils: [{ pool: "ironwood", count: 1 }] }), 10);
    expect(root.querySelectorAll(".pulse-veil")).toHaveLength(1);
    expect(root.querySelector(".pulse-counter")?.textContent).toBe("×1");
  });
});
