/**
 * The public wire contract: /v1's own types, owned by /v1.
 *
 * Deliberately not the domain types, and importing nothing from `@/domain` (a test pins this
 * by reading the file). The private API speaks domain types verbatim so the frontend and
 * `src/domain/` evolve in lockstep; a public contract cannot, since every rename would break
 * strangers. `map.ts` is the one place the two meet, and this file is the frozen half.
 *
 * ## Nulls carry reasons
 *
 * Every nullable field's key is always emitted: an omitted key behaves differently from an
 * explicit null under a spread. Where a null is ambiguous, a sibling `unknowns` map names why,
 * from a closed vocabulary:
 *
 *   { "feeZat": null, "unknowns": { "feeZat": "indeterminate" } }
 *
 * A consumer writing `value || 0` now has to delete a stated reason to do it.
 */

/** Why a field is null. Closed vocabulary — additions are a versioned API change. */
export type V1UnknownReason =
  /** Encrypted on-chain, hidden by design. Render as private, never as zero. */
  | "shielded"
  /** We have no measurement right now (cold tracker, no venue figure). Retry later. */
  | "unmeasured"
  /** Real and knowable, but not carried in this view — fetch the detail endpoint. */
  | "omitted"
  /** Did not exist at this height or ingestion time. Permanent for this object. */
  | "nonexistent"
  /** Public inputs exist but the answer would require a guess. Permanent. */
  | "indeterminate";

/** Field-path → reason, present on a resource only when something in it is null. */
export type V1Unknowns = Record<string, V1UnknownReason>;

/** Every percentage travels with its denominator — never a bare number. */
export interface V1Share {
  pct: number;
  numerator: number;
  denominator: number;
}

/** Keyset page. No totals, no page numbers: a real index seek knows neither. */
export interface V1Page<T> {
  items: T[];
  nextCursor: string | null;
  prevCursor: string | null;
}

export interface V1Error {
  error: {
    code:
      | "invalid_parameter"
      | "unknown_parameter"
      | "not_found"
      | "method_not_allowed"
      | "rate_limited"
      | "upstream_unavailable"
      | "internal";
    message: string;
  };
  requestId: string;
  asOf: number;
}

// ---------------------------------------------------------------------------- coverage

/**
 * What an aggregate actually covers, stated in the response rather than only in the docs, so a
 * floor is never presented as a total.
 */
export interface V1FloorCoverage {
  basis: "floor";
  scope: "public-swap-protocols";
  excludes: string[];
  venues: { protocol: string; enabled: boolean; live: boolean }[];
  firstAt: number | null;
  lastAt: number | null;
}

export interface V1SampleCoverage {
  basis: "sample";
  sampled: number;
  population: number;
  extrapolated: false;
}

export interface V1ObservedCoverage {
  basis: "observed";
  observer: "single-node";
  networkCensus: false;
  observingSince: number;
  pollIntervalSeconds: number;
  detectionLimit: string;
}

// ---------------------------------------------------------------------------- resources

export interface V1Status {
  height: number;
  bestBlockHash: string;
  lastBlockTimestamp: number;
  circulatingSupplyZat: number;
  priceUsd: number | null;
  priceChange24hPct: number | null;
  txCount24h: number | null;
  fullyShieldedPct24h: V1Share | null;
  crosschain: { venues: { protocol: string; enabled: boolean; live: boolean }[] };
  unknowns?: V1Unknowns;
  asOf: number;
}

export interface V1PoolBalance {
  pool: "transparent" | "sprout" | "sapling" | "orchard" | "ironwood" | "lockbox";
  balanceZat: number;
  shielded: boolean;
  /** False only for the lockbox: the NU6 deferred subsidy no transaction can spend. */
  spendable: boolean;
  shareOfShielded: V1Share | null;
}

export interface V1Supply {
  heightReadAt: number;
  maxSupplyZat: number;
  minedZat: number;
  unminedZat: number;
  shieldedZat: number;
  /** `shieldedZat` sums the four shielded pools; the lockbox is deliberately outside it. */
  shieldedZatExcludes: string[];
  pools: V1PoolBalance[];
  /** True when the node reported every pool; a partial partition cannot claim to sum. */
  partitionComplete: boolean;
  asOf: number;
}

