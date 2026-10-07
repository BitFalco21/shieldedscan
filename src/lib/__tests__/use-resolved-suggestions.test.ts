// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useResolvedSuggestions } from "../use-resolved-suggestions";

/**
 * The resolution contract, whose subtle halves are both honesty rules:
 *
 *  - A 64-hex query shows nothing while the resolver is out: its type is a guess, and a
 *    guess that flips on answer reads as a glitch. The ambiguous /search row appears only as
 *    the final state, on a miss or an outage, so a resolver failure never empties the list.
 *  - `checking` must clear on a miss as well as a hit; a "checking…" that never ends
 *    advertises a lookup that is no longer running.
 */

const HASH = "ab".repeat(32);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/**
 * The route echoes the query it answered, and the hook requires the echo to match, so the
 * stub echoes it too. `echoAs` forces a mismatched echo, to exercise the shared-cache case.
 */
function stubResolver(found: unknown, echoAs?: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      const asked = new URL(url, "http://localhost").searchParams.get("q") ?? "";
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ q: echoAs ?? asked, found }),
      });
    }),
  );
}

describe("useResolvedSuggestions", () => {
  it("shows NOTHING for a hash while checking, then the confirmed row, no flip", async () => {
    stubResolver([{ href: `/tx/${HASH}`, label: "Transaction — on chain", detail: "x" }]);
    const { result } = renderHook(() => useResolvedSuggestions(HASH));

    expect(result.current.checking).toBe(true);
    expect(result.current.suggestions).toEqual([]);

    await waitFor(() => expect(result.current.checking).toBe(false), { timeout: 2000 });
    expect(result.current.suggestions[0]?.label).toBe("Transaction — on chain");
  });

  it("on a MISS, the ambiguous /search row appears as the final state", async () => {
    stubResolver([]);
    const { result } = renderHook(() => useResolvedSuggestions(HASH));

    expect(result.current.suggestions).toEqual([]);
    await waitFor(() => expect(result.current.checking).toBe(false), { timeout: 2000 });
    expect(result.current.suggestions[0]?.href).toBe(`/search?q=${HASH}`);
    expect(result.current.suggestions[0]?.label).toMatch(/transaction \/ block/i);
  });

  it("an outage can delay the row but never remove it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("down"))),
    );
    const { result } = renderHook(() => useResolvedSuggestions(HASH));
    await waitFor(() => expect(result.current.checking).toBe(false), { timeout: 2000 });
    expect(result.current.suggestions.length).toBeGreaterThan(0);
  });

  it("a HEIGHT keeps its instant local row while checking — its type is not a guess", async () => {
    stubResolver([]);
    const { result } = renderHook(() => useResolvedSuggestions("2481032"));
    expect(result.current.suggestions[0]?.href).toBe("/block/2481032");
    expect(result.current.checking).toBe(true);
    await waitFor(() => expect(result.current.checking).toBe(false), { timeout: 2000 });
    expect(result.current.suggestions[0]?.href).toBe("/block/2481032");
  });

  it("never checks for a query that produces no rows", () => {
    stubResolver([]);
    const { result } = renderHook(() => useResolvedSuggestions("hello world"));
    expect(result.current.checking).toBe(false);
    expect(result.current.suggestions).toEqual([]);
  });

  /**
   * The shared-cache case: if `/api/resolve`'s CDN cache key ever omits `q`, one visitor's
   * answer would be served for every query, as a confident "Block — on chain" row for an
   * identifier nobody typed. The key is fixed at the route (`Netlify-Vary: query=q`); this
   * asserts the second line of defence: an answer about a different question is discarded,
   * and the local shape row shows instead.
   */
  it("discards a resolved row whose echoed query is not the one asked about", async () => {
    stubResolver(
      [{ href: "/block/3428150", label: "Block — on chain", detail: "#3,428,150" }],
      "somebody-elses-query",
    );
    const { result } = renderHook(() => useResolvedSuggestions(HASH));

    await waitFor(() => expect(result.current.checking).toBe(false), { timeout: 2000 });
    // Never the other visitor's block.
    expect(result.current.suggestions.some((s) => s.href === "/block/3428150")).toBe(false);
    // Degrades to the designed miss state, exactly as a resolver outage does.
    expect(result.current.suggestions[0]?.href).toBe(`/search?q=${HASH}`);
  });

  it("a response with no echo at all is discarded too (pre-fix cache entries)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              found: [{ href: "/block/1", label: "Block — on chain", detail: "#1" }],
            }),
        }),
      ),
    );
    const { result } = renderHook(() => useResolvedSuggestions(HASH));
    await waitFor(() => expect(result.current.checking).toBe(false), { timeout: 2000 });
    expect(result.current.suggestions.some((s) => s.href === "/block/1")).toBe(false);
  });

  it("goes back to checking (and hides the hash rows again) when the value changes", async () => {
    stubResolver([]);
    const { result, rerender } = renderHook(({ v }) => useResolvedSuggestions(v), {
      initialProps: { v: HASH },
    });
    await waitFor(() => expect(result.current.checking).toBe(false), { timeout: 2000 });
    act(() => rerender({ v: "cd".repeat(32) }));
    expect(result.current.checking).toBe(true);
    expect(result.current.suggestions).toEqual([]);
  });

  it("a name shows NOTHING until a registration is confirmed, then the confirmed row", async () => {
    const row = { href: "/address/u1x?name=zenith", label: "Name — zenith.zcash", detail: "u1x" };
    stubResolver([row]);
    const { result } = renderHook(() => useResolvedSuggestions("zenith"));
    expect(result.current.suggestions).toEqual([]);
    await waitFor(() => expect(result.current.checking).toBe(false), { timeout: 2000 });
    expect(result.current.suggestions).toEqual([row]);
  });

  it("a name nobody registered stays EMPTY on a miss — no guessed destination", async () => {
    stubResolver([]);
    const { result } = renderHook(() => useResolvedSuggestions("hello"));
    await waitFor(() => expect(result.current.checking).toBe(false), { timeout: 2000 });
    expect(result.current.suggestions).toEqual([]);
  });
});
