import type { RichListEntry, RichListSummary, TransparentAddress } from "@/domain";
import { BAND_BOUNDARIES_ZEC } from "@/domain";
import { cursorSlice } from "../data/cursor";

/**
 * The transparent rich list, for the fixture build.
 *
 * The top rows are real large addresses and balances, checked against the node's
 * `getaddressbalance`; the rest is scaled down to 24 rows, enough for two pages of keyset
 * pagination.
 *
 * The balances include a tie (two addresses at exactly 20,000 ZEC). Round holdings repeat on
 * the real chain, and only a tie exercises the composite cursor's tiebreak — with distinct
 * balances a single-column seek passes every test and is still wrong.
 */
const ZEC = 100_000_000;

const REAL_TOP: [address: string, zec: number][] = [
  ["t3aPMe94jMKyrgkbH5SSukimvdMFJ59EFhP", 438_920.89655],
  ["t1gsBrGZGMyDGZw2icGnMpVBuEGVWip5kH8", 400_001.01279],
  ["t1cpC3SS8okUsMQwTqWgzyA1k237B3WCeco", 385_845.32025],
  ["t3hdTwzcVVGEqDdNKJTBfWvWyaFYNJv7KkA", 341_937.1922],
  ["t1Lyq3AcqVcXkBTPHgNsDYoSyRDpugdSkE7", 230_100.45435],
  ["t1VxyLUKaK2tvj5iMRQagued6qpxPNvRkk7", 220_000],
  ["t1gGCYpyURMo2FcYDSqeR8pgp2Kx9rnT72V", 202_076.207],
  ["t1g47g7wNA55q5PWYHWb6X5JxzhMqwaknjC", 201_624.91892],
];

/** Filler below the real head, ending in a tie so the cursor tiebreak is exercised. */
const FILLER: [address: string, zec: number][] = [
  ["t1XP8Pjju5eMYVfXiFNNjkjY8kt5ZLL4maJ", 191_368.47179],
  ["t1e4VsqHKoMNbFp1RdnzXnedfher8gGA5kJ", 180_849.36055],
  ["t1RyCw14wRXrh3mp21uxgr9ynjem7cNUkMH", 160_205.099],
  ["t1QGQUHitjvXhZLJXgp7772CTEwAfYBRQXr", 156_874.03329],
  ["t1FixtureRichAddr00000000000000001", 90_000],
  ["t1FixtureRichAddr00000000000000002", 42_500.5],
  ["t1FixtureRichAddr00000000000000003", 20_000],
  ["t1FixtureRichAddr00000000000000004", 20_000],
  ["t1FixtureRichAddr00000000000000005", 9_800.25],
  ["t1FixtureRichAddr00000000000000006", 4_120],
  ["t1FixtureRichAddr00000000000000007", 990.75],
  ["t1FixtureRichAddr00000000000000008", 640.125],
  ["t1FixtureRichAddr00000000000000009", 88.4],
  ["t1FixtureRichAddr00000000000000010", 12.5],
  ["t1FixtureRichAddr00000000000000011", 3.75],
  ["t1FixtureRichAddr00000000000000012", 0.42],
];

const ROWS = [...REAL_TOP, ...FILLER]
  .map(([address, zec]) => ({ address, balanceZat: Math.round(zec * ZEC) }))
  .sort((a, b) => b.balanceZat - a.balanceZat || a.address.localeCompare(b.address));

const ENTRIES: RichListEntry[] = ROWS.map((row, i) => ({
  rank: i + 1,
  address: row.address,
  balanceZat: row.balanceZat,
  // Received is always at least the balance — an address cannot hold more than it received.
  receivedZat: Math.round(row.balanceZat * (1.4 + (i % 5) * 0.6)),
  firstHeight: 419_200 + i * 4_100,
  lastHeight: 3_400_000 + i * 1_700,
  // Index 3 is null — the state of a row the transaction-count backfill has not reached — so
  // the "unknown" rendering, which must never become a zero, is exercised.
  txCount: i === 3 ? null : 1 + ((i * 37) % 900),
}));

export function listRichList(query: { before?: string; after?: string; limit: number }) {
  return cursorSlice(ENTRIES, (e) => ({ sortKey: e.balanceZat, id: e.address }), query);
}

/**
 * Address counts and totals per band, ascending, at mainnet scale.
 *
 * Not derived from `ENTRIES`: the distribution covers every address while the list shows one
 * page, and mainnet-scale figures are what exercise the table's layout at narrow widths.
 *
 * `addressCount` and `totalZat` are summed from this table, so "every address banded once,
 * every zatoshi banded once" holds by construction. The totals match mainnet: 843,103
 * positive-balance addresses and 12,436,586 ZEC of transparent value.
 */
const BANDS: readonly { addresses: number; zec: number }[] = [
  { addresses: 757_937, zec: 35_258 }, // under 1
  { addresses: 62_859, zec: 203_937 }, // 1–10
  { addresses: 18_418, zec: 522_661 }, // 10–100
  { addresses: 3_070, zec: 821_917 }, // 100–1K
  { addresses: 642, zec: 2_118_416 }, // 1K–10K
  { addresses: 159, zec: 4_859_384 }, // 10K–100K
  { addresses: 18, zec: 3_875_013 }, // 100K+
];

export function getRichListSummary(): RichListSummary {
  const bounds = BAND_BOUNDARIES_ZEC.map((z) => z * ZEC);
  const bands = bounds.map((fromZat, i) => ({
    fromZat,
    addresses: BANDS[i]?.addresses ?? 0,
    totalZat: (BANDS[i]?.zec ?? 0) * ZEC,
  }));
  const totalZat = bands.reduce((sum, b) => sum + b.totalZat, 0);
  const addressCount = bands.reduce((sum, b) => sum + b.addresses, 0);
  return {
    height: 3_445_548,
    addressCount,
    totalZat,
    // The real measured figure: value in outputs naming no single address.
    unattributedZat: 79_849_217_432,
    bands,
    // Mainnet-shaped concentration: the top 100 hold about 61% of transparent value. Stated
    // rather than summed from `ENTRIES`, which is one page of the list.
    topShares: [
      { count: 10, totalZat: Math.round(totalZat * 0.3116) },
      { count: 100, totalZat: Math.round(totalZat * 0.6121) },
      { count: 1000, totalZat: Math.round(totalZat * 0.7824) },
    ],
    asOf: Math.floor(Date.now() / 1000),
  };
}

/**
 * The rich list's addresses as address-page entries, so every fixture `/rich-list` row links
 * to a page that resolves.
 *
 * `txids` is empty: the rich list is a balance view and the fixture transactions belong to
 * other addresses. A balance with no listed history is the honest render of what the
 * fixture knows.
 */
export function richListAddresses(): TransparentAddress[] {
  return ENTRIES.map((e) => ({
    kind: "transparent" as const,
    address: e.address,
    balanceZat: e.balanceZat,
    totalReceivedZat: e.receivedZat,
    totalSentZat: Math.max(0, e.receivedZat - e.balanceZat),
    txids: [],
  }));
}
