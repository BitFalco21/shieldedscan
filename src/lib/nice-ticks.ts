/**
 * Round axis ticks, shared by every chart that draws a y axis.
 *
 * Ticks at fixed fractions of the data's maximum print figures nobody reads off a ruler
 * ("867.3K", "1.73M", "2.60M"). These step by 1, 2, 2.5 or 5 × 10^k, and the axis grows to the
 * next whole step past the data, so every gridline is a value a reader can say aloud and the
 * scale still runs from tick to tick.
 */

/** The step multiples, smallest first: each candidate is one of these times a power of ten. */
const MULTIPLES = [1, 2, 2.5, 5] as const;
/** At most this many intervals (six ticks): more gridlines than that compete with the data. */
const MAX_INTERVALS = 5;
/** A symmetric axis allows this many intervals each side of zero: five or seven ticks. */
const MAX_SIDE_INTERVALS = 3;
/**
 * A floor this close to zero, as a share of the top, is taken down to zero: a clipped axis then
 * saves almost nothing and loses the baseline every reader assumes.
 */
const ZERO_SNAP = 0.25;
/** Slack for floating error, so 0.3 / 0.1 counts as three steps rather than four. */
const EPS = 1e-9;

export interface NiceAxis {
  /** The axis floor: the lowest tick. */
  min: number;
  /** The axis ceiling: the highest tick, which the scale runs to. */
  max: number;
  step: number;
  ticks: number[];
}

export interface NiceAxisOptions {
  /** Mirror the axis about zero, for two directions drawn on one scale. */
  symmetric?: boolean;
  /**
   * The tick label. A step whose labels repeat or come out empty is passed over for a coarser
   * one: a formatter that rounds to whole coins would print "1 ZEC" twice, and a count axis that
   * blanks fractions would leave gridlines unlabelled.
   */
  label?: (value: number) => string;
}

/** `i × multiple × 10^exp`, computed so a decimal step lands on the nearest double (0.3, not 0.30000000000000004). */
function tickAt(i: number, multiple: number, exp: number): number {
  const v = exp >= 0 ? i * multiple * 10 ** exp : (i * multiple) / 10 ** -exp;
  return v === 0 ? 0 : v; // no -0 on an axis
}

/** The data range an axis must cover, after the zero rules. */
function coverage(lo: number, hi: number, symmetric: boolean): [number, number] {
  if (symmetric) {
    const reach = Math.max(Math.abs(lo), Math.abs(hi)) || 1;
    return [-reach, reach];
  }
  let [a, b] = lo <= hi ? [lo, hi] : [hi, lo];
  if (a > 0 && a <= b * ZERO_SNAP) a = 0;
  if (b < 0 && b >= a * ZERO_SNAP) b = 0;
  if (a === b) {
    // A flat series: a zero-based axis states it, a range around one value would invent a scale.
    if (a > 0) a = 0;
    else if (a < 0) b = 0;
    else b = 1;
  }
  return [a, b];
}

/**
 * The smallest round step that covers `[lo, hi]` in at most five intervals (each side of zero in
 * at most three, when symmetric), so four to six ticks, or five or seven mirrored. `lo` above zero
 * keeps a clipped axis unless it sits within a quarter of the top, where zero comes back.
 *
 * With `label`, a step whose labels blank or repeat is passed over, so a count of 0..1 draws two
 * ticks rather than "0.5 transactions". The check cannot see a formatter that rounds a step into a
 * different value ("$142.50" as "$143"); tick formatters print every round step exactly instead.
 */
export function niceAxis(lo: number, hi: number, options: NiceAxisOptions = {}): NiceAxis {
  const symmetric = options.symmetric === true;
  const [a, b] = coverage(Number.isFinite(lo) ? lo : 0, Number.isFinite(hi) ? hi : 0, symmetric);
  const span = b - a;
  let first: NiceAxis | null = null;
  // Start a decade below the finest step that could fit, and walk up through the candidates.
  const start = Math.floor(Math.log10(span / MAX_INTERVALS)) - 1;
  for (let exp = start; exp <= start + 12; exp += 1) {
    for (const multiple of MULTIPLES) {
      const step = tickAt(1, multiple, exp);
      const from = Math.floor(a / step + EPS);
      const to = Math.ceil(b / step - EPS);
      const fits = symmetric
        ? Math.max(-from, to) <= MAX_SIDE_INTERVALS
        : to - from <= MAX_INTERVALS;
      if (!fits) continue;
      const lowest = symmetric ? -Math.max(-from, to) : from;
      const highest = symmetric ? -lowest : to;
      const ticks: number[] = [];
      for (let i = lowest; i <= highest; i += 1) ticks.push(tickAt(i, multiple, exp));
      const axis = { min: ticks[0]!, max: ticks[ticks.length - 1]!, step, ticks };
      first ??= axis;
      if (options.label === undefined || readable(ticks, options.label)) return axis;
    }
  }
  // No step reads cleanly with this formatter: the tightest round axis, rather than none.
  return first!;
}

function readable(ticks: number[], label: (value: number) => string): boolean {
  const labels = ticks.map(label);
  return labels.every((l) => l.trim() !== "") && new Set(labels).size === labels.length;
}
