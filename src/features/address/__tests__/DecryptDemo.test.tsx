import { act, fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CIPHER_GLYPHS, DECRYPT_VERDICT, DecryptDemo, scrambleText } from "../DecryptDemo";
import { ShieldedAddressPage } from "../ShieldedAddressPage";

const SAPLING = "zs1exampleshieldedsaplingaddressfixture0000000000000001";

function mockReducedMotion(matches: boolean) {
  window.matchMedia = vi.fn().mockReturnValue({
    matches,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }) as unknown as typeof window.matchMedia;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("the cipher set", () => {
  it("contains no digits — a scrambling VALUE can never flash a real amount", () => {
    expect(CIPHER_GLYPHS).not.toMatch(/\d/);
  });

  it("scrambleText preserves spaces and the uppercase ticker, and emits no digits", () => {
    const out = scrambleText("▓▓▓▓▓▓ ZEC");
    expect(out).toMatch(/ ZEC$/);
    expect(out).not.toMatch(/\d/);
    expect(out).toHaveLength("▓▓▓▓▓▓ ZEC".length);
  });
});

describe("DecryptDemo", () => {
  it("renders no button in server markup — a no-JS reader never sees a dead control", () => {
    const html = renderToStaticMarkup(<DecryptDemo />);
    expect(html).not.toContain("<button");
    // The live region is mounted while empty, so an announcement is not missed later.
    expect(html).toContain('role="status"');
  });

  it("under reduced motion the verdict appears without any scramble", () => {
    mockReducedMotion(true);
    render(<ShieldedAddressPage address={SAPLING} kind="sapling" />);
    const before = Array.from(document.querySelectorAll("[data-decrypt-bar]")).map(
      (b) => b.textContent,
    );
    fireEvent.click(screen.getByRole("button", { name: /try to decrypt/i }));
    expect(screen.getByRole("status").textContent).toBe(DECRYPT_VERDICT);
    const after = Array.from(document.querySelectorAll("[data-decrypt-bar]")).map(
      (b) => b.textContent,
    );
    expect(after).toEqual(before);
  });

  it("scrambles every bar without digits, then restores each one exactly", () => {
    mockReducedMotion(false);
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance"],
    });
    render(<ShieldedAddressPage address={SAPLING} kind="sapling" />);
    const bars = Array.from(document.querySelectorAll("[data-decrypt-bar]"));
    const originals = bars.map((b) => b.textContent);
    expect(bars.length).toBeGreaterThan(4);

    fireEvent.click(screen.getByRole("button", { name: /try to decrypt/i }));
    expect(screen.getByRole("status").textContent).toBe("decrypting…");

    // Mid-scramble: the first bar is churning ciphertext, never digits.
    act(() => vi.advanceTimersByTime(400));
    const mid = bars[0]?.textContent ?? "";
    expect(mid).not.toBe(originals[0]);
    expect(mid).not.toMatch(/\d/);

    // Past every stagger and the longest duration: all restored, verdict stated.
    // (3s clears the ~2.5s worst case without also running the verdict's own
    // 6s auto-clear, which the next step asserts separately.)
    act(() => vi.advanceTimersByTime(3_000));
    expect(bars.map((b) => b.textContent)).toEqual(originals);
    expect(screen.getByRole("status").textContent).toBe(DECRYPT_VERDICT);

    // The verdict clears itself rather than lingering forever.
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.getByRole("status").textContent).toBe("");
  });
});
