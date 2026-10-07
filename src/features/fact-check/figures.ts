import type { ChainInfo, SupplyBreakdown } from "@/domain";
import {
  circulatingZat,
  setupFreeShieldedZat,
  shieldedShareOfCirculatingPct,
  shieldedZat,
} from "@/domain";
import { formatCount, formatSharePct, formatZec, formatZecWhole } from "@/lib/format";
import type { LiveFigureId } from "./claims";

/**
 * One live figure under a claim: what it is, its value, and when it was read.
 *
 * `value` is null when the read that feeds it failed or the figure is unmeasured — the row
 * then says "unavailable", never a zero and never the Veil (an outage of ours is not Zcash's
 * privacy). `exact` carries the full eight-decimal amount for a `title`, per the rule that a
 * supply-scale figure is rounded for reading and never hidden.
 */
export interface LiveFigure {
  label: string;
  value: string | null;
  exact?: string;
  /** "at block 3,497,881" or "last 24 hours · coinbase excluded" — the figure's own clock. */
  readAt: string | null;
}

export type LiveFigures = Record<LiveFigureId, readonly LiveFigure[]>;

/**
 * Every live figure the page shows, from ONE supply read and ONE chain read.
 *
 * Numerator and denominator of each share come from the same partition at the same height —
 * `circulatingZat` rather than `ChainInfo.circulatingSupplyZat`, which is a second read that
 * can sit a block apart. The 24-hour figures come from the chain read, whose count excludes
 * coinbase and whose fully-shielded share is taken over that same count
 * (`server/chain-stats.ts`), so the row says both.
 */
export function factCheckFigures(
  supply: SupplyBreakdown | null,
  chain: ChainInfo | null,
): LiveFigures {
  const pool = (name: string): number | null =>
    supply?.pools.find((p) => p.pool === name)?.balanceZat ?? null;
  const atBlock = supply ? `at block ${formatCount(supply.height)}` : null;

  const whole = (zat: number | null) => (zat === null ? null : formatZecWhole(zat));
  const exact = (zat: number | null) => (zat === null ? undefined : formatZec(zat));

  const lockbox = pool("lockbox");
  const orchard = pool("orchard");
  const sprout = pool("sprout");

  const shielded = supply ? shieldedZat(supply) : null;
  const circulating = supply ? circulatingZat(supply) : null;
  const shieldedShare =
    shielded !== null && circulating !== null
      ? shieldedShareOfCirculatingPct(shielded, circulating)
      : null;

  const setupFree = supply ? setupFreeShieldedZat(supply) : null;
  const setupFreeShare =
    setupFree !== null && shielded !== null && shielded > 0 ? (setupFree / shielded) * 100 : null;

  const count24h = chain?.txCount24h ?? null;
  const pct24h = chain?.fullyShieldedPct24h ?? null;

  return {
    lockbox: [
      {
        label: "in the lockbox now",
        value: whole(lockbox),
        exact: exact(lockbox),
        readAt: atBlock,
      },
    ],
    "flawed-pools": [
      { label: "left in Orchard", value: whole(orchard), exact: exact(orchard), readAt: atBlock },
      { label: "left in Sprout", value: whole(sprout), exact: exact(sprout), readAt: atBlock },
    ],
    "setup-free": [
      {
        label: "shielded ZEC in pools that needed no setup",
        value:
          setupFreeShare === null || setupFree === null || shielded === null
            ? null
            : `${formatSharePct(setupFreeShare)} · ${formatZecWhole(setupFree)} of ${formatZecWhole(shielded)}`,
        readAt: atBlock,
      },
    ],
    "shielded-share": [
      {
        label: "shielded now",
        value:
          shieldedShare === null || shielded === null || circulating === null
            ? null
            : `${formatSharePct(shieldedShare)} of circulating ZEC · ${formatZecWhole(shielded)} of ${formatZecWhole(circulating)}`,
        readAt: atBlock,
      },
    ],
    "fully-shielded-24h": [
      {
        label: "fully shielded",
        value:
          pct24h === null || count24h === null
            ? null
            : `${formatSharePct(pct24h)} of ${formatCount(count24h)} transactions`,
        readAt: "last 24 hours · coinbase excluded",
      },
    ],
  };
}
