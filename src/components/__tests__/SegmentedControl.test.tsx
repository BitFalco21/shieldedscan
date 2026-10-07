import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RangeToggle } from "@/components/RangeToggle";
import { SegmentedControl } from "@/components/SegmentedControl";

const OPTIONS = [
  { value: "a", label: "ALPHA" },
  { value: "b", label: "BETA" },
] as const;

const ACTIVE =
  "microlabel cursor-pointer rounded-sm border px-2 py-0.5 transition-colors border-edge text-green";
const IDLE =
  "microlabel cursor-pointer rounded-sm border px-2 py-0.5 transition-colors border-edge-faint text-ink-faint hover:text-ink-dim";

describe("SegmentedControl", () => {
  it("renders a named group of buttons with the selection pressed", () => {
    render(<SegmentedControl options={OPTIONS} value="b" onChange={() => {}} ariaLabel="Pick" />);
    const group = screen.getByRole("group", { name: "Pick" });
    expect(group.className).toBe("flex flex-wrap gap-1.5");
    const alpha = screen.getByRole("button", { name: "ALPHA" });
    const beta = screen.getByRole("button", { name: "BETA" });
    expect(alpha.getAttribute("aria-pressed")).toBe("false");
    expect(beta.getAttribute("aria-pressed")).toBe("true");
    expect(alpha.className).toBe(IDLE);
    expect(beta.className).toBe(ACTIVE);
  });

  it("reports the chosen value", () => {
    const onChange = vi.fn();
    render(<SegmentedControl options={OPTIONS} value="b" onChange={onChange} ariaLabel="Pick" />);
    fireEvent.click(screen.getByRole("button", { name: "ALPHA" }));
    expect(onChange).toHaveBeenCalledWith("a");
  });

  it("renders a visible prefix inside the group and takes the group's classes", () => {
    render(
      <SegmentedControl
        options={OPTIONS}
        value="a"
        onChange={() => {}}
        ariaLabel="Sort order"
        prefix={<span>ORDER</span>}
        className="flex items-center"
      />,
    );
    const group = screen.getByRole("group", { name: "Sort order" });
    expect(group.className).toBe("flex items-center");
    expect(group.firstElementChild?.textContent).toBe("ORDER");
  });
});

describe("RangeToggle", () => {
  it("is the chart range control: every range, the current one pressed", () => {
    render(<RangeToggle value="90d" onChange={() => {}} />);
    const group = screen.getByRole("group", { name: "Chart time range" });
    const labels = Array.from(group.querySelectorAll("button")).map((b) => b.textContent);
    expect(labels).toEqual(["ALL", "1Y", "180D", "90D", "60D", "30D"]);
    expect(screen.getByRole("button", { name: "90D" }).className).toBe(ACTIVE);
    expect(screen.getByRole("button", { name: "ALL" }).className).toBe(IDLE);
  });
});