export interface V1CirculatingSupply {
  /** minedZat minus the lockbox: mined but unspendable is not circulating. */
  circulatingZat: number;
  /** The same figure as a ZEC decimal string with all eight places — what the text form serves. */
  circulatingZec: string;
  heightReadAt: number;
  excludes: string[];
  asOf: number;
}

/** ZIP-317 conventional fees — consensus convention, so serving it asserts no guess. */
export interface V1Fees {
  standard: string;
  marginalFeeZat: number;
  graceActions: number;
  formula: string;
  logicalActions: string;
  examples: { description: string; logicalActions: number; conventionalFeeZat: number }[];
  notes: string[];
  asOf: number;
}

/**
 * One consensus funding or lockbox stream at a height, exactly as the node reports it.
 *
 * `recipient` is the node's own label, which can lag the ZIP's current recipient name (e.g.
 * "Major Grants" for the stream ZIP 214 revision 2 directs to the Financial Privacy
 * Foundation). It is passed through rather than rewritten, since consensus publishes no such
 * mapping; `specification` is the authority.
 */
export interface V1SubsidyStream {
  recipient: string;
  /** The ZIP defining this stream — published by the node beside the amount, not chosen here. */
  specification: string;
  valueZat: number;
  /** The consensus-fixed payout address, or null for a stream paid into a pool. */
  address: string | null;
  share: V1Share | null;
}

export interface V1SubsidyBreakdown {
  totalZat: number;
  minerZat: number;
  fundingStreamsZat: number;
  lockboxZat: number;
  /**
   * The same split as percentages, so no consumer has to divide. Null only if the node reports a
   * non-positive total subsidy, which consensus does not produce.
   */
  minerShare: V1Share | null;
  fundingStreamsShare: V1Share | null;
  lockboxShare: V1Share | null;
  /**
   * Every active stream, named. `[]` means the node reported none at this height: true before
   * Canopy and again at or past 4,406,400, where ZIP 214 revision 2's streams end. An empty array
   * there means the streams as currently legislated have run out, not that the miner keeps the
   * whole subsidy for good.
   */
  fundingStreams: V1SubsidyStream[];
  lockboxStreams: V1SubsidyStream[];
}

/** One change in the per-block subsidy. `before` is the split at `height − 1`, `after` at `height`. */
export interface V1HalvingEvent {
  /** `halving`, or `block-time-change` for Blossom — where the subsidy halved WITH the block interval and issuance per day did not move. */
  kind: "halving" | "block-time-change";
  height: number;
  /** Unix seconds of the block at `height`; null while it is still ahead (or without an index). */
  at: number | null;
  atUtc: string | null;
  before: V1SubsidySplit;
  after: V1SubsidySplit;
}

export interface V1SubsidySplit {
  totalZat: number;
  minerZat: number;
  fundingStreamsZat: number;
  lockboxZat: number;
}

export interface V1Halving {
  height: number;
  /** The next halving's activation height — a consensus constant, boundary-verified against the node. */
  halvingHeight: number;
  blocksRemaining: number;
  /** blocksRemaining × the 75-second post-Blossom target. An estimate and labelled as one. */
  estimatedSecondsRemaining: number;
  estimatedAt: string;
  /** Both read from the node's own `getblocksubsidy`, never recomputed here. */
  currentSubsidy: V1SubsidyBreakdown;
  nextSubsidy: V1SubsidyBreakdown;
  /**
   * Every subsidy change so far and the next halving, oldest first, Blossom's block-time change
   * included and labelled as not a halving.
   */
  events: V1HalvingEvent[];
  asOf: number;
}

export interface V1DailyPrice {
  day: string;
  usd: number;
  /** Which aggregator this day came from. Never omitted — see /v1/prices/daily notes. */
  source: string;
  /**
   * In another currency only: the close in that currency, the USD close times that day's rate,
   * null when the day has no rate (never the USD figure).
   */
  close?: number | null;
  /** In another currency only, on a page row: the day the rate was published. */
  rateDay?: string | null;
}

