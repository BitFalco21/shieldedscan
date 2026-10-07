import { act, fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GENESIS_TARGET, deriveAttempt, type DrawAttempt } from "@/domain/bitcoin-keys";
import { NO_JS_SENTENCE, SlotCabinet } from "../SlotCabinet";
import { SatoshiPage } from "../SatoshiPage";

function mockReducedMotion(matches: boolean) {
  window.matchMedia = vi.fn().mockReturnValue({
    matches,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }) as unknown as typeof window.matchMedia;
}

const one = (() => {
  const key = new Uint8Array(32);
  key[31] = 1;
  return key;
})();

/** A real loss: the k=1 attempt every textbook prints. */
const LOSS: DrawAttempt = deriveAttempt(one);

/**
 * The win. Nobody holds a key that derives to the target, so the jackpot path is exercised
 * with an attempt whose address IS the target and whose other fields are the k=1 ones. The
 * component consults `jackpot` and `address` only, exactly as it would on a real hit.
 */
const WIN: DrawAttempt = { ...LOSS, address: GENESIS_TARGET.address, jackpot: true };

const ticketLabels = () =>
  Array.from(document.querySelectorAll("[data-ticket] dt"), (dt) => dt.textContent);

afterEach(() => {
  vi.useRealTimers();
});

describe("SlotCabinet, before hydration", () => {
  it("renders no button and says why — a no-JS reader never sees a dead control", () => {
    const html = renderToStaticMarkup(<SlotCabinet />);
    expect(html).not.toContain("<button");
    expect(html).toContain(NO_JS_SENTENCE);
    // The live region is mounted while empty, so the verdict is announced later.
    expect(html).toContain('role="status"');
    // The pull count starts at zero and the reels at rest: nothing is claimed before a pull.
    expect(html).toContain("000000");
    expect(html).not.toContain("data-ticket");
  });
});

