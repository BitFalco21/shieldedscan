import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { restoreStoredTheme, THEME_BOOT_SCRIPT, THEME_STORAGE_KEY } from "../theme";

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

/**
 * A page the browser renders itself (after a server render answered 500) gets the boot script as
 * a React element, which never runs; `ThemeRestore` applies the same rule after mount.
 */
describe("restoreStoredTheme", () => {
  it("stamps the stored theme when nothing has", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "amber");
    restoreStoredTheme();
    expect(document.documentElement.dataset.theme).toBe("amber");
  });

  it("leaves a theme the boot script already stamped alone", () => {
    document.documentElement.dataset.theme = "ice";
    window.localStorage.setItem(THEME_STORAGE_KEY, "amber");
    restoreStoredTheme();
    expect(document.documentElement.dataset.theme).toBe("ice");
  });

  it("stamps nothing for an unknown value or the default", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'x" onload="alert(1)');
    restoreStoredTheme();
    expect(document.documentElement.dataset.theme).toBeUndefined();
    window.localStorage.setItem(THEME_STORAGE_KEY, "green");
    restoreStoredTheme();
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });
});
