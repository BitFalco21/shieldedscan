import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { THEME_BOOT_SCRIPT, THEME_STORAGE_KEY } from "../theme";

/**
 * The inline `<head>` script that stamps `data-theme` before first paint. It runs before
 * React, so it is tested as a string of JavaScript evaluated against a jsdom document.
 *
 * Wrapped in try/catch by contract: a browser that throws on `localStorage` renders green.
 */

function boot() {
  // The script is a string, so running it through Function is the honest test.
  new Function(THEME_BOOT_SCRIPT)();
}

beforeEach(() => {
  delete document.documentElement.dataset.theme;
  window.localStorage.clear();
});

afterEach(() => {
  delete document.documentElement.dataset.theme;
});

describe("THEME_BOOT_SCRIPT", () => {
  it("stamps a stored theme on <html> before React runs", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "violet");
    boot();
    expect(document.documentElement.dataset.theme).toBe("violet");
  });

  it("stamps nothing when nothing was chosen — the default deployment is byte-identical", () => {
    boot();
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it("ignores a value that is not a known theme, so a hand-edited key cannot inject an attribute", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'x" onload="alert(1)');
    boot();
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it("swallows a storage that throws", () => {
    const original = Object.getOwnPropertyDescriptor(window, "localStorage")!;
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("blocked", "SecurityError");
      },
    });
    try {
      expect(() => boot()).not.toThrow();
      expect(document.documentElement.dataset.theme).toBeUndefined();
    } finally {
      Object.defineProperty(window, "localStorage", original);
    }
  });

  it("is small enough to inline — a head script is paid on every page view", () => {
    expect(THEME_BOOT_SCRIPT.length).toBeLessThan(400);
  });
});
