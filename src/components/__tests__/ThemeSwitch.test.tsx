import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { THEMES, THEME_STORAGE_KEY } from "@/lib/theme";
import { ThemeSwitch } from "../ThemeSwitch";

/**
 * The theme menu in the nav, beside the network switch — the one control on the site that
 * writes to the visitor's browser.
 *
 * Pinned here: a summary carrying an icon and a spoken name that states the current theme; one
 * entry per theme with a muted dot (`.theme-swatch`, painted in that theme's accent whatever
 * the current theme) and the colour's name as visible text; `aria-pressed` on the current one;
 * exactly one key written; and it keeps working — and says why it could not save — when
 * storage throws.
 */

beforeEach(() => {
  delete document.documentElement.dataset.theme;
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const entry = (label: string) => screen.getByRole("button", { name: new RegExp(label, "i") });

describe("ThemeSwitch", () => {
  it("opens from an icon whose spoken name states the CURRENT theme", () => {
    document.documentElement.dataset.theme = "violet";
    render(<ThemeSwitch />);
    const summary = document.querySelector("summary")!;
    expect(summary.getAttribute("aria-label")).toMatch(/theme: violet/i);
    expect(summary.querySelector("svg")).not.toBeNull();
    // The icon is drawn, not typed: no text glyph a mono font might lack.
    expect(summary.textContent?.trim()).toBe("");
  });

  it("lists one entry per theme: a muted dot in THAT theme's accent plus the colour's name", () => {
    render(<ThemeSwitch />);
    expect(screen.getAllByRole("button")).toHaveLength(THEMES.length);
    for (const t of THEMES) {
      const b = entry(t.label);
      // Visible word, not only an aria-label.
      expect(b.textContent).toMatch(new RegExp(t.label, "i"));
      // The dot carries the theme id so CSS paints it in that theme's hue whatever the
      // current theme — an offer, not a mirror.
      const dot = b.querySelector<HTMLElement>(".theme-swatch");
      expect(dot).not.toBeNull();
      expect(dot!.dataset.theme).toBe(t.id);
    }
  });

  it("marks the default as current when nothing was chosen", () => {
    render(<ThemeSwitch />);
    const def = THEMES.find((t) => t.isDefault)!;
    expect(entry(def.label).getAttribute("aria-pressed")).toBe("true");
  });

  it("choosing violet stamps the root and writes exactly one key", () => {
    render(<ThemeSwitch />);
    fireEvent.click(entry("violet"));
    expect(document.documentElement.dataset.theme).toBe("violet");
    expect(window.localStorage.length).toBe(1);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("violet");
    expect(entry("violet").getAttribute("aria-pressed")).toBe("true");
  });

  it("choosing the default REMOVES the attribute and the key rather than storing 'green'", () => {
    document.documentElement.dataset.theme = "violet";
    window.localStorage.setItem(THEME_STORAGE_KEY, "violet");
    render(<ThemeSwitch />);
    const def = THEMES.find((t) => t.isDefault)!;
    fireEvent.click(entry(def.label));
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(window.localStorage.length).toBe(0);
  });

  it("reads a theme the head script already stamped, so the control agrees with the page", () => {
    document.documentElement.dataset.theme = "violet";
    render(<ThemeSwitch />);
    expect(entry("violet").getAttribute("aria-pressed")).toBe("true");
  });

  it("still switches the page when storage throws, and says the choice could not be saved", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    render(<ThemeSwitch />);
    fireEvent.click(entry("violet"));
    expect(document.documentElement.dataset.theme).toBe("violet");
    expect(screen.getByRole("status").textContent).toMatch(/could not save/i);
  });

  it("names the list for a screen reader", () => {
    render(<ThemeSwitch />);
    expect(screen.getByRole("list", { name: /choose theme/i })).toBeDefined();
  });
});
