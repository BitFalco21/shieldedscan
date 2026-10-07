import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HeroSearchBox } from "../HeroSearchBox";

/**
 * The dropdown's dismissal contract: Escape and an outside click both close it, so a mouse
 * user is never left with a panel over the stat cards.
 */

// A height, deliberately: its local row renders synchronously, while a 64-hex value waits on
// the resolver, which jsdom fails asynchronously.
const HEIGHT = "2481032";

function openDropdown() {
  render(
    <div>
      <HeroSearchBox />
      <button type="button">elsewhere on the page</button>
    </div>,
  );
  const input = screen.getByRole("searchbox", { name: /search the zcash chain/i });
  fireEvent.change(input, { target: { value: HEIGHT } });
  expect(screen.getByRole("listbox")).toBeDefined();
  return input;
}

describe("HeroSearchBox dropdown dismissal", () => {
  it("closes when the pointer goes down anywhere outside the box", () => {
    openDropdown();
    fireEvent.pointerDown(screen.getByRole("button", { name: /elsewhere/i }));
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("stays open when the pointer goes down inside it", () => {
    const input = openDropdown();
    fireEvent.pointerDown(input);
    expect(screen.getByRole("listbox")).toBeDefined();
  });

  it("reopens on typing after an outside-click dismissal, like after Escape", () => {
    const input = openDropdown();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.change(input, { target: { value: "3435077" } });
    // A different height on purpose: same-value changes don't re-render anything.
    expect(screen.getByRole("listbox")).toBeDefined();
  });

  it("still closes on Escape", () => {
    const input = openDropdown();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
