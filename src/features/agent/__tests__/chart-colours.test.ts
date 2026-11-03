import { describe, expect, it } from "vitest";
import {
  MAX_PLOT_SERIES,
  allSeriesSpecs,
  plottableSeries,
  sharedChartProblem,
  type PlottableSeries,
} from "@/domain";
import {
  CVD_FLOOR,
  CVD_TARGET,
  cvdDeltaE,
  deltaE,
  hexToRgb,
  MARK_CONTRAST,
  NORMAL_FLOOR,
} from "@/__tests__/palette-check";
import { readStylesheet } from "@/__tests__/read-stylesheet";
import { contrastRatio, oklchToSrgb, type Rgb255 } from "@/lib/oklch";
import { THEMES, deriveTokens, type Theme } from "@/lib/theme";
import { CHART_INKS, CLASH_INKS, NEAR_INKS, seriesDotted, seriesInks } from "../chart-inks";

/**
 * Every pair of lines Zeno can draw together, measured. `sharedChartProblem` decides which series
 * may share a chart, `seriesInks` their colours and `seriesDotted` their patterns; this checks each
 * pair the way the data-viz palette validator does, under every theme:
 *
 *  - normal vision: OKLab ΔE×100 ≥ 15, a hard floor a pattern does not excuse (one documented
 *    exception below);
 *  - red-green deficiency, the worse of protan and deutan: ≥ 8, or 6–8 only when one of the two
 *    lines is dotted;
 *  - each ink at 3:1 or better against the chart surface.
 */

const css = readStylesheet();
const root = css.match(/:root\s*\{([^}]*)\}/)?.[1] ?? "";
const themeBlock = (id: string) =>
  css.match(new RegExp(`:root\\[data-theme="${id}"\\]\\s*\\{([^}]*)\\}`))?.[1] ?? "";

