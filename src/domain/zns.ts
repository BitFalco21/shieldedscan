/**
 * The Zcash Name System (ZNS, zcashnames.com): a human name such as `zenith` registered to a
 * unified address.
 *
 * A name says where its registrant pointed it, and nothing about who holds the address: a
 * CLAIM needs no proof of control (the registry asks for it only on update, list, delist and
 * release), so anyone can point a free name at anyone's address. Names therefore resolve
 * forward only (name → address); address pages carry no reverse label, where a planted name
 * would read as the holder's own. The API publishes a name only once its transaction is in our
 * index and its signature verifies (see `server/zns.ts`).
 *
 * Names never label a transparent receiver derived from the unified address, which would
 * attach a name to a transparent payment history.
 */

/** The registry's own rule, as `zcashname-sdk` enforces it: lowercase letters and digits, 1–62. */
const ZNS_NAME_RE = /^[a-z0-9]{1,62}$/;

/** How names are written on this site. The registry stores and resolves the bare name only. */
export const ZNS_SUFFIX = ".zcash";

/**
 * The endings a reader may type after a name. ZNS treats `zenith`, `zenith.zcash` and
 * `zenith.zec` as one name, so all three reach one page; names are still written with
 * `ZNS_SUFFIX`. At most one ending is stripped.
 */
const ZNS_INPUT_SUFFIXES = [ZNS_SUFFIX, ".zec"] as const;

/**
 * Beyond this many blocks behind our tip (the reorg depth), the registry's answer is withheld.
 * A name is a payment instruction, and a stale registry can name an address since moved away from.
 */
export const ZNS_MAX_LAG_BLOCKS = 100;

/** The registry state a registration was last changed by. `LIST`/`DELIST` move the listing only. */
export type ZnsLastAction = "CLAIM" | "UPDATE" | "BUY" | "DELIST" | "RELEASE";

export interface ZnsRegistration {
  /** The bare registered name, e.g. `zenith`. Render it through `formatZnsName`. */
  name: string;
  /** The unified address the name currently points at. */
  address: string;
  /**
   * The transaction and height of the last action on this registration, not necessarily the
   * claim. Label it with `znsActionVerb(lastAction)`.
   */
  txid: string;
  height: number;
  /** That block's timestamp, unix seconds, read from our index rather than the registry. */
  timestamp: number;
  lastAction: ZnsLastAction;
  /**
   * The asking price in zatoshi while the name is on the ZNS marketplace, else null. A listed
   * name may soon point elsewhere, which is why the page says so beside it.
   */
  listingPriceZat: number | null;
}

/** Every action the registry's event log records. */
export type ZnsEventAction =
  "CLAIM" | "UPDATE" | "BUY" | "LIST" | "SETPRICE" | "DELIST" | "RELEASE";

/** One entry in a name's history, published only once its transaction is found on our chain. */
export interface ZnsNameEvent {
  action: ZnsEventAction;
  txid: string;
  height: number;
  /** That block's timestamp, unix seconds, from our index. */
  timestamp: number;
  /** The address the action pointed the name at (CLAIM, UPDATE, BUY), else null. */
  address: string | null;
  /** The price in zatoshi for LIST, SETPRICE and BUY, else null. */
  priceZat: number | null;
}

/**
 * One name lookup's answer. The normalised name is echoed so the adapter can refuse a
 * response to a different question.
 *
 * `withheld` is not "no such name": it means the registry was too far behind our chain, or
 * unread for too long, to be trusted at all, and `registrations` is then empty. Rendered as
 * unavailable, never as a miss.
 */
export interface ZnsLookup {
  query: string;
  registrations: ZnsRegistration[];
  /**
   * The name's history, newest first. Non-empty for a released name too, which has a past and no
   * current registration. Empty when withheld.
   */
  history: ZnsNameEvent[];
  withheld: boolean;
  /** The registry's own synced height when its snapshot was taken. */
  indexerHeight: number;
  /** Our indexed tip at the same moment. */
  tipHeight: number;
  /** When the snapshot was taken, unix seconds. */
  asOf: number;
}

/**
 * A query string as a registry name, or null when it cannot be one. Accepts `Zenith`,
 * `zenith.zcash`, `zenith.zec` and surrounding whitespace, because the registry resolves only the
 * exact lowercase bare name and rejects the others. A bare `zec` is a name in its own right: the
 * ending needs its dot.
 */
export function parseZnsName(raw: string): string | null {
  let q = raw.trim().toLowerCase();
  const suffix = ZNS_INPUT_SUFFIXES.find((s) => q.endsWith(s));
  if (suffix !== undefined) q = q.slice(0, -suffix.length);
  return ZNS_NAME_RE.test(q) ? q : null;
}

export function formatZnsName(name: string): string {
  return `${name}${ZNS_SUFFIX}`;
}

/** The verb for an action, so a reader is never told a name was claimed when it was bought. */
export function znsActionVerb(action: ZnsEventAction): string {
  switch (action) {
    case "LIST":
      return "listed";
    case "SETPRICE":
      return "repriced";
    case "CLAIM":
      return "claimed";
    case "UPDATE":
      return "updated";
    case "BUY":
      return "bought";
    case "DELIST":
      return "delisted";
    case "RELEASE":
      return "released";
  }
}
