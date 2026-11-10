import {
  coinAgeBands,
  type CoinAgeCell,
  type CoinAgePoint,
  type CoinAgeSeries,
} from "@/domain/coin-age";
import { utcDayFromSeconds } from "@/domain/time";
import { TIP_HEIGHT, TIP_TIME } from "./ids";

/**
 * Transparent coin age over the fixture chain, from a simulated matrix rather than written-out
 * bands, so the fixture goes through the same banding the API does: one cohort of outputs a month,
 * most of it spent off over the following months and a dormant share that barely moves, which is
 * the shape that fills the oldest bands. Heights run linearly from genesis to the fixture tip.
 */

const DAY = 86_400;
const GENESIS = Date.UTC(2016, 9, 28) / 1000;
const ZEC = 100_000_000;

const heightAt = (ts: number) => Math.round(((ts - GENESIS) / (TIP_TIME - GENESIS)) * TIP_HEIGHT);

interface Cohort {
  day: string;
  createdAt: number;
  zat: number;
}

function cohorts(): Cohort[] {
  // Two days before the tip, so the newest block has coins under a week old too.
  const recent = TIP_TIME - 2 * DAY;
  const out: Cohort[] = [{ day: utcDayFromSeconds(recent), createdAt: recent, zat: 20_000 * ZEC }];
  for (let i = 0; ; i++) {
    const at = i === 0 ? GENESIS : Date.UTC(2016, 9 + i, 15) / 1000;
    if (at > TIP_TIME) return out;
    // Churn grows with the chain, with a seasonal swell.
    const zat = Math.round((40_000 + 2_500 * i) * (1 + 0.4 * Math.sin(i / 2)) * ZEC);
    out.push({ day: utcDayFromSeconds(at), createdAt: at, zat });
    // A small late-month cohort, so every month-end has coins under a week old.
    const late = Date.UTC(2016, 9 + i, 28) / 1000;
    if (i > 0 && late <= TIP_TIME) {
      out.push({ day: utcDayFromSeconds(late), createdAt: late, zat: Math.round(zat / 10) });
    }
  }
}

/** What a cohort still holds `months` after it was created. */
function surviving(zat: number, months: number): number {
  const hot = 0.7 * zat * 0.5 ** (months / 2);
  const dormant = 0.3 * zat * 0.99 ** months;
  return Math.round(hot + dormant);
}

function pointAt(asOfTs: number, all: readonly Cohort[]): CoinAgePoint {
  const asOf = utcDayFromSeconds(asOfTs);
  const cells: CoinAgeCell[] = all
    .filter((c) => c.createdAt <= asOfTs)
    .map((c) => {
      const zat = surviving(c.zat, (asOfTs - c.createdAt) / (30.44 * DAY));
      return {
        creationDay: c.day,
        valueZat: zat,
        outputs: Math.max(1, Math.round(zat / (40 * ZEC))),
      };
    });
  return { asOf, height: heightAt(asOfTs), bands: coinAgeBands(cells, asOf) };
}

export function getCoinAge(): CoinAgeSeries {
  const all = cohorts();
  const monthEnds: CoinAgePoint[] = [];
  for (let i = 1; ; i++) {
    // The last second of each month's last day.
    const end = Date.UTC(2016, 9 + i, 1) / 1000 - 1;
    if (end >= Math.floor(TIP_TIME / DAY) * DAY) break;
    monthEnds.push(pointAt(end, all));
  }
  return { monthEnds, latest: { ...pointAt(TIP_TIME, all), height: TIP_HEIGHT } };
}
