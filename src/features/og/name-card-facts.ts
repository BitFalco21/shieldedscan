import { formatZnsName, znsActionVerb, type ZnsLookup } from "@/domain";
import { formatDateLong, shortHash } from "@/lib/format";
import { siteUrl } from "@/lib/site";

export interface NameCardFacts {
  name: string;
  /** Point size for the name: a 62-character name has to fit the same line as a 3-character one. */
  nameSize: number;
  addressShort: string;
  /** "CLAIMED 15 JULY 2026" — the last action and its day, never a relative age. */
  since: string;
  stamp: string;
  host: string;
}

/**
 * What a name's share card may print, or null when it must preview as the site instead.
 *
 * A card is a permanent claim copied by every scraper, so it states only what stays true: the
 * address the name points at as of the printed day, and the day of the last action (never a
 * relative age). A released, withheld or unregistered name returns null: there is no address.
 */
export function nameCardFacts(lookup: ZnsLookup): NameCardFacts | null {
  const r = lookup.registrations[0];
  if (lookup.withheld || r === undefined) return null;
  const name = formatZnsName(r.name);
  return {
    name,
    nameSize: name.length <= 14 ? 96 : name.length <= 22 ? 68 : name.length <= 36 ? 46 : 30,
    addressShort: shortHash(r.address, 10),
    since: `${znsActionVerb(r.lastAction)} ${formatDateLong(r.timestamp)}`.toUpperCase(),
    stamp: r.listingPriceZat !== null ? "ZCASH NAME · FOR SALE" : "ZCASH NAME",
    host: siteUrl.replace(/^https?:\/\//, ""),
  };
}
