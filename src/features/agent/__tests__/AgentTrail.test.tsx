import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AgentTrail } from "../AgentTrail";
import {
  COMPUTING,
  MAX_WORKING_EXCERPT_CHARS,
  THINKING_AGAIN,
  THINKING_FIRST,
  WORKING,
  groupSteps,
  liveHeadline,
  workingExcerpt,
  type AgentStep,
} from "../trail-steps";

const step = (over: Partial<AgentStep> & Pick<AgentStep, "kind">): AgentStep => ({
  label: over.kind,
  startedAt: 1_000,
  endedAt: 2_000,
  ...over,
});

const lookup = (label: string, detail?: string, over: Partial<AgentStep> = {}) =>
  step({ kind: "lookup", label, ...(detail ? { detail } : {}), ...over });
const narration = (text: string) => step({ kind: "narration", label: text });

/** Every rendered step icon, as its raw path geometry. */
function iconPaths(container: HTMLElement): string[] {
  return [...container.querySelectorAll("li svg")].map((svg) =>
    [...svg.querySelectorAll("path, circle")]
      .map((el) => el.getAttribute("d") ?? `circle:${el.getAttribute("cx")}`)
      .join("|"),
  );
}

/**
 * One row per thought, a header that follows the loop's phases, and a live line showing the
 * working as it arrives — never the same thing said several times.
 */
describe("what the trail draws", () => {
  it("draws concrete steps and narration as rows, never the loop's own waits", () => {
    const { container } = render(
      <AgentTrail
        live={false}
        steps={[
          step({ kind: "thinking", label: THINKING_FIRST }),
          narration("Fetching that block first."),
          lookup("looking up the block", "3428150"),
          step({ kind: "thinking", label: THINKING_AGAIN }),
          step({ kind: "answering", label: WORKING }),
        ]}
      />,
    );
    // one row: the sentence and the lookup it preceded.
    expect(container.querySelectorAll("li")).toHaveLength(1);
    expect(screen.queryByText("Fetching that block first.")).not.toBeNull();
    expect(screen.queryByText(THINKING_AGAIN)).toBeNull();
    expect(screen.queryByText(WORKING)).toBeNull();
    expect(screen.queryByText(THINKING_FIRST)).toBeNull();
  });

  it("a narration leading its lookup drops the 'looking up' label and keeps the arguments", () => {
    const { container } = render(
      <AgentTrail
        live={false}
        steps={[narration("Fetching the block."), lookup("looking up the block", "3428150")]}
      />,
    );
    const row = container.querySelector("li")!;
    expect(row.getAttribute("data-row")).toBe("grouped");
    expect(row.textContent).toContain("Fetching the block.");
    expect(row.textContent).toContain("3428150");
    expect(row.textContent).not.toContain("looking up");
    // The step line still carries its duration and its icon.
    expect(row.textContent).toMatch(/1\.0s/);
    expect(row.querySelector("svg")).not.toBeNull();
  });

  it("a lookup with no sentence before it keeps its label", () => {
    const { container } = render(
      <AgentTrail live={false} steps={[lookup("looking up the block", "3428150")]} />,
    );
    const row = container.querySelector("li")!;
    expect(row.getAttribute("data-row")).toBe("single");
    expect(row.textContent).toContain("looking up the block");
    expect(row.textContent).toContain("3428150");
  });

  it("a calculation keeps its label even under a sentence — an expression alone says nothing", () => {
    const { container } = render(
      <AgentTrail live={false} steps={[narration("Dividing."), lookup(COMPUTING, "12 / 4")]} />,
    );
    expect(container.querySelector("li")!.textContent).toContain(COMPUTING);
  });

  it("never draws the tool's name", () => {
    const { container } = render(
      <AgentTrail
        live={false}
        steps={[
          narration("Fetching the block."),
          lookup("looking up the block", "3428150", { tool: "lookup_block" }),
          lookup("looking up the halving", undefined, { tool: "chain_status" }),
        ]}
      />,
    );
    expect(container.textContent).not.toContain("lookup_block");
    expect(container.textContent).not.toContain("chain_status");
  });

  it("renders narration as plain text with no icon and no duration", () => {
    const { container } = render(
      <AgentTrail
        live={false}
        steps={[
          // A hostile-shaped label: already sanitised server-side, and the row must still be a
          // TEXT node — no anchor, no image, no markup — as the second, structural stop.
          narration("See [evil](https://evil.example) for ![x](y)"),
        ]}
      />,
    );
    const row = container.querySelector("li")!;
    expect(row.textContent).toBe("See [evil](https://evil.example) for ![x](y)");
    expect(row.querySelector("a, img, svg")).toBeNull();
  });

  it("has no derived summary sentence — the rows are the summary", () => {
    const { container } = render(
      <AgentTrail live={false} steps={[lookup("looking up the block", "3428150")]} />,
    );
    expect(container.querySelector("[data-trail-summary]")).toBeNull();
    expect(container.textContent).not.toContain("looked up");
    expect(container.querySelector("summary")!.textContent).toMatch(/^worked for 1\.0s\s*›$/);
  });

  it("while live, the running action is the header and finished steps are the rows", () => {
    const { container } = render(
      <AgentTrail
        live
        steps={[
          step({ kind: "thinking" }),
          lookup("looking up the block", "3428150"),
          lookup("looking up the halving", undefined, { endedAt: null }),
        ]}
      />,
    );
    expect(container.querySelector("[data-trail-headline]")?.textContent).toBe(
      "looking up the halving",
    );
    // The running step is not also a row: the header is the one place it appears.
    expect(container.querySelectorAll("li")).toHaveLength(1);
    expect(container.querySelector("li")?.textContent).toContain("3428150");
  });

  it("marks a read and a calculation with different silhouettes", () => {
    const { container } = render(
      <AgentTrail
        live={false}
        steps={[lookup("looking up the block", "3428150"), lookup(COMPUTING, "12 / 4")]}
      />,
    );
    const paths = iconPaths(container);
    expect(paths).toHaveLength(2);
    expect(new Set(paths).size, "a read and a calculation share one silhouette").toBe(2);
  });
});

