import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { useRovingTabs } from "../use-roving-tabs";

function Tabs({ labels }: { labels: string[] }) {
  const [active, setActive] = useState(0);
  const { tabRef, onKeyDown } = useRovingTabs(labels.length, active, setActive);
  return (
    <div role="tablist" onKeyDown={onKeyDown}>
      {labels.map((label, i) => (
        <button
          key={label}
          ref={tabRef(i)}
          type="button"
          role="tab"
          aria-selected={i === active}
          tabIndex={i === active ? 0 : -1}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

describe("useRovingTabs", () => {
  it("moves selection and focus with the arrow keys, wrapping at both ends", () => {
    render(<Tabs labels={["a", "b", "c"]} />);
    const tablist = screen.getByRole("tablist");
    const tab = (name: string) => screen.getByRole("tab", { name });

    fireEvent.keyDown(tablist, { key: "ArrowLeft" });
    expect(tab("c").getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tab("c"));

    fireEvent.keyDown(tablist, { key: "ArrowRight" });
    expect(tab("a").getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tab("a"));
  });

  it("ignores every other key", () => {
    render(<Tabs labels={["a", "b"]} />);
    fireEvent.keyDown(screen.getByRole("tablist"), { key: "Enter" });
    expect(screen.getByRole("tab", { name: "a" }).getAttribute("aria-selected")).toBe("true");
  });
});
