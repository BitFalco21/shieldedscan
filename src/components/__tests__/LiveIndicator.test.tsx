import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { LiveIndicator } from "../LiveIndicator";

/**
 * The one control that says whether the page is still tracking the chain.
 *
 * Its job is to be honest about the three ways it stops. A live-looking indicator over a frozen
 * list — up, 200, and quietly no longer current — is the failure, so each stopped state names
 * itself and says what to do.
 */

describe("LiveIndicator", () => {
  it("renders NOTHING while everything is working", () => {
    // The rows arriving are themselves the signal that the page is live. The three states below
    // are the ones worth interrupting a reader for, and they all still speak.
    const { container } = render(<LiveIndicator status="live" />);

    expect(container.innerHTML).toBe("");
  });

  it("tells the reader to reload when it has stopped taking new rows", () => {
    render(<LiveIndicator status="capped" />);

    expect(screen.getByRole("status").textContent).toMatch(/reload/i);
  });

  it("names a reorg rather than merely going quiet", () => {
    render(<LiveIndicator status="reorganised" />);

    expect(screen.getByRole("status").textContent).toMatch(/reorganis/i);
  });

  it("says updates are unavailable rather than continuing to claim it is live", () => {
    render(<LiveIndicator status="unavailable" />);

    const status = screen.getByRole("status");
    expect(status.textContent).toMatch(/unavailable/i);
    expect(status.textContent?.trim()).not.toBe("live");
  });

  it("never spends the Veil's vocabulary on an outage of ours", () => {
    // Redaction bars mean "encrypted on-chain, hidden by design". Using them for our own
    // downtime would teach visitors that our outages are a privacy property of Zcash.
    const { container } = render(<LiveIndicator status="unavailable" />);

    expect(container.querySelector(".redact")).toBeNull();
    expect(container.querySelector(".veil")).toBeNull();
  });

  it("announces a change politely rather than interrupting", () => {
    render(<LiveIndicator status="unavailable" />);

    expect(screen.getByRole("status").getAttribute("aria-live")).toBe("polite");
  });

  it("carries every stopped state in text, not in colour or motion alone", () => {
    // `prefers-reduced-motion` disables every animation on this site, so nothing may be
    // conveyed by movement; and a reader who cannot distinguish the dot's colour must still
    // learn that the page stopped updating.
    for (const status of ["capped", "reorganised", "unavailable"] as const) {
      const { container } = render(<LiveIndicator status={status} />);
      expect(container.textContent?.trim().length).toBeGreaterThan(0);
    }
  });
});