describe("grouping", () => {
  it("pairs a narration with the lookup immediately after it, and nothing else", () => {
    const groups = groupSteps([
      narration("a"),
      lookup("looking up the block", "1"),
      lookup("looking up the block", "2"),
      narration("b"),
      narration("c"),
      lookup(COMPUTING, "1 + 1"),
      narration("d"),
    ]);
    expect(groups.map((g) => `${g.narration?.label ?? "-"}/${g.step?.detail ?? "-"}`)).toEqual([
      "a/1",
      "-/2",
      "b/-",
      "c/1 + 1",
      "d/-",
    ]);
  });
});

describe("the live header", () => {
  it("names the phase the loop is in, from facts the console recorded", () => {
    expect(liveHeadline([])).toBe(THINKING_FIRST);
    expect(liveHeadline([step({ kind: "thinking", label: THINKING_FIRST, endedAt: null })])).toBe(
      THINKING_FIRST,
    );
    expect(liveHeadline([step({ kind: "thinking", label: THINKING_AGAIN, endedAt: null })])).toBe(
      THINKING_AGAIN,
    );
    expect(liveHeadline([step({ kind: "answering", endedAt: null })])).toBe(WORKING);
    expect(liveHeadline([lookup("looking up the block", "3428150", { endedAt: null })])).toBe(
      "looking up the block · 3428150",
    );
  });

  it("never claims the round is the answer — that is only known when it ends", () => {
    for (const phrase of [THINKING_FIRST, THINKING_AGAIN, WORKING]) {
      expect(phrase).not.toMatch(/answer/i);
      // The line this trail does not cross: every phrase describes our loop, never a finding.
      expect(phrase).not.toMatch(/because|so that|therefore|conclude|decided|realis|seems/i);
    }
  });
});

describe("the live working line", () => {
  it("is the first sentence of the round's prose, on one line", () => {
    expect(workingExcerpt("I'll look up the block.\n\nThen the halving. And more.")).toBe(
      "I'll look up the block.",
    );
    expect(workingExcerpt("Still typing without a sentence end")).toBe(
      "Still typing without a sentence end",
    );
    // A decimal point is not a sentence end.
    expect(workingExcerpt("About 1.5 million ZEC moved")).toBe("About 1.5 million ZEC moved");
    expect(workingExcerpt("  a b\t c ")).toBe("a b c");
    expect(workingExcerpt("")).toBe("");
  });

  it("is capped, however long the round runs", () => {
    const long = "x".repeat(10_000);
    const out = workingExcerpt(long);
    expect(out.length).toBeLessThanOrEqual(MAX_WORKING_EXCERPT_CHARS);
    expect(out.endsWith("…")).toBe(true);
  });

  it("ROLLS with prose the server flagged as working, starting at a sentence", () => {
    const working =
      "Let me check the per-pool counts for that day. The window is one UTC day, so a single call covers it. " +
      "I also need the kind breakdown to say what the total excludes, which means a second lookup.";
    const out = workingExcerpt("", working);
    expect(out.length).toBeLessThanOrEqual(MAX_WORKING_EXCERPT_CHARS + 1);
    expect(out.startsWith("…")).toBe(true);
    // Ends with the newest text — this is what keeps the line moving while the model writes.
    expect(out.endsWith("which means a second lookup.")).toBe(true);
    // Starts at a sentence, never mid-word.
    expect(out).toMatch(/^…[A-Z]/);
    // The candidate-answer prefix (deltas before the gate flipped) is part of the same round.
    expect(workingExcerpt("Let me", " check the counts.")).toBe("Let me check the counts.");
    // Short working is shown whole, no ellipsis.
    expect(workingExcerpt("", "Fetching the block.")).toBe("Fetching the block.");
  });

  it("is drawn while live, as a text node, and never once the turn settles", () => {
    const steps = [step({ kind: "answering", endedAt: null })];
    const { container, rerender } = render(
      <AgentTrail live steps={steps} prose="Block 3,428,150 carried 2 transactions. More" />,
    );
    const line = container.querySelector('[data-step="working"]')!;
    expect(line.textContent).toBe("Block 3,428,150 carried 2 transactions.");
    expect(line.querySelector("a, img")).toBeNull();
    // Cleared prose (a `reset`) removes the line; a settled turn never shows it.
    rerender(<AgentTrail live steps={steps} prose="" />);
    expect(container.querySelector('[data-step="working"]')).toBeNull();
    rerender(<AgentTrail live={false} steps={steps} prose="Leftover" working="Leftover" />);
    expect(container.querySelector('[data-step="working"]')).toBeNull();
  });
});
