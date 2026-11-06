import { SHIELDED_GROUP, UNATTRIBUTED_GROUP, type MiningPoolId } from "@/domain";

/**
 * The colour of each mining pool on `/miners`, fixed by pool, never by rank: a pool keeps its hue
 * when its rank changes between windows or months, so the share bar and the monthly chart can be
 * read against each other. The seven largest pools of late 2026 take their own flow hue; the
 * rest share "other pools". Unattributed addresses are the neutral rest hue (not one miner), and
 * a shielded coinbase is green, the site's privacy colour.
 */
const OWN: Partial<Record<MiningPoolId, string>> = {
  viabtc: "flow-1",
  foundry: "flow-2",
  f2pool: "flow-3",
  luxor: "flow-4",
  "2miners": "flow-5",
  antpool: "flow-6",
  kupool: "flow-7",
};

export const OTHER_POOLS_KEY = "other-pools";
const OTHER_POOLS_CLASS = "flow-8";

/** A pool's own colour key: itself if it has a hue, else the "other pools" fold. */
export function miningPoolColourKey(id: string): string {
  return Object.hasOwn(OWN, id) ? id : OTHER_POOLS_KEY;
}

/** The colour class of a group key: a pool id, the "other pools" fold, unattributed or shielded. */
export function miningGroupClass(key: string): string {
  if (key === SHIELDED_GROUP) return "text-green";
  if (key === UNATTRIBUTED_GROUP) return "flow-rest";
  if (key === OTHER_POOLS_KEY) return OTHER_POOLS_CLASS;
  return OWN[key as MiningPoolId] ?? OTHER_POOLS_CLASS;
}

/** Pools with a hue of their own, in a fixed order. */
export const OWN_HUE_POOLS = Object.keys(OWN) as MiningPoolId[];
