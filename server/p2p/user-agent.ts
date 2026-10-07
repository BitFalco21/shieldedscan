/**
 * Turns a peer's self-reported user agent into a client name and version.
 *
 * The wire convention (inherited from Bitcoin's BIP 14) is `/Name:version/`, stackable
 * (`/MagicBean:6.2.0/GUI:1.0/`) with the outermost software last. The string is self-reported
 * and freely forgeable, so everything derived here is a claim about the peer, and every page
 * rendering it must say so.
 */

export interface ClientId {
  /** Display name; `null` when the peer sent no parseable agent — "Unidentified", never a guess. */
  client: string | null;
  version: string | null;
}

/** zcashd announces as MagicBean — its historical codename — so the wire name is mapped to
 * the name a reader knows. Everything else keeps the name the peer chose for itself. */
const WIRE_NAMES: Record<string, string> = {
  magicbean: "zcashd",
  zebra: "Zebra",
  zakura: "Zakura",
};

export function classifyUserAgent(userAgent: string | null): ClientId {
  if (!userAgent) return { client: null, version: null };
  const segments = userAgent.split("/").filter((s) => s.trim().length > 0);
  const last = segments[segments.length - 1];
  if (!last) return { client: null, version: null };
  const colon = last.indexOf(":");
  const rawName = (colon === -1 ? last : last.slice(0, colon)).trim();
  const rawVersion = colon === -1 ? null : last.slice(colon + 1).trim() || null;
  if (rawName.length === 0) return { client: null, version: null };
  if (/seeder/i.test(rawName)) return { client: "Seeder", version: rawVersion };
  return { client: WIRE_NAMES[rawName.toLowerCase()] ?? rawName, version: rawVersion };
}
