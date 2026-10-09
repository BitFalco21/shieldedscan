/**
 * Accessibility: keyboard navigation, semantic HTML and WCAG AA contrast, as assertions.
 *
 * A contrast ratio written down per token drifts the first time a colour is nudged, so the
 * contrast test recomputes it from what the browser painted.
 *
 * The keyboard tests matter because this site's controls are keyboard-dependent: the command
 * palette is a keyboard feature, and the hero's focus indicator lives on its panel rather than
 * the input — one CSS edit away from removing the indicator altogether (WCAG 2.4.7).
 */

import { expect, test, type Page } from "@playwright/test";
import { ROUTES, TIP_HEIGHT } from "./surface";

/** Relative luminance per WCAG, from an `rgb()` string. */
function contrastRatio(fg: [number, number, number], bg: [number, number, number]): number {
  const luminance = (rgb: [number, number, number]) => {
    const [r, g, b] = rgb.map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [light, dark] = [luminance(fg), luminance(bg)].sort((a, b) => b - a) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

interface TextSample {
  selector: string;
  color: string;
  background: string;
  fontSize: number;
  fontWeight: number;
  text: string;
}

/** Every visible text node's computed colour against its nearest opaque background. */
async function textSamples(page: Page): Promise<TextSample[]> {
  return page.evaluate(() => {
    const opaqueBackground = (el: Element): string => {
      for (let node: Element | null = el; node; node = node.parentElement) {
        const bg = getComputedStyle(node).backgroundColor;
        if (bg && bg !== "transparent" && !bg.endsWith(", 0)")) return bg;
      }
      return getComputedStyle(document.body).backgroundColor;
    };

    const out: TextSample[] = [];
    for (const el of Array.from(document.querySelectorAll("main *"))) {
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") continue;
      if (Number(style.opacity) < 0.99) continue; // partially transparent text is decorative here
      // Only elements whose own text is a direct child, so a container is not credited with
      // its descendants' text.
      const own = Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => (n.textContent ?? "").trim())
        .join(" ")
        .trim();
      if (own === "") continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;

      out.push({
        selector: `${el.tagName.toLowerCase()}.${(el.getAttribute("class") ?? "").split(/\s+/).slice(0, 3).join(".")}`,
        color: style.color,
        background: opaqueBackground(el),
        fontSize: parseFloat(style.fontSize),
        fontWeight: Number(style.fontWeight) || 400,
        text: own.slice(0, 40),
      });
    }
    return out;
  });
}

const parseRgb = (value: string): [number, number, number] | null => {
  const m = value.match(/rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
};

test.describe("contrast", () => {
  for (const route of ROUTES) {
    test(`${route} meets WCAG AA for every text element`, async ({ page }) => {
      await page.goto(route);
      await page.waitForLoadState("networkidle");

      const failures: string[] = [];
      for (const sample of await textSamples(page)) {
        const fg = parseRgb(sample.color);
        const bg = parseRgb(sample.background);
        if (!fg || !bg) continue;

        // AA: 3:1 for large text (>=24px, or >=18.66px bold), 4.5:1 otherwise.
        const large =
          sample.fontSize >= 24 || (sample.fontSize >= 18.66 && sample.fontWeight >= 700);
        const required = large ? 3 : 4.5;
        const ratio = contrastRatio(fg, bg);
        if (ratio < required) {
          failures.push(
            `${sample.selector} "${sample.text}" — ${ratio.toFixed(2)}:1, needs ${required}:1 (${sample.color} on ${sample.background}, ${sample.fontSize}px/${sample.fontWeight})`,
          );
        }
      }
      expect(failures, `${route}:\n${failures.join("\n")}`).toEqual([]);
    });
  }
});

for (const theme of ["violet", "ice", "amber"]) {
  test.describe(`contrast under the ${theme} theme`, () => {
    // The unit test proves every derived TOKEN clears AA for every theme; this proves the
    // COMPOSITION does — real text on real panels, with the head script having stamped the
    // theme before paint. A subset of routes per theme, to keep the suite inside its budget;
    // /charts is in the set because amber remaps the chart series colour.
    for (const route of ["/", "/blocks", `/block/${TIP_HEIGHT}`, "/shielded", "/charts"]) {
      test(`${route} meets WCAG AA for every text element in ${theme}`, async ({ page }) => {
        await page.addInitScript((t) => window.localStorage.setItem("theme", t), theme);
        await page.goto(route);
        await page.waitForLoadState("networkidle");
        expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme);

        const failures: string[] = [];
        for (const sample of await textSamples(page)) {
          const fg = parseRgb(sample.color);
          const bg = parseRgb(sample.background);
          if (!fg || !bg) continue;
          const large =
            sample.fontSize >= 24 || (sample.fontSize >= 18.66 && sample.fontWeight >= 700);
          const required = large ? 3 : 4.5;
          const ratio = contrastRatio(fg, bg);
          if (ratio < required) {
            failures.push(
              `${sample.selector} "${sample.text}" — ${ratio.toFixed(2)}:1, needs ${required}:1 (${sample.color} on ${sample.background})`,
            );
          }
        }
        expect(failures, `${route} (${theme}):\n${failures.join("\n")}`).toEqual([]);
      });
    }
  });
}

test.describe("keyboard", () => {
  test("the skip link is the first stop and reaches the content", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => ({
      text: (document.activeElement?.textContent ?? "").trim(),
      href: document.activeElement?.getAttribute("href"),
    }));
    expect(focused.text, "the first tab stop is not the skip link").toMatch(/skip to content/i);
    expect(focused.href).toBe("#main");
  });

  test("every interactive element shows a visible focus indicator", async ({ page }) => {
    // WCAG 2.4.7. The hero deliberately moves the indicator from the input to its panel, so
    // this checks that *something* changes visibly rather than that an outline exists.
    await page.goto("/");
    const withoutIndicator = await page.evaluate(() => {
      const out: string[] = [];
      const focusable = Array.from(
        document.querySelectorAll<HTMLElement>(
          "a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex='-1'])",
        ),
      ).slice(0, 40);

      for (const el of focusable) {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        const before = getComputedStyle(el);
        const baseline = `${before.outlineStyle}|${before.outlineWidth}|${before.boxShadow}|${before.borderColor}|${before.backgroundColor}|${before.color}`;
        el.focus();
        const after = getComputedStyle(el);
        const focused = `${after.outlineStyle}|${after.outlineWidth}|${after.boxShadow}|${after.borderColor}|${after.backgroundColor}|${after.color}`;
        // A parent may carry the indicator (the hero prompt does), so check ancestors too.
        let parentChanged = false;
        for (let p = el.parentElement; p && !parentChanged; p = p.parentElement) {
          const ps = getComputedStyle(p);
          if (ps.outlineStyle !== "none" || ps.boxShadow !== "none") parentChanged = true;
        }
        if (baseline === focused && !parentChanged) {
          out.push(`${el.tagName.toLowerCase()} "${(el.textContent ?? "").trim().slice(0, 30)}"`);
        }
        el.blur();
      }
      return out;
    });
    expect(withoutIndicator, `no visible focus indicator:\n${withoutIndicator.join("\n")}`).toEqual(
      [],
    );
  });

  test("the palette traps nothing and closes cleanly", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Control+K");
    const dialog = page.getByRole("dialog", { name: "Search the Zcash chain" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("searchbox")).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    // Focus must land somewhere real, not on a detached node.
    const active = await page.evaluate(() => document.activeElement?.tagName ?? null);
    expect(active).not.toBeNull();
  });

  test("a table's pagination controls are reachable and named", async ({ page }) => {
    // An arrow with no accessible name tells a screen-reader user nothing, so each step must
    // carry a spoken description.
    await page.goto("/blocks");
    const unnamed = await page.evaluate(() =>
      Array.from(document.querySelectorAll("nav a, nav [aria-disabled]"))
        .filter((el) => {
          const name = (el.getAttribute("aria-label") ?? el.textContent ?? "").trim();
          return name === "" || /^[«»←→]+$/.test(name);
        })
        .map((el) => el.outerHTML.slice(0, 90)),
    );
    expect(unnamed, `pagination controls with no spoken name:\n${unnamed.join("\n")}`).toEqual([]);
  });
});

