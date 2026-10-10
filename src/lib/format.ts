import { ZATS_PER_ZEC } from "@/domain/transaction";
import { coinTicker } from "./network";
import { DAY_SECONDS, utcDayFromSeconds } from "@/domain/time";

export function formatZec(zat: number): string {
  return `${formatZecAmount(zat)} ${coinTicker}`;
}

/**
 * The number alone, no ticker, at full precision. Eight decimals because a zatoshi is 1e-8 ZEC:
 * rounding a ledger amount would discard zatoshis and stop matching the chain.
 * `minimumFractionDigits: 2` keeps round amounts short, so digits appear only where they exist.
 */
export function formatZecAmount(zat: number): string {
  const zec = zat / ZATS_PER_ZEC;
  return zec.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 8 });
}

/**
 * A zatoshi amount as an approximate US dollar figure at the given spot price — "≈ $12.34".
 * Sub-cent values print "<$0.01" rather than a flat $0.00, which would read as free.
 */
export function formatZatUsd(zat: number, priceUsd: number): string {
  const usd = (zat / ZATS_PER_ZEC) * priceUsd;
  if (usd > 0 && usd < 0.01) return "≈ <$0.01";
  return `≈ ${formatUsd(usd)}`;
}

/**
 * The same conversion, abbreviated, for a column of dollar figures (e.g. the rich list), where
 * magnitude is what a reader compares and the exact form would set a column too wide for a
 * phone. No sub-cent refusal here: a balance worth a fraction of a cent genuinely rounds to $0.00.
 */
export function formatZatUsdCompact(zat: number, priceUsd: number): string {
  return formatUsdCompact((zat / ZATS_PER_ZEC) * priceUsd);
}

/**
 * A share of a whole at one-decimal grain that never rounds a real share down to "0.0%".
 *
 * A non-zero value smaller than the display grain prints "<0.1%" (or ">-0.1%"; a tiny outflow
 * is still a direction), so a label never contradicts a visible amount beside it. An exact zero
 * still prints "0.0%": it is a measurement, not a rounding artefact. Callers pair the result
 * with a stated denominator.
 */
export function formatSharePct(pct: number, decimals = 1): string {
  // The grain follows the precision: at 1 decimal anything under 0.05 rounds to "0.0%", at 2
  // anything under 0.005 rounds to "0.00%".
  const grain = 0.5 * 10 ** -decimals;
  const floor = (0.1 ** decimals).toFixed(decimals);
  if (pct !== 0 && Math.abs(pct) < grain) return pct > 0 ? `<${floor}%` : `>-${floor}%`;
  return `${pct.toFixed(decimals)}%`;
}

/**
 * The magnitude of a period-over-period change, for a caller that draws its own ▲/▼.
 *
 * Unlike a share, a change can exceed 100% by a lot, so above 100% it rounds to whole percent.
 * Below the display grain it prints "<0.1%" rather than a flat "0.0%" beside an arrow; an exact
 * zero is "0.0%" and callers render it without an arrow. The sign is dropped because the arrow
 * carries it ("▼ -12.4%" reads as a double negative).
 */
export function formatDeltaPct(pct: number): string {
  const magnitude = Math.abs(pct);
  if (pct !== 0 && magnitude < 0.05) return "<0.1%";
  if (magnitude >= 100) return `${formatCount(Math.round(magnitude))}%`;
  return `${magnitude.toFixed(1)}%`;
}

/**
 * A date spelled out: "27 November 2028", shown beside the ISO form rather than instead of it.
 * `timeZone: "UTC"` is required: otherwise a prerendered page's date depends on the build
 * machine's time zone.
 */
