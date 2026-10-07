import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prefersReducedMotion, usePrefersReducedMotion } from "../use-reduced-motion";

/** A controllable `matchMedia` for the reduced-motion query. */
function stubMatchMedia(initial: boolean) {
  const listeners = new Set<() => void>();
  const query = {
    matches: initial,
    media: "(prefers-reduced-motion: reduce)",
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  };
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => query),
  );
  return {
    set(matches: boolean) {
      query.matches = matches;
      for (const fn of listeners) fn();
    },
    listeners,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("prefersReducedMotion", () => {
  it("reads the media query", () => {
    stubMatchMedia(true);
    expect(prefersReducedMotion()).toBe(true);
  });

  it("is false where matchMedia does not exist", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(prefersReducedMotion()).toBe(false);
  });
});

describe("usePrefersReducedMotion", () => {
  it("follows the setting while mounted and unsubscribes on unmount", () => {
    const media = stubMatchMedia(false);
    const { result, unmount } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(false);
    act(() => media.set(true));
    expect(result.current).toBe(true);
    unmount();
    expect(media.listeners.size).toBe(0);
  });
});
