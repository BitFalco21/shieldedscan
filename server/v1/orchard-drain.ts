import {
  orchardDrainSeries,
  utcDayFromSeconds,
  type OrchardDrain,
  type OrchardDrainPoint,
} from "@/domain";
import { amount } from "./format";

/**
 * `/v1/analytics/ironwood`'s `orchard` section: Orchard emptying into Ironwood, day by day, and
 * the share of Orchard's pre-activation balance that has crossed. The share is computed here, with
 * both terms beside it, so no reader divides two series to get it.
 */
export function orchardDrainWire(drain: OrchardDrain | null, unknowns: Record<string, string>) {
  if (drain === null) {
    unknowns["data.orchard"] = "unmeasured";
    return null;
  }
  const points = orchardDrainSeries(drain);
  const last = points.at(-1) ?? null;
  const base = drain.baseOrchardZat;
  if (base === null) unknowns["data.orchard.beforeActivation.balance"] = "unmeasured";
  if (last === null) unknowns["data.orchard.latest"] = "nonexistent";
  else if (last.orchardZat === null) unknowns["data.orchard.latest.remaining"] = "unmeasured";
  if (last !== null && base === null) unknowns["data.orchard.latest.shareMigrated"] = "unmeasured";
  // The domain's own rounding, so the site, Zeno and the wire state one figure.
  const shareOf = (p: OrchardDrainPoint) =>
    p.sharePct === null || base === null
      ? null
      : { pct: p.sharePct, numerator: p.cumulativeZat, denominator: base };
  return {
    beforeActivation: {
      height: drain.baseHeight,
      balance: base === null ? null : amount(base),
    },
    latest:
      last === null
        ? null
        : {
            day: utcDayFromSeconds(last.timestamp),
            closeHeight: last.closeHeight,
            remaining: last.orchardZat === null ? null : amount(last.orchardZat),
            migratedToIronwood: amount(last.cumulativeZat),
            migratedFromSeveralPools: amount(last.cumulativeMultiSourceZat),
            shareMigrated: shareOf(last),
          },
    days: points.map((p, i) => {
      if (p.orchardZat === null) unknowns[`data.orchard.days.${i}.remaining`] = "unmeasured";
      if (p.sharePct === null) unknowns[`data.orchard.days.${i}.shareMigrated`] = "unmeasured";
      return {
        day: utcDayFromSeconds(p.timestamp),
        closeHeight: p.closeHeight,
        remaining: p.orchardZat === null ? null : amount(p.orchardZat),
        migrated: amount(p.migratedZat),
        migratedFromSeveralPools: amount(p.multiSourceZat),
        cumulative: amount(p.cumulativeZat),
        shareMigrated: shareOf(p),
      };
    }),
  };
}