export interface V1DailyPrices {
  /** The currency `close` is stated in; `usd` when no other was asked for. */
  currency: string;
  items: V1DailyPrice[];
  /** The returned page's first and last day. */
  firstDay: string | null;
  lastDay: string | null;
  /** The whole series' first and last day, whatever the page: page to a day with `from`/`to`. */
  availableFrom: string | null;
  availableTo: string | null;
  /**
   * The highest and lowest stored close over the whole series, unaffected by `from`/`to` or the
   * row cap, so the record is answerable from any page. Null only when the table is empty.
   */
  allTimeHigh: V1DailyPrice | null;
  allTimeLow: V1DailyPrice | null;
  sources: string[];
  /** The row cap, and whether this page hit it: a capped page is never mistaken for a whole one. */
  maxRows: number;
  truncated: boolean;
  unknowns?: V1Unknowns;
  asOf: number;
}

/** The chain header facts, with the live stats' nulls always emitted and explained. */
export interface V1ChainInfo {
  height: number;
  bestBlockHash: string;
  lastBlockTimestamp: number;
  circulatingSupplyZat: number;
  priceUsd: number | null;
  priceChange24hPct: number | null;
  txCount24h: number | null;
  fullyShieldedPct24h: number | null;
  unknowns?: V1Unknowns;
  asOf: number;
}

/** One block, list and detail alike; only the list nulls `totalFeeZat` (`omitted`). */
export interface V1Block {
  height: number;
  hash: string;
  prevHash: string;
  timestamp: number;
  sizeBytes: number;
  txCount: number;
  difficulty: number;
  /**
   * Who mined it, on the coinbase's own evidence. `shielded` means the coinbase pays a
   * shielded pool (ZIP 213) and the payee is not public; `address` is null then and for
   * `unknown`.
   */
  minerKind: "transparent" | "shielded" | "unknown";
  minerAddress: string | null;
  /** Attacker-controlled bytes, already stripped to printables at the parse boundary. */
  coinbaseTag: string | null;
  /** What this block CONTAINS — the coinbase counts as transparent here, by convention. */
  contents: {
    transparent: number;
    mixed: number;
    shielded: number;
    /**
     * Transactions that used each shielded pool (carried a bundle in it). A pool migration uses
     * two pools and counts in both, so these do not sum to the kind counts above.
     */
    pools: { ironwood: number; orchard: number; sapling: number; sprout: number } | null;
  };
  totalFeeZat: number | null;
  /**
   * What the coinbase paid out in total: the block subsidy plus the fees it swept.
   *
   * Not the same quantity as `/v1/network/halving`'s subsidy, which is consensus arithmetic for a
   * height; this is what the block actually paid. Null for a shielded coinbase (ZIP 213), where
   * the amount is encrypted; `unknowns` says which.
   */
  blockRewardZat: number | null;
  /**
   * The miner's own share: `blockRewardZat` minus the funding streams below. A funding stream is
   * a consensus-fixed output, so subtracting it is arithmetic, not a guess about change outputs.
   */
  minerRewardZat: number | null;
  /**
   * The coinbase outputs that did not pay the miner, by consensus.
   *
   * An empty array is a MEASUREMENT — post-halving there are none — and is distinguishable from
   * an unreadable coinbase, which nulls the two figures above and files a reason in `unknowns`.
   */
  fundingStreams: V1TxSide[];
  unknowns?: V1Unknowns;
}

/**
 * What a transaction did to the shielded boundary.
 *
 * - `shielding`: transparent value entered the shielded pools.
 * - `unshielding`: shielded value left them to a transparent address.
 * - `shielded`: value stayed inside the pools and never crossed. Always paired with
 *   `kind: "shielded"`, so it is that same fact on a second axis.
 * - `null`: the question does not apply (`transparent`, `coinbase`), or a `mixed`
 *   transaction moved value both ways. A migration between two pools is null too: naming one
 *   direction there would be a guess, and `/v1/privacy/transactions/{txid}` reports the
 *   migration explicitly instead.
 *
 * These are the protocol's own verbs, the same words the site uses. Earlier values
 * (`t-to-z` / `z-to-t` / `z-to-z`) were renamed shortly after launch; there is no plan for a
 * second rename.
 */