export function formatDateLong(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleDateString("en-GB", {
    timeZone: "UTC",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/**
 * A long duration at a human grain: "2 years, 107 days", "3 days, 4 hours".
 *
 * Stops at two units because it formats estimates whose error is measured in days; more units
 * would claim precision the input lacks. Years are 365.25 days.
 */
export function formatDurationCoarse(seconds: number): string {
  const units: [name: string, size: number][] = [
    ["year", 365.25 * DAY_SECONDS],
    ["day", DAY_SECONDS],
    ["hour", 3_600],
    ["minute", 60],
  ];
  let rest = Math.max(0, Math.floor(seconds));
  const out: string[] = [];
  for (const [name, size] of units) {
    const value = Math.floor(rest / size);
    if (value === 0 && out.length === 0) continue;
    rest -= value * size;
    out.push(`${formatCount(value)} ${name}${value === 1 ? "" : "s"}`);
    if (out.length === 2) break;
  }
  return out.length === 0 ? "under a minute" : out.join(", ");
}

/**
 * A ratio between two market caps: "156.07x", "1.02x".
 *
 * Just above 1 it prints ">1.00x" rather than "1.00x", which would claim two assets are the
 * same size. Two decimals throughout, even above 1,000x, because the multiple scales a price.
 */
export function formatMultiple(multiple: number): string {
  if (multiple > 1 && multiple < 1.005) return ">1.00x";
  return `${multiple.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}x`;
}

/**
 * A supply-scale ZEC figure: whole coins, thousands-separated. The eight-decimal rule is for
 * transaction amounts; a pool balance at full precision is unreadable. Callers put the exact
 * value in a `title`.
 */
export function formatZecWhole(zat: number): string {
  return `${formatCount(Math.round(zat / ZATS_PER_ZEC))} ${coinTicker}`;
}

/**
 * An address's balance: whole coins at or above 1 ZEC, up to eight decimals below it (trailing
 * zeros trimmed), so a sub-ZEC holding never renders as "0 ZEC".
 */
export function formatZecBalance(zat: number): string {
  if (Math.abs(zat) >= ZATS_PER_ZEC) return formatZecWhole(zat);
  const zec = (zat / ZATS_PER_ZEC).toFixed(8).replace(/0+$/, "").replace(/\.$/, "");
  return `${zec} ${coinTicker}`;
}

/**
 * An aggregate ZEC volume at two decimals, for sums over many transfers (e.g. the cross-chain
 * flow tables), where eight decimals is false precision. Callers put the exact amount in a
 * `title`.
 */
export function formatZecTwo(zat: number): string {
  const zec = zat / ZATS_PER_ZEC;
  return `${zec.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${coinTicker}`;
}

/** The M/K tiers both compact forms share; null below them, where each has its own rule. */
function zecCompactTier(zat: number): string | null {
  const zec = zat / ZATS_PER_ZEC;
  if (zec >= 1_000_000) return `${(zec / 1_000_000).toFixed(2)}M`;
  if (zec >= 10_000) return `${(zec / 1_000).toFixed(1)}K`;
  return null;
}

/**
 * A ZEC axis tick: compact, and only as precise as a reference line needs. A tick sits at a
 * fraction of the axis maximum, so full eight-decimal precision there is noise ("1,021.34378535").
 * Never for an amount a reader is told: that is `formatZec` or `formatZecCompact`.
 */
export function formatZecTick(zat: number): string {
  const tier = zecCompactTier(zat);
  if (tier !== null) return `${tier} ${coinTicker}`;
  const zec = zat / ZATS_PER_ZEC;
  if (zec === 0) return `0 ${coinTicker}`;
  const digits: Intl.NumberFormatOptions =
    zec >= 100
      ? { maximumFractionDigits: 0 }
      : zec >= 1
        ? { maximumFractionDigits: 2 }
        : { maximumSignificantDigits: 2 };
  return `${zec.toLocaleString("en-US", digits)} ${coinTicker}`;
}

export function formatZecCompact(zat: number): string {
  const tier = zecCompactTier(zat);
  return tier === null ? formatZec(zat) : `${tier} ${coinTicker}`;
}

/**
 * A summed volume, compact and without the ticker, for a column whose header names the unit.
 * Below the K tier it uses two decimals (the rule for sums), never eight. Callers put the exact
 * amount in a `title`.
 */
export function formatZecVolumeCompact(zat: number): string {
  return (
    zecCompactTier(zat) ??
    (zat / ZATS_PER_ZEC).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

export function shortHash(hash: string, edge = 4): string {
  return `${hash.slice(0, edge)}…${hash.slice(-edge)}`;
}

export function timeAgo(timestamp: number, now: number): string {
  const s = Math.max(0, now - timestamp);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Grouped digits, a fixed number of decimals. */
function groupedFixed(value: number, decimals: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * A byte count: `N B` below 1,024, kB to one decimal, MB (and GB) to two, digits grouped.
 * The unit steps where the figure would reach 1,024 after rounding, so a size just under the
 * boundary never prints as "1,024.0 kB".
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["kB", "MB", "GB"] as const;
  let value = bytes / 1024;
  let unit = 0;
  for (;;) {
    const decimals = unit === 0 ? 1 : 2;
    const rounded = Number(value.toFixed(decimals));
    if (rounded < 1024 || unit === units.length - 1) {
      return `${groupedFixed(value, decimals)} ${units[unit]}`;
    }
    value /= 1024;
    unit += 1;
  }
}

export function formatUtc(timestamp: number): string {
  return `${new Date(timestamp * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/**
 * USD with cents always kept, for stating a recorded figure verbatim, such as a venue's
 * swap-time value. `formatUsd` drops cents at >= $100, which is fine for derived conveniences
 * but makes a stored fact look like it disagrees with its source.
 */
export function formatUsdExact(value: number): string {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * USD for derived figures: whole dollars at or above $100, where cents are noise in a column;
 * cents below that, where they are the difference between "$0.30" and nothing.
 */
export function formatUsd(value: number): string {
  const fractionDigits = Math.abs(value) >= 100 ? 0 : 2;
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

/**
 * A supply-scale zatoshi amount as an approximate dollar figure — "≈ $33.01M".
 *
 * Written for the agent, which quotes formatted figures verbatim: the qualifier lives inside the
 * string so a paraphrase cannot drop it. The rich list uses the bare `formatZatUsdCompact`; both
 * share one implementation of the conversion.
 */
export function formatZatUsdApprox(zat: number, priceUsd: number): string {
  return `≈ ${formatZatUsdCompact(zat, priceUsd)}`;
}

/**
 * USD at market-cap scale: "$8.02B", "$412.6M", "$1.29T". Digits past three significant figures
 * would assert precision a moving price does not have; callers put the exact value in a `title`.
 */
export function formatUsdCompact(value: number): string {
  const abs = Math.abs(value);
  const [divisor, suffix] =
    abs >= 1_000_000_000_000
      ? [1_000_000_000_000, "T"]
      : abs >= 1_000_000_000
        ? [1_000_000_000, "B"]
        : abs >= 1_000_000
          ? [1_000_000, "M"]
          : [1_000, "K"];
  if (abs < 1_000) return formatUsd(value);
  const scaled = value / divisor;
  return `$${scaled.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}${suffix}`;
}

/**
 * A fee's dollar value at its own date, from the daily-close map.
 *
 * Today's close does not exist yet, so rows from today fall back to the current price. Any
 * other missing day returns null and the caller renders nothing, never a spot price presented
 * as a historical one.
 */
export function feeUsdAtDay(
  zat: number,
  timestamp: number,
  dailyUsd: Record<string, number>,
  currentUsd: number | null,
  nowSeconds: number,
): string | null {
  const day = utcDayFromSeconds(timestamp);
  const today = utcDayFromSeconds(nowSeconds);
  const price = dailyUsd[day] ?? (day === today ? currentUsd : null);
  if (price === null || price === undefined) return null;
  return formatZatUsd(zat, price);
}

/**
 * The slice of the daily-close map a list page needs: the rows' own days plus the few days
 * before today a live row can still belong to (a block mined just before midnight UTC lands
 * after it). Keeps the full multi-year map out of each dynamic render's payload;
 * `feeUsdAtDay` answers identically through either map.
 */
export function dailyUsdForRows(
  dailyUsd: Record<string, number>,
  timestamps: readonly number[],
  nowSeconds: number,
  recentDays = 3,
): Record<string, number> {
  const days = new Set(timestamps.map(utcDayFromSeconds));
  for (let back = 1; back <= recentDays; back += 1) {
    days.add(utcDayFromSeconds(nowSeconds - back * DAY_SECONDS));
  }
  const out: Record<string, number> = {};
  for (const day of days) if (dailyUsd[day] !== undefined) out[day] = dailyUsd[day];
  return out;
}

/**
 * A counterpart asset amount, as a venue published it.
 *
 * Assets differ by orders of magnitude, so sub-unit amounts get up to 8 decimals and larger
 * ones 4; capped at 8 because the venue sends a float. The one formatter for these amounts.
 */
export function formatAssetAmount(amount: number): string {
  return amount.toLocaleString("en-US", { maximumFractionDigits: amount < 1 ? 8 : 4 });
}

/** A count with grouped digits: 18418 → "18,418". The one integer formatter. */
export function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}

/** A month as an axis tick, two-digit year: "Mar 24". Unix seconds, read in UTC. */
export function monthShort(timestamp: number): string {
  const d = new Date(timestamp * 1000);
  return `${d.toLocaleString("en-US", { month: "short", timeZone: "UTC" })} ${String(d.getUTCFullYear()).slice(2)}`;
}

/** A month with its full year: "Mar 2024". Unix seconds, read in UTC. */
export function monthLong(timestamp: number): string {
  const d = new Date(timestamp * 1000);
  return `${d.toLocaleString("en-US", { month: "short", timeZone: "UTC" })} ${d.getUTCFullYear()}`;
}

/** An axis tick count: "3.4M", "12K", "740". The chart gutter sizes itself to the longest. */
export function compactCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(Math.round(n));
}

/** The first character upper-cased and the rest untouched: "shielding" → "Shielding". */
export function capitalise(text: string): string {
  return `${text[0]?.toUpperCase() ?? ""}${text.slice(1)}`;
}