const oklchLiteral = (block: string, name: string) => {
  const m = block.match(new RegExp(`--${name}:\\s*oklch\\(([0-9.]+) ([0-9.]+) ([0-9.]+)\\)`));
  return m ? oklchToSrgb({ l: Number(m[1]), c: Number(m[2]), h: Number(m[3]) }) : null;
};
const hexLiteral = (block: string, name: string) => {
  const m = block.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6});`));
  return m ? hexToRgb(m[1]!) : null;
};

/** The colour an ink class paints under a theme, read from the stylesheet the site ships. */
function paint(ink: string, theme: Theme): Rgb255 {
  if (ink === "text-green") return oklchToSrgb(deriveTokens(theme.hue).green);
  const token = ink.replace(/^text-/, "");
  const colour =
    oklchLiteral(themeBlock(theme.id), token) ??
    hexLiteral(themeBlock(theme.id), token) ??
    oklchLiteral(root, token) ??
    hexLiteral(root, token);
  if (colour === null) throw new Error(`no literal colour for ${ink}`);
  return colour;
}

const ALL = allSeriesSpecs().map(plottableSeries);

/**
 * Series that draw alike, for the sweep: the same axis, split, own ink and pool-ness give the same
 * colours whichever chain or venue is named. Up to three of each are kept, so a chart of three
 * chains sharing one flow colour is still among the sets tried.
 */
const REPRESENTATIVES = (() => {
  const classes = new Map<string, PlottableSeries[]>();
  for (const s of ALL) {
    const own = s.ink === undefined ? "none" : seriesInks([s])[0];
    const key = `${s.axis}|${s.split}|${own}|${s.ink !== undefined && "pool" in s.ink}`;
    const members = classes.get(key) ?? [];
    if (members.length < MAX_PLOT_SERIES) members.push(s);
    classes.set(key, members);
  }
  return [...classes.values()].flat();
})();

/**
 * Every set of 2..MAX_PLOT_SERIES series `make_chart` lets share a chart, in every order (the ink a
 * series gets depends on what came before it), kept once per distinct drawing: two charts with the
 * same inks and patterns read the same, whichever chains they name.
 */
function allowedCharts(): PlottableSeries[][] {
  const seen = new Map<string, PlottableSeries[]>();
  const grow = (chosen: PlottableSeries[]) => {
    if (chosen.length >= 2) {
      const signature = `${seriesInks(chosen).join(",")}|${seriesDotted(chosen).join(",")}`;
      if (!seen.has(signature)) seen.set(signature, chosen);
    }
    if (chosen.length === MAX_PLOT_SERIES) return;
    for (const next of REPRESENTATIVES) {
      if (chosen.includes(next)) continue;
      const set = [...chosen, next];
      if (sharedChartProblem(set) === null) grow(set);
    }
  };
  for (const first of REPRESENTATIVES) grow([first]);
  return [...seen.values()];
}

interface PairReading {
  a: string;
  b: string;
  inks: [string, string];
  theme: string;
  normal: number;
  cvd: number;
  /** One of the two lines is dotted, so they differ in pattern too. */
  patterned: boolean;
}

/** Computed once: the sweep over every ordered set is the slow part of this file. */
const ALLOWED = allowedCharts();

/** Each pair of lines on each allowed chart, under each theme. */
function pairReadings(): PairReading[] {
  const out: PairReading[] = [];
  for (const chart of ALLOWED) {
    const inks = seriesInks(chart);
    const dotted = seriesDotted(chart);
    for (let i = 0; i < chart.length; i++) {
      for (let j = i + 1; j < chart.length; j++) {
        for (const theme of THEMES) {
          const [ca, cb] = [paint(inks[i]!, theme), paint(inks[j]!, theme)];
          out.push({
            a: chart[i]!.key,
            b: chart[j]!.key,
            inks: [inks[i]!, inks[j]!],
            theme: theme.id,
            normal: deltaE(ca, cb),
            cvd: cvdDeltaE(ca, cb),
            patterned: dotted[i] !== dotted[j],
          });
        }
      }
    }
  }
  return out;
}

const describePair = (r: PairReading) =>
  `${r.a} (${r.inks[0]}) × ${r.b} (${r.inks[1]}) on ${r.theme}: normal ΔE ${r.normal.toFixed(1)}, CVD ΔE ${r.cvd.toFixed(1)}${r.patterned ? ", dotted apart" : ""}`;

const inkPair = (a: string, b: string) => [a, b].sort().join(" × ");

/**
 * The one pair under the normal-vision floor, kept because both inks are the site's: the ranked
 * lines under the amber theme, whose --line-2 (violet) sits ΔE ~11 from --line-3 (blue-grey). The
 * same pair draws /charts/transactions-by-kind, so the fix is a token change for the owner, not a
 * Zeno one; here the two lines are dotted apart meanwhile.
 */
const NORMAL_EXCEPTIONS = new Set([`${inkPair("text-line-2", "text-line-3")} on amber`]);

describe("Zeno's chart colours, over every combination make_chart allows", () => {
  const readings = pairReadings();

  it("refuses privacy kinds and pools on one chart, whose colours coincide", () => {
    const kinds = ALL.filter((s) => s.split === "kind");
    const pools = ALL.filter((s) => s.split === "pool");
    expect(sharedChartProblem([kinds[0]!, pools[0]!])).toMatch(/split the same transactions/);
  });

  it("keeps every pair apart under normal vision", () => {
    const weak = readings
      .filter((r) => r.normal < NORMAL_FLOOR)
      .filter((r) => !(NORMAL_EXCEPTIONS.has(`${inkPair(...r.inks)} on ${r.theme}`) && r.patterned))
      .map(describePair);
    expect(weak, weak.join("\n")).toEqual([]);
  });

  it("keeps every pair apart for a red-green colour-blind reader, dotting the near ones", () => {
    const weak = readings
      .filter((r) => r.cvd < CVD_FLOOR || (r.cvd < CVD_TARGET && !r.patterned))
      .map(describePair);
    expect(weak, weak.join("\n")).toEqual([]);
  });

  it("lists exactly the ink pairs that need a pattern on some theme, and no others", () => {
    const needed = new Set(
      readings
        .filter((r) => r.cvd < CVD_TARGET || r.normal < NORMAL_FLOOR)
        .map((r) => inkPair(...r.inks)),
    );
    const listed = new Set(NEAR_INKS.map(([a, b]) => inkPair(a, b)));
    expect(listed, [...needed].sort().join("\n")).toEqual(needed);
  });

  it("lists exactly the ink pairs too alike to share a chart at all", () => {
    const clashing = new Set<string>();
    for (const [i, a] of CHART_INKS.entries()) {
      for (const b of CHART_INKS.slice(i + 1)) {
        for (const theme of THEMES) {
          const [ca, cb] = [paint(a, theme), paint(b, theme)];
          const excused = NORMAL_EXCEPTIONS.has(`${inkPair(a, b)} on ${theme.id}`);
          if ((deltaE(ca, cb) < NORMAL_FLOOR && !excused) || cvdDeltaE(ca, cb) < CVD_FLOOR) {
            clashing.add(inkPair(a, b));
          }
        }
      }
    }
    const listed = new Set(CLASH_INKS.map(([a, b]) => inkPair(a, b)));
    expect(listed, [...clashing].sort().join("\n")).toEqual(clashing);
  });

  it("draws every ink at 3:1 or better against the chart surface", () => {
    const inks = new Set(ALLOWED.flatMap((c) => seriesInks(c)));
    for (const s of ALL) inks.add(seriesInks([s])[0]!);
    for (const theme of THEMES) {
      // The chart surface: the panel as painted without oklch() (#0a120a), and each theme's own.
      const surfaces = [hexToRgb("#0a120a"), oklchToSrgb(deriveTokens(theme.hue).panel)];
      for (const ink of inks) {
        for (const surface of surfaces) {
          expect(
            contrastRatio(paint(ink, theme), surface),
            `${ink} on ${theme.id}`,
          ).toBeGreaterThanOrEqual(MARK_CONTRAST);
        }
      }
    }
  });
});