export type V1TxDirection = "shielding" | "unshielding" | "shielded" | null;

/** A transparent input or output. `address` is null when the script names none or several. */
export interface V1TxSide {
  address: string | null;
  valueZat: number;
}

/** The full single transaction. `rawHex` rides only when explicitly asked for. */
export interface V1TransactionDetail {
  txid: string;
  blockHeight: number | null;
  blockHash: string | null;
  timestamp: number;
  sizeBytes: number;
  version: number;
  lockTime: number | null;
  expiryHeight: number | null;
  kind: "transparent" | "shielded" | "mixed" | "coinbase";
  direction: V1TxDirection;
  pools: string[];
  feeZat: number | null;
  /**
   * The transparent sides, capped — see `transparentInputCount` below.
   *
   * ALWAYS read the counts rather than these arrays' lengths when you need to know how many
   * inputs or outputs a transaction has. The arrays are a window; the counts are the fact.
   */
  transparentInputs: V1TxSide[];
  transparentOutputs: V1TxSide[];
  /**
   * The true number of transparent inputs and outputs, always emitted, never capped, so a
   * capped array can never masquerade as a complete one. The count is the authority and the
   * array is a page of it.
   */
  transparentInputCount: number;
  transparentOutputCount: number;
  /**
   * Present only when an array was capped, naming which and where to resume.
   *
   * `inputsFrom`/`outputsFrom` are ordinal offsets, not keyset cursors: the one place this API
   * uses an offset. It is exact because a confirmed transaction is immutable, so its input at
   * ordinal 1,000 is the same input on every request.
   */
  truncated?: {
    transparentInputs?: { returned: number; total: number; resumeWith: string };
    transparentOutputs?: { returned: number; total: number; resumeWith: string };
  };
  bundles: {
    sprout: { joinSplits: number } | null;
    sapling: { spends: number; outputs: number; valueBalanceZat: number } | null;
    orchard: { actions: number; valueBalanceZat: number } | null;
    ironwood: { actions: number; valueBalanceZat: number } | null;
  };
  /**
   * What the transaction did, in one sentence built only from what the chain states — the same
   * words the transaction page shows. It never names an output as "the" payment; `notOnChain`
   * says what the chain does not record.
   */
  summary: { text: string; notOnChain: string };
  /**
   * The public cross-chain swaps this transaction is the Zcash leg of, on the protocols this
   * explorer indexes (NEAR Intents, Maya, THORChain). `total: 0` is an answer — not a swap leg
   * there; null means the swap store could not be read.
   */
  crosschain: { total: number; transfers: V1Transfer[] } | null;
  rawHex?: string;
  unknowns?: V1Unknowns;
  asOf: number;
}

/**
 * An address. A shielded or unified address answers 200 with an explanation and NO balance
 * keys — its history is encrypted on-chain, and a null balance would still imply one exists
 * to look up. That refusal is the point, not a limitation.
 */
export type V1Address =
  | {
      kind: "transparent";
      address: string;
      balanceZat: number;
      totalReceivedZat: number;
      totalSentZat: number;
      /**
       * Where this address stands on the transparent rich list, or null.
       *
       * Always present, and null is two different facts told apart by `unknowns.rank`:
       * `nonexistent` means the address holds nothing, so it is on no rich list; `unmeasured` means
       * ranking has not run or the index is unreachable. A rank of 0 is never published (the column
       * defaults to 0 before the first ranking pass).
       *
       * An ordinal without a denominator: a rank reads correctly alone, and the holder count is
       * served by `/v1/rich-list/distribution`.
       */
      rank: number | null;
      /**
       * Transactions this address appears in, counted once per transaction.
       *
       * Null means not computed yet (`unknowns.txCount = "unmeasured"`), never "none": an address
       * with a balance has been in at least one transaction. Same convention as
       * `V1RichListEntry.txCount`.
       */
      txCount: number | null;
      /**
       * The height `rank` was computed at: the rich list's own height, not the tip. The refresh
       * runs hourly, so the two differ. Null when the rich list has never been built.
       *
       * `balanceZat` and `txCount` are not as of this height: both come from the chain index and
       * are current.
       */
      rankAsOfHeight: number | null;
      /** The address's first and last block on-chain; null when the index could not say. */
      firstSeen: { height: number; timestamp: number } | null;
      lastSeen: { height: number; timestamp: number } | null;
      unknowns?: V1Unknowns;
      asOf: number;
    }
  | { kind: "sapling"; address: string; note: string; asOf: number }
  | {
      kind: "unified";
      address: string;
      /** The network the address encodes; null when it does not decode. */
      network: string | null;
      /**
       * Its receivers, decoded by ZIP 316 (public by construction: they are the address string);
       * null when it does not decode, never a partial list.
       */
      receivers: V1UnifiedReceiver[] | null;
      receiversNote: string;
      note: string;
      unknowns?: V1Unknowns;
      asOf: number;
    };