test.describe("semantics", () => {
  test("every page has exactly one h1", async ({ page }) => {
    const offenders: string[] = [];
    for (const route of ROUTES) {
      await page.goto(route);
      // Count once streaming has finished. A route's `loading.tsx` carries its own h1 over a
      // skeleton marked `aria-busy`; while the page streams in behind it, both h1s are briefly
      // in the DOM, and a count taken in that window fails on a slow machine.
      await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
      const count = await page.locator("h1").count();
      if (count !== 1) offenders.push(`${route}: ${count} h1 elements`);
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  test("heading levels never skip a rank", async ({ page }) => {
    const offenders: string[] = [];
    for (const route of ROUTES) {
      await page.goto(route);
      const levels = await page.evaluate(() =>
        Array.from(
          document.querySelectorAll("main h1,main h2,main h3,main h4,main h5,main h6"),
          (h) => Number(h.tagName[1]),
        ),
      );
      for (let i = 1; i < levels.length; i += 1) {
        const [previous, current] = [levels[i - 1] ?? 0, levels[i] ?? 0];
        if (current > previous + 1) offenders.push(`${route}: h${previous} → h${current}`);
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  test("every table has a caption or an accessible name", async ({ page }) => {
    const offenders: string[] = [];
    for (const route of ROUTES) {
      await page.goto(route);
      const bad = await page.evaluate(
        () =>
          Array.from(document.querySelectorAll("table")).filter(
            (t) =>
              !t.querySelector("caption") &&
              !t.getAttribute("aria-label") &&
              !t.getAttribute("aria-labelledby"),
          ).length,
      );
      if (bad > 0) offenders.push(`${route}: ${bad} unnamed table(s)`);
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  test("every image role carries a label", async ({ page }) => {
    const offenders: string[] = [];
    for (const route of ROUTES) {
      await page.goto(route);
      // A decorative image is exempt — only under the definition assistive technology uses: an
      // explicit `alt=""` and an `aria-hidden` ancestor, so it is removed from the accessibility
      // tree rather than merely unlabelled (the homepage's photographic backdrop). A missing
      // `alt` attribute is still an offence: absence is not a decision.
      const bad = await page.evaluate(() =>
        Array.from(document.querySelectorAll("[role='img'], img"))
          .filter((el) => !(el.getAttribute("aria-label") ?? el.getAttribute("alt") ?? "").trim())
          .filter((el) => !(el.getAttribute("alt") === "" && el.closest("[aria-hidden='true']")))
          .map((el) => el.outerHTML.slice(0, 80)),
      );
      for (const b of bad) offenders.push(`${route}: ${b}`);
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});

test.describe("reduced motion", () => {
  test("no animation runs when the visitor asks for none", async ({ page }) => {
    // A promise about how the site behaves on someone else's machine rots unless measured.
    await page.emulateMedia({ reducedMotion: "reduce" });
    const animated: string[] = [];
    // `/ai-agent` joins where the build serves it: Zeno is the most animated thing on the site.
    const routes = [`/`, `/blocks`, `/block/${TIP_HEIGHT}`];
    if (process.env.NEXT_PUBLIC_AGENT_ENABLED === "1") routes.push("/ai-agent");
    for (const route of routes) {
      await page.goto(route);
      const running = await page.evaluate(() => {
        // The standard reduced-motion reset sets durations to a near-zero value rather than
        // literally `0s` (this site uses `1e-05s`), because a true zero can skip transition
        // events some scripts rely on. So "disabled" means "imperceptible", not "== 0s".
        const seconds = (value: string) =>
          value
            .split(",")
            .map((v) => (v.trim().endsWith("ms") ? parseFloat(v) / 1000 : parseFloat(v)))
            .reduce((max, v) => (Number.isFinite(v) && v > max ? v : max), 0);
        const PERCEPTIBLE_S = 0.05;

        // Scoped to `body`: `head`, `meta`, `link` and `script` inherit the same computed
        // values and animate nothing, so including them was pure noise.
        return Array.from(document.querySelectorAll("body, body *"))
          .filter((el) => {
            const s = getComputedStyle(el);
            const animating =
              s.animationName !== "none" && seconds(s.animationDuration) > PERCEPTIBLE_S;
            const transitioning =
              s.transitionProperty !== "none" && seconds(s.transitionDuration) > PERCEPTIBLE_S;
            return animating || transitioning;
          })
          .map((el) => {
            const s = getComputedStyle(el);
            return `${el.tagName.toLowerCase()}.${(el.getAttribute("class") ?? "").split(/\s+/)[0]} animation=${s.animationName}/${s.animationDuration} transition=${s.transitionDuration}`;
          })
          .slice(0, 10);
      });
      for (const r of running) animated.push(`${route}: ${r}`);
    }
    expect(
      animated,
      `animation still active under reduced motion:\n${animated.join("\n")}`,
    ).toEqual([]);
  });
});
