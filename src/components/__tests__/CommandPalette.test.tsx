import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CommandPalette } from "../CommandPalette";

// Mocking next/navigation is mocking a framework boundary, not our own code.
const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

function openWithCtrlK() {
  fireEvent.keyDown(document, { key: "k", ctrlKey: true });
}

function getSearchInput() {
  return screen.getByRole("searchbox", { name: "Search the Zcash chain" });
}

describe("CommandPalette", () => {
  it("is closed initially", () => {
    render(<CommandPalette />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens on Ctrl+K, preventing the default browser action, and focuses the input", () => {
    render(<CommandPalette />);
    // fireEvent returns false when the dispatched event's preventDefault() was called.
    const notPrevented = fireEvent.keyDown(document, { key: "k", ctrlKey: true, cancelable: true });

    expect(screen.getByRole("dialog")).toBeDefined();
    expect(notPrevented).toBe(false);
    expect(document.activeElement).toBe(getSearchInput());
  });

  it("shows the BLOCK HEIGHT hint for a numeric query", () => {
    render(<CommandPalette />);
    openWithCtrlK();
    fireEvent.change(getSearchInput(), { target: { value: "2481032" } });
    expect(screen.getByText("BLOCK HEIGHT")).toBeDefined();
  });

  it("shows NOT RECOGNISED for a query that matches no known shape", () => {
    render(<CommandPalette />);
    openWithCtrlK();
    fireEvent.change(getSearchInput(), { target: { value: "hello world" } });
    expect(screen.getByText("NOT RECOGNISED")).toBeDefined();
  });

  it("shows the SHIELDED ADDRESS hint for a zs1… string", () => {
    render(<CommandPalette />);
    openWithCtrlK();
    fireEvent.change(getSearchInput(), {
      target: { value: "zs1exampleshieldedsaplingaddressfixture0000000000000001" },
    });
    expect(screen.getByText("SHIELDED ADDRESS")).toBeDefined();
  });

  it("navigates to /search?q=… on Enter, reusing the search route's own resolution logic", () => {
    render(<CommandPalette />);
    openWithCtrlK();
    fireEvent.change(getSearchInput(), { target: { value: "2481032" } });
    fireEvent.keyDown(getSearchInput(), { key: "Enter" });
    expect(push).toHaveBeenCalledWith("/search?q=2481032");
  });

  it("closes on Escape and restores focus to the previously focused element", () => {
    render(
      <>
        <button>Open me</button>
        <CommandPalette />
      </>,
    );
    const trigger = screen.getByRole("button", { name: "Open me" });
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    openWithCtrlK();
    expect(screen.getByRole("dialog")).toBeDefined();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("promises not to store searches", () => {
    render(<CommandPalette />);
    openWithCtrlK();
    expect(
      screen.getByText("searches aren't stored — identifiers resolve against this site only"),
    ).toBeDefined();
  });
});