/**
 * One receiver inside a unified address. Orchard has no standalone address form, so its
 * `address` is null and `note` says why.
 */
export interface V1UnifiedReceiver {
  type: string;
  address: string | null;
  note?: string;
  typecode?: number;
}

/**
 * One holder on the transparent rich list.
 *
 * A balance here is `sum(outputs to the address) − sum(inputs from it)` over the chain index:
 * exact, not an estimate, and checked against the node's own `getaddressbalance`.
 *
 * No label field. The site names a few addresses under a per-entry evidence standard, but a
 * name travelling without the basis that qualifies it would turn a second-hand attribution
 * into an apparent fact for whoever consumes it next. This is an omission, not a `refused`
 * entry.
 *
 * No entity grouping, here or anywhere. One address is one address: an exchange holds
 * thousands, and one address can hold thousands of people's coins.
 */
export interface V1RichListEntry {
  /** Rank by balance, stored in the view when it is built so it cannot disagree with it. */
  rank: number;
  address: string;
  balanceZat: number;
  /** Lifetime received — outputs only. A balance says nothing about what has passed through. */
  receivedZat: number;
  firstHeight: number;
  lastHeight: number;
  /**
   * Transactions this address appears in, counted once per transaction.
   *
   * Null means not computed yet, never "none": an address in this view has been in at least one
   * transaction. Carries `unknowns.txCount = "unmeasured"` when null.
   */
  txCount: number | null;
  unknowns?: V1Unknowns;
}

/**
 * A page of the rich list.
 *
 * `height` is the height the balances cover, captured when the view was refreshed, not the
 * chain tip (the hourly refresh lags it). It is on the page because a caller paging the list
 * has no other way to learn it.
 */
export interface V1RichListPage extends V1Page<V1RichListEntry> {
  height: number;
  asOf: number;
}

/**
 * One labelled address. The name never travels without whose claim it is: `source` names the
 * attribution, and `flag` the investigator behind a theft label.
 */
export interface V1Label {
  address: string;
  name: string;
  /** `external`: a third party attributes it and this explorer repeats them, unverified. */
  basis: "external" | "self-declared";
  /** Whose attribution the name is, and when it was read, e.g. Arkham's entity labels. */
  source: string;
  /** Present on an address a named investigator flagged in a theft; null otherwise. */
  flag: { by: string; url: string } | null;
  /** Current transparent balance. Zero is a measurement: the address holds nothing. */
  balanceZat: number;
  /** Place on the transparent rich list as of `rankHeight`. Null carries its reason in `unknowns`. */
  rank: number | null;
  unknowns?: V1Unknowns;
}

export interface V1Labels {
  /** What a label is and is not, carried on every response so it travels with the names. */
  notice: string;
  count: number;
  labels: V1Label[];
  /** The height the ranks were computed at (the hourly rich list), never the tip. */
  rankHeight: number;
  asOf: number;
}

/** One balance band: how many addresses are in it and how much they hold between them. */
export interface V1DistributionBand {
  /** Inclusive lower bound in zatoshi. The top band has no upper bound. */
  fromZat: number;
  addresses: number;
  totalZat: number;
  /** This band's share of transparent value — never of circulating supply. */
  share: V1Share | null;
}

