/**
 * The transparent rich list, and how transparent value is distributed across addresses.
 *
 * A balance is `sum(outputs to the address) − sum(inputs from it)` from the chain index. It is
 * exact: it matches the node's `getaddressbalance` to the zatoshi, and the aggregate reconciles
 * with the node's transparent value pool.
 *
 * Deliberately absent:
 *
 *  - Entity grouping. One address is one address; clustering addresses into owners is not
 *    something this explorer does.
 *  - A label on the row. Names are editorial: they live in `ADDRESS_LABELS` and every page
 *    resolves them with `addressLabel`, so a name never depends on the API's deploy.
 *  - An inequality coefficient. An address is not an owner, so a Gini would claim more than the
 *    data supports. Bands and shares state what was measured.
 */

export interface RichListEntry {
  /** Rank by balance, computed once when the view is built so it cannot disagree with it. */
  rank: number;
  address: string;
  balanceZat: number;
  /** Lifetime received, outputs only. */
  receivedZat: number;
  /** Height of this address's first appearance, and its most recent. */
  firstHeight: number;
  lastHeight: number;
  /**
   * Transactions this address appears in, either side, counted once per transaction.
   *
   * Null means not computed yet (the column is filled by an online backfill), never "none": an
   * address holding a balance has been in at least one transaction.
   */
  txCount: number | null;
}

/** One balance band: how many addresses are in it and how much they hold between them. */
export interface DistributionBand {
  /** Inclusive lower bound in zatoshi. The top band has no upper bound. */
  fromZat: number;
  addresses: number;
  totalZat: number;
}

export interface RichListSummary {
  /**
   * The height the balances cover, captured when the view was refreshed, never the live tip.
   * The refresh is hourly, so the two differ.
   */
  height: number;
  /** Addresses holding more than nothing. */
  addressCount: number;
  /** Every positive balance summed: the denominator for every share on the page. */
  totalZat: number;
  /**
   * Transparent value that belongs to no single address (unattributed bare-pubkey outputs,
   * OP_RETURN, multisig). Small (hundreds of ZEC) but carried, because it is the difference
   * between this total and the node's transparent value pool.
   */
  unattributedZat: number;
  bands: DistributionBand[];
  /** Cumulative share held by the top 10, 100 and 1,000, computed with the same denominator. */
  topShares: { count: number; totalZat: number }[];
  asOf: number;
}

/**
 * Band boundaries, in ZEC. Powers of ten, so the ladder encodes no opinion about what counts
 * as a large holding.
 */
export const BAND_BOUNDARIES_ZEC = [0, 1, 10, 100, 1_000, 10_000, 100_000] as const;

/**
 * A share of the transparent total, 0..1.
 *
 * The denominator is transparent value only, never circulating supply (they differ by about a
 * third). Every caller renders the denominator beside the figure.
 */
export function shareOfTransparent(zat: number, totalZat: number): number {
  return totalZat > 0 ? zat / totalZat : 0;
}

/**
 * One labelled address's current transparent balance: what the agent's label guide prints beside
 * each name, so a question about a labelled entity is one read rather than one per address.
 */
export interface LabelledBalance {
  address: string;
  /**
   * Current, from the chain index. Zero when the address has no balance row, which is a
   * measurement: the index keeps a row only while the balance is positive.
   */
  balanceZat: number;
  /** Place on the transparent rich list as of `rankAsOfHeight`. Null when the address holds nothing or ranking has not run. */
  rank: number | null;
}

/** Every labelled address, in `ADDRESS_LABELS` order, with the height the ranks are as of. */
export interface LabelledBalances {
  /** The height the hourly rich-list pass ranked at, never the tip. 0 when it has never run. */
  rankAsOfHeight: number;
  items: LabelledBalance[];
}