describe("SlotCabinet, a pull", () => {
  it("prints a loss ticket with every proof field, from the injected attempt", () => {
    mockReducedMotion(true);
    render(<SlotCabinet draw={() => LOSS} />);
    fireEvent.click(screen.getByRole("button", { name: "pull" }));

    expect(screen.getAllByText(/NO MATCH/).length).toBeGreaterThan(0);
    expect(document.querySelector("[data-ticket-hex]")?.textContent).toBe(LOSS.privateKeyHex);
    expect(document.querySelector("[data-ticket-wif]")?.textContent).toContain(LOSS.wif);
    expect(document.querySelector("[data-ticket-address]")?.textContent).toBe(LOSS.address);
    expect(document.body.textContent).toContain(LOSS.publicKeyHex);
    expect(document.querySelector("[data-pulls]")?.textContent).toBe("000001");
    expect(ticketLabels()).toEqual([
      "drawn at",
      "private key · hex",
      "private key · WIF",
      "public key",
      "your address",
      "target",
    ]);
  });

  it("prints the JACKPOT through the same ticket, with the same fields, and names what it spends", () => {
    mockReducedMotion(true);
    render(<SlotCabinet draw={() => WIN} />);
    fireEvent.click(screen.getByRole("button", { name: "pull" }));

    expect(screen.getAllByText(/JACKPOT/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/NO MATCH/)).toBeNull();
    expect(document.querySelector("[data-ticket-address]")?.textContent).toBe(
      GENESIS_TARGET.address,
    );
    // Every reel agrees, and the ticket marks all 34 characters as hits.
    expect(document.querySelectorAll("[data-ticket-address] mark").length).toBe(34);
    expect(document.querySelectorAll(".slot-reel-hit").length).toBe(34);
    // The claim is scoped: the tributes are spendable, the coinbase never is.
    expect(document.body.textContent).toMatch(/coinbase stays unspendable/);
    expect(document.body.textContent).toMatch(/Import the WIF/);
    // Same rows as a loss — there is no separate payout view to trust.
    expect(ticketLabels()).toEqual([
      "drawn at",
      "private key · hex",
      "private key · WIF",
      "public key",
      "your address",
      "target",
    ]);
  });

  it("counts pulls and replaces the ticket on the next pull", () => {
    mockReducedMotion(true);
    let n = 0;
    render(<SlotCabinet draw={() => (n++ === 0 ? LOSS : WIN)} />);
    const button = screen.getByRole("button", { name: "pull" });
    fireEvent.click(button);
    expect(document.querySelector("[data-pulls]")?.textContent).toBe("000001");
    fireEvent.click(button);
    expect(document.querySelector("[data-pulls]")?.textContent).toBe("000002");
    expect(document.querySelectorAll("[data-ticket]").length).toBe(1);
    expect(document.querySelector("[data-ticket-address]")?.textContent).toBe(
      GENESIS_TARGET.address,
    );
  });

  it("with motion allowed, spins first and lands after the reels' stagger", () => {
    mockReducedMotion(false);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame"] });
    render(<SlotCabinet draw={() => LOSS} />);
    const button = screen.getByRole("button", { name: "pull" });
    fireEvent.click(button);

    const body = document.querySelector(".slot-body")!;
    expect(body.getAttribute("data-phase")).toBe("spinning");
    expect((button as HTMLButtonElement).disabled).toBe(true);
    // The ticket exists from the draw but has not printed: its fields are ready, its class is not.
    expect(document.querySelector("[data-ticket]")?.classList.contains("is-out")).toBe(false);
    // Nothing lights while the reels move: a hit shown mid-spin gives the result away.
    expect(document.querySelectorAll(".slot-reel-hit").length).toBe(0);
    expect(document.body.textContent).toContain("— of 34");
    // The bands arm on the next frame, not the same render, or the transition never runs.
    expect(body.classList.contains("is-spun")).toBe(false);
    act(() => {
      vi.advanceTimersByTime(20);
    });
    expect(body.classList.contains("is-spun")).toBe(true);

    act(() => {
      vi.advanceTimersByTime(900 + 33 * 45 + 200);
    });
    expect(body.getAttribute("data-phase")).toBe("landed");
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(document.querySelector("[data-ticket]")?.classList.contains("is-out")).toBe(true);
    // Hits light only once landed — position 1 is always one, so at least one is expected.
    expect(document.querySelectorAll(".slot-reel-hit").length).toBeGreaterThanOrEqual(1);
    expect(document.body.textContent).not.toContain("— of 34");
  });

  it("marks position 1 as a hit on every pull — the version byte — and never fabricates more", () => {
    mockReducedMotion(true);
    render(<SlotCabinet draw={() => LOSS} />);
    fireEvent.click(screen.getByRole("button", { name: "pull" }));
    const reels = Array.from(document.querySelectorAll(".slot-reel"));
    expect(reels.length).toBe(34);
    expect(reels[0]!.classList.contains("slot-reel-hit")).toBe(true);
    const hits = reels.filter((r) => r.classList.contains("slot-reel-hit")).length;
    const expected = Array.from(GENESIS_TARGET.address).filter(
      (ch, i) => LOSS.address[i] === ch,
    ).length;
    expect(hits).toBe(expected);
  });
});

describe("SatoshiPage", () => {
  it("has one h1, states the read date beside the balance, and wears the Veil once", () => {
    const html = renderToStaticMarkup(<SatoshiPage />);
    expect(html.match(/<h1/g)?.length).toBe(1);
    expect(html).toContain("57.43251519 BTC");
    expect(html).toContain("read 2026-09-02");
    expect(html).toContain("unspendable by consensus");
    // The Veil means encrypted-on-chain and nothing else: only the shielded BALANCE row wears it.
    expect(html.match(/value shielded — encrypted on-chain/g)?.length).toBe(1);
    // No dollar sign anywhere: this page prices nothing.
    expect(html).not.toMatch(/\$\s?\d/);
    // The lock is never claimed to be stronger.
    expect(html).not.toMatch(/harder to crack|stronger key|stronger lock/i);
  });
});
