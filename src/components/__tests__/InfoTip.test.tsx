import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FactGrid } from "../FactGrid";
import { InfoTip } from "../InfoTip";

/**
 * The `?` hint beside a field label.
 *
 * What is under test is the ACCESSIBILITY CONTRACT, not the styling. A tooltip that only
 * appears on mouse hover is invisible to a keyboard and to a screen reader, which is how
 * most "add a little ? icon" implementations end up decorative. So: a real button, a
 * spoken name, and `aria-describedby` tying the two together so the text is announced as a
 * description rather than as a second label.
 */
describe("InfoTip", () => {
  it("is a real button with a spoken name, not a bare glyph", () => {
    render(<InfoTip text="Paid to the miner." label="fee" />);
    const button = screen.getByRole("button", { name: /what is fee/i });
    expect(button).toBeDefined();
  });

  it("describes rather than relabels, so the field keeps its own name", () => {
    render(<InfoTip text="Paid to the miner." label="fee" />);
    const button = screen.getByRole("button", { name: /what is fee/i });
    const describedBy = button.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    const tip = document.getElementById(describedBy!);
    expect(tip?.textContent).toBe("Paid to the miner.");
    expect(tip?.getAttribute("role")).toBe("tooltip");
  });

  it("is present in the DOM rather than injected on hover", () => {
    // CSS reveals it; the text ships with the page. That is what makes it readable by a
    // screen reader and by anyone who cannot hover at all.
    render(<InfoTip text="Explained here." label="thing" />);
    expect(screen.getByRole("tooltip", { hidden: true }).textContent).toBe("Explained here.");
  });
});

describe("FactGrid hints", () => {
  it("shows a hint only where one was written", () => {
    // Deliberate: a `?` on every label is decoration, and decoration next to every field
    // teaches a reader to ignore all of them — including the one that mattered.
    render(
      <FactGrid
        facts={[
          { label: "EXPIRY HEIGHT", value: "#123", hint: "After this height it cannot be mined." },
          { label: "TIME", value: "now" },
        ]}
      />,
    );
    expect(screen.getAllByRole("button", { name: /what is/i })).toHaveLength(1);
    expect(screen.getByRole("button", { name: /what is expiry height/i })).toBeDefined();
  });
});