/** The cumulative share held by the top N addresses. */
export interface V1TopHolderShare {
  count: number;
  totalZat: number;
  share: V1Share | null;
}

/**
 * How transparent ZEC is spread across addresses.
 *
 * Every share here has transparent value as its denominator, never circulating supply; the two
 * differ by roughly a third, which is why `V1Share` carries its denominator.
 *
 * No Gini coefficient and no inequality claim: an address is not an owner, so a single number
 * measuring how unequally ZEC is held is not supported by this data.
 */
export interface V1RichListDistribution {
  /** The height the balances cover, as on the page. Never the tip. */
  height: number;
  /** Addresses holding more than nothing. */
  addressCount: number;
  /** Every positive balance summed — the denominator for every share here. */
  totalZat: number;
  /**
   * Transparent value belonging to no single address: bare-pubkey outputs the parser does not
   * attribute, OP_RETURN, multisig (~798 ZEC). Carried because it is almost all of the gap between
   * `totalZat` and the node's transparent value pool.
   *
   * Reconcile at a fixed height: the two readings drift apart at the block rate, so comparing at
   * different moments manufactures an error that is only elapsed time. At one height,
   * `totalZat + unattributedZat` has been observed ~2 ZEC above the node's pool (0.000017%); the
   * remainder is not claimed to be zero.
   */
  unattributedZat: number;
  bands: V1DistributionBand[];
  topHolders: V1TopHolderShare[];
  asOf: number;
}

/** What a query resolves to — identifiers only; fetch the object from its own endpoint. */
export interface V1SearchResult {
  query: string;
  resolvesTo:
    | { type: "block"; height: number; hash: string }
    | { type: "transaction"; txid: string }
    | { type: "address"; address: string; kind: string | null }
    | null;
  asOf: number;
}

/**
 * One row of the public transaction list. Lean: no I/O arrays (the detail and privacy
 * endpoints carry structure) and no value field, because a fully shielded row has no public
 * amount and any stand-in would sit beside real figures as if comparable.
 */
export interface V1TransactionListItem {
  txid: string;
  blockHeight: number;
  blockHash: string;
  timestamp: number;
  sizeBytes: number;
  kind: "transparent" | "shielded" | "mixed" | "coinbase";
  /** What this transaction did to the shielded boundary — see {@link V1TxDirection}. */
  direction: V1TxDirection;
  /** Shielded pools this transaction touched, newest protocol first. */
  pools: string[];
  /**
   * Null is two different facts and `unknowns.feeZat` says which: `nonexistent` on a
   * coinbase (it pays no fee, by consensus), `indeterminate` where an input could not be
   * resolved. Never 0 for either.
   */
  feeZat: number | null;
  unknowns?: V1Unknowns;
}

export interface V1TransactionPrivacy {
  txid: string;
  blockHeight: number | null;
  kind: "transparent" | "shielded" | "mixed" | "coinbase";
  /** What this transaction did to the shielded boundary — see {@link V1TxDirection}. */
  direction: V1TxDirection;
  /** Shielded pools this transaction touched, newest protocol first. */
  pools: string[];
  /**
   * Net zatoshis into (+) or out of (−) the pools that PUBLISH a value balance. Null when
   * no pool on this transaction does (Sprout publishes none) — never a fabricated zero.
   */
  netShieldedZat: number | null;
  netShieldedBasis: string;
  /** Transparent value moved; null when nothing about the value is public. */
  publicValueZat: number | null;
  /** A turnstile migration, when the transaction provably is one. */
  migration: { fromPools: string[]; toPool: string; amountZat: number } | null;
  bundles: {
    sprout: { joinSplits: number } | null;
    sapling: { spends: number; outputs: number; valueBalanceZat: number } | null;
    orchard: { actions: number; valueBalanceZat: number } | null;
    ironwood: { actions: number; valueBalanceZat: number } | null;
  };
  /** Machine-readable: what this API will never claim about this transaction. */
  notKnowable: string[];
  unknowns?: V1Unknowns;
  asOf: number;
}

