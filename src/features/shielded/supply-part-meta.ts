import type { PoolName, SupplyPart, SupplyPartId } from "@/domain";
import { NU7 } from "@/domain";
import { formatCount } from "@/lib/format";
import { network } from "@/lib/network";
import { POOL_CLASSES } from "@/lib/pool-palette";

export interface SupplyPartMeta {
  label: string;
  /** A few words beside the name. */
  tag: string;
  /** The panel's explanation when the card is selected. */
  detail: string;
  /** Ink of the card's key, the bar segment and the legend: one colour per part. */
  ink: string;
  /** Which shield the card draws, if any: only value pools have a privacy kind. */
  privacy: "shielded" | "transparent" | null;
  /** What the card's share is of. Named on the card, never implied. */
  denominator: "issued" | "cap";
  /** The closest list the site already has. */
  link: { href: string; label: string } | null;
}

const nu7Height = NU7.activationHeight[network];
const nu7At = nu7Height === null ? "NU7" : `NU7 (block ${formatCount(nu7Height)})`;

/** Every transaction that used the pool, newest first. */
const poolList = (pool: PoolName, label: string) => ({
  href: `/txs?pool=${pool}`,
  label: `Latest ${label} transactions`,
});

/**
 * Every part's words and colour. A `Record` over the part ids, so a new part fails to compile
 * until it is described. The four shielded pools keep the site's own pool colours; the rest take
 * neutral inks that differ in lightness, so no two neighbours in the bar share one.
 */
function table(nu7Active: boolean): Record<SupplyPartId, SupplyPartMeta> {
  return {
    transparent: {
      label: "Transparent",
      tag: "public",
      detail: "Addresses and amounts are public, as on Bitcoin.",
      ink: "text-ink-dim",
      privacy: "transparent",
      denominator: "issued",
      link: { href: "/txs?kind=transparent", label: "Latest transparent transactions" },
    },
    ironwood: {
      label: "Ironwood",
      tag: "since NU6.3",
      detail: "The newest shielded pool. Only its total is public.",
      ink: POOL_CLASSES.ironwood,
      privacy: "shielded",
      denominator: "issued",
      link: poolList("ironwood", "Ironwood"),
    },
    orchard: {
      label: "Orchard",
      tag: "sealed: exits only",
      detail: "Sealed: its funds can only leave, through the turnstile. Nothing new enters.",
      ink: POOL_CLASSES.orchard,
      privacy: "shielded",
      denominator: "issued",
      link: poolList("orchard", "Orchard"),
    },
    sapling: {
      label: "Sapling",
      tag: "open",
      detail: "Shielded since 2018, still open to deposits.",
      ink: POOL_CLASSES.sapling,
      privacy: "shielded",
      denominator: "issued",
      link: poolList("sapling", "Sapling"),
    },
    sprout: {
      label: "Sprout",
      tag: nu7Active ? "unspendable since NU7" : "unspendable from NU7",
      detail: nu7Active
        ? "The 2016 pool, frozen since NU7: it can no longer be spent."
        : "The 2016 pool. From NU7 it can no longer be spent.",
      ink: POOL_CLASSES.sprout,
      privacy: "shielded",
      denominator: "issued",
      link: poolList("sprout", "Sprout"),
    },
    lockbox: {
      label: "Lockbox",
      tag: "protocol reserve",
      detail:
        "No transactions: 12% of each block subsidy is added to it directly, and only a network upgrade can release it. Not circulating.",
      ink: "text-ink-faint",
      privacy: null,
      denominator: "issued",
      link: null,
    },
    nsm: {
      label: "NSM",
      tag: nu7Active ? "since NU7" : `from ${nu7At}`,
      detail: `${nu7Active ? "" : `Starts at ${nu7At}. `}60% of each block's fees, held out of circulation until reissued in later block rewards (ZIP 235). No transactions.`,
      // Not a green: green means privacy here, and the NSM is no pool.
      ink: "text-line-4",
      privacy: null,
      denominator: "issued",
      link: null,
    },
    unmined: {
      label: "Still to mine",
      tag: "not yet issued",
      detail: "Not a pool: the ZEC the issuance schedule has yet to create, up to the 21M cap.",
      ink: "text-edge-faint",
      privacy: null,
      denominator: "cap",
      link: { href: "/halving", label: "Issuance schedule" },
    },
  };
}

/**
 * A pool a newer API reports and this build has never heard of: named, and nothing else
 * claimed about it.
 */
function unknownPool(name: string): SupplyPartMeta {
  return {
    label: name,
    tag: "pool not known to this build",
    detail: "A value pool this version of the site does not describe yet.",
    ink: "text-ink",
    privacy: null,
    denominator: "issued",
    link: null,
  };
}

/** Built once per NU7 state rather than per card per render. */
const TABLES = { before: table(false), after: table(true) };

export function supplyPartMeta(part: SupplyPart, nu7Active: boolean): SupplyPartMeta {
  if (part.id === null) return unknownPool(part.name);
  return (nu7Active ? TABLES.after : TABLES.before)[part.id];
}
