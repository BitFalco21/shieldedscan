import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { LiveAnnouncer } from "../LiveAnnouncer";

/**
 * The live layer's only signal for a reader who cannot see rows move.
 *
 * New rows carry no visible marker — a row appearing already says it is new to a sighted
 * reader — so a screen-reader user needs this announcement instead.
 *
 * It reports a count rather than per-row text, because "arrived just now" on each of ten rows
 * is ten interruptions for one event.
 */

describe("LiveAnnouncer", () => {
  it("announces what arrived", () => {
    render(<LiveAnnouncer parts={[{ count: 3, noun: "block" }]} />);

    expect(screen.getByRole("status").textContent).toBe("3 new blocks");
  });

  it("uses the singular for one", () => {
    render(<LiveAnnouncer parts={[{ count: 1, noun: "transaction" }]} />);

    expect(screen.getByRole("status").textContent).toBe("1 new transaction");
  });

  it("combines several feeds into one announcement", () => {
    // Three separate live regions on the homepage would talk over each other for what a reader
    // experiences as a single event.
    render(
      <LiveAnnouncer
        parts={[
          { count: 2, noun: "block" },
          { count: 5, noun: "transaction" },
        ]}
      />,
    );

    expect(screen.getByRole("status").textContent).toBe("2 new blocks, 5 new transactions");
  });

  it("omits a feed that brought nothing", () => {
    render(
      <LiveAnnouncer
        parts={[
          { count: 0, noun: "block" },
          { count: 1, noun: "transfer" },
        ]}
      />,
    );

    expect(screen.getByRole("status").textContent).toBe("1 new transfer");
  });

  it("stays SILENT when nothing arrived", () => {
    render(<LiveAnnouncer parts={[{ count: 0, noun: "block" }]} />);

    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("keeps the region in the DOM while silent, or the change is never announced", () => {
    // A live region has to exist BEFORE its content changes; one that appears at the same
    // moment as its text is frequently not announced at all.
    render(<LiveAnnouncer parts={[{ count: 0, noun: "block" }]} />);

    expect(screen.getByRole("status").getAttribute("aria-live")).toBe("polite");
  });

  it("occupies no space, so it cannot reflow the list it describes", () => {
    // A visible chip would wrap hashes onto a second line and resize the panel on every
    // arrival.
    const { container } = render(<LiveAnnouncer parts={[{ count: 9, noun: "block" }]} />);

    expect(container.querySelector(".sr-only")).not.toBeNull();
  });
});