export interface V1TransferLeg {
  chain: string;
  /** Null when the venue never published a ticker — never the chain's native symbol. */
  asset: string | null;
  amount: number | null;
  usdAtSwap: number | null;
  txHash: string | null;
  address: string | null;
  /** Zcash leg only: the address family, from the site's single classifier. */
  addressKind?: "transparent" | "sapling" | "unified" | null;
}

export interface V1Transfer {
  id: string;
  protocol: string;
  direction: "in" | "out";
  status: "completed" | "pending" | "refunded";
  timestamp: number;
  zecAmountZat: number;
  legs: { zcash: V1TransferLeg; counterpart: V1TransferLeg };
  counterpartIsSynthetic: boolean;
  /**
   * The venue's own record key (its deposit address). There is deliberately no top-level
   * usdValue: the two legs' USD figures differ by the venue's fee and must not be averaged.
   */
  venueRecordKey: string | null;
  unknowns?: V1Unknowns;
}

export interface V1Flows {
  coverage: V1FloorCoverage;
  in: V1FlowSide;
  out: V1FlowSide;
  asOf: number;
}

/** One direction's total, plus its per-chain breakdown. Totals never need adding up. */
export interface V1FlowSide extends V1FlowFigures {
  flows: V1Flow[];
}

export interface V1Flow extends V1FlowFigures {
  chain: string;
}

export interface V1FlowFigures {
  transfers: number;
  zecAmountZat: number;
  /**
   * The venues' own swap-time USD, summed, never a spot price applied to a historical amount:
   * ZEC's price has moved by a factor of ten across this data.
   *
   * Always emitted, zero included. `usdCoveredTransfers` is the denominator that makes it
   * quotable: where it is under `transfers`, some venue published no price and the dollar figure
   * is a floor within the floor that public-swap-venue coverage already makes it.
   */
  usdAtSwap: number;
  /** Transfers of the `transfers` above whose venue published a swap-time USD price. */
  usdCoveredTransfers: number;
}

export interface V1Destinations {
  direction: "in" | "out";
  coverage: V1FloorCoverage;
  buckets: {
    addressKind: "transparent" | "sapling" | "unified" | null;
    shieldedCapable: boolean | null;
    transfers: number;
    zecAmountZat: number;
  }[];
  /** Share of CLASSIFIED transfers landing shielded-capable — denominator stated below. */
  shieldedCapableShare: V1Share | null;
  shareDenominator: string;
  /** A capability claim only: which receiver a unified address paid into is not public. */
  receiverUsedIsNotPublic: true;
  /**
   * Keyed `buckets[i].addressKind` / `buckets[i].shieldedCapable` for the unclassified bucket,
   * the one place on this resource a null appears. Without a stated reason a consumer might
   * default `shieldedCapable` to `false`, understating the shielded-capable share.
   */
  unknowns?: V1Unknowns;
  asOf: number;
}

export interface V1ReorgEvent {
  detectedAt: number;
  height: number;
  depth: number;
  /** No longer in the chain — this log is the only place it survives. Never a link. */
  orphanedHash: string;
  replacedBy: string;
}

export interface V1ReorgSummary {
  scope: V1ObservedCoverage;
  observedCount: number;
  deepestDepth: number | null;
  unknowns?: V1Unknowns;
  asOf: number;
}

export interface V1MempoolSummary {
  pendingCount: number;
  totalSizeBytes: number;
  medianFeeZat: number | null;
  medianFeeRateZatPerByte: number | null;
  composition: {
    coverage: V1SampleCoverage;
    transparent: number;
    mixed: number;
    shielded: number;
  } | null;
  /** No percentage: a share over a sample would carry authority it does not have. */
  unknowns?: V1Unknowns;
  asOf: number;
}

export interface V1MonthPoint {
  periodStart: number;
  topHeight: number;
  txs: { transparent: number; mixed: number; shielded: number };
  balances: { sprout: number; sapling: number; orchard: number; ironwood: number };
  netFlowZat: number;
  fullyShieldedShare: V1Share;
  poolTouchingShare: V1Share;
}

export interface V1Monthly {
  interval: "month";
  balanceBasis: "period-closing-at-top-height";
  coinbase: "excluded";
  range: { from: number; to: number };
  points: V1MonthPoint[];
  asOf: number;
}
