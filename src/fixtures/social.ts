import {
  DAILY_DRYRUN_KIND,
  DAILY_KIND,
  type DailyPost,
  type SocialPost,
  type SocialSnapshot,
} from "@/domain/social";
import { SWAP_DRYRUN_KIND, SWAP_KIND, type SwapFigures } from "@/domain/swap";
import { SHIELDING_KIND, UNSHIELDING_KIND, type BoundaryFigures } from "@/domain/boundary";

/**
 * The one published day this fixture chain knows about, with figures matching the card's
 * reference design, so `/social/card/daily/2026-08-29` renders it locally. The card renders
 * from a stored row rather than a live read, so `readSocialPost` needs a row to answer with.
 */
const READ_AT_UNIX = 1_788_019_200; // 2026-08-29 18:00 CEST — the daily post's fixed hour.
const PARIS_DAY = "2026-08-29";

/** Thirty daily closes, oldest first: a quiet month, then the rally the card's price sits at. */
const RECENT_CLOSES: SocialSnapshot["recentCloses"] = [
  { day: "2026-07-31", usd: 470.1 },
  { day: "2026-08-01", usd: 468.55 },
  { day: "2026-08-02", usd: 472.3 },
  { day: "2026-08-03", usd: 465.8 },
  { day: "2026-08-04", usd: 471.2 },
  { day: "2026-08-05", usd: 469.9 },
  { day: "2026-08-06", usd: 473.4 },
  { day: "2026-08-07", usd: 476.1 },
  { day: "2026-08-08", usd: 474.55 },
  { day: "2026-08-09", usd: 478.2 },
  { day: "2026-08-10", usd: 480.1 },
  { day: "2026-08-11", usd: 477.65 },
  { day: "2026-08-12", usd: 482.3 },
  { day: "2026-08-13", usd: 485.9 },
  { day: "2026-08-14", usd: 483.2 },
  { day: "2026-08-15", usd: 481.1 },
  { day: "2026-08-16", usd: 484.6 },
  { day: "2026-08-17", usd: 487.2 },
  { day: "2026-08-18", usd: 490.1 },
  { day: "2026-08-19", usd: 488.55 },
  { day: "2026-08-20", usd: 457.1 },
  { day: "2026-08-21", usd: 512.4 },
  { day: "2026-08-22", usd: 590.2 },
  { day: "2026-08-23", usd: 680.5 },
  { day: "2026-08-24", usd: 745.3 },
  { day: "2026-08-25", usd: 800.1 },
  { day: "2026-08-26", usd: 852.19 },
  { day: "2026-08-27", usd: 820.4 },
  { day: "2026-08-28", usd: 797.6 },
  { day: "2026-08-29", usd: 807.88 },
];

const DAILY_SNAPSHOT: SocialSnapshot = {
  readAtUnix: READ_AT_UNIX,
  readAtHeight: 3_464_715,
  parisDay: PARIS_DAY,
  priceUsd: 807.88,
  priceChange24hPct: 0.88,
  // Mainnet balances at the time: ironwood 3,803,040.06 / sapling 524,969.37 /
  // orchard 475,314.81 / sprout 22,621.27 ZEC.
  pools: [
    { pool: "ironwood", balanceZat: 380_304_006_000_000 },
    { pool: "sapling", balanceZat: 52_496_937_000_000 },
    { pool: "orchard", balanceZat: 47_531_481_000_000 },
    { pool: "sprout", balanceZat: 2_262_127_000_000 },
  ],
  // 16,843,565.9155448 ZEC.
  circulatingSupplyZat: 1_684_356_591_554_480,
  flow24h: {
    timestamp: READ_AT_UNIX - 86_400,
    shieldedZat: 981_742_000_000, // 9,817.42 ZEC
    unshieldedZat: 981_406_000_000, // 9,814.06 ZEC
  },
  recentCloses: RECENT_CLOSES,
};

const DAILY_POST: DailyPost = {
  eventKey: PARIS_DAY,
  figures: DAILY_SNAPSHOT,
  // Not posted in the fixture world; the card never reads this field, only the ledger route.
  tweetId: null,
};

/**
 * A second claimed row under `DAILY_DRYRUN_KIND`, with figures distinct from
 * `DAILY_SNAPSHOT`, so `/social/card/daily-dryrun/<day>` is visibly not the real `daily`
 * card and the route has a second kind to answer for.
 */
const DRYRUN_SNAPSHOT: SocialSnapshot = {
  ...DAILY_SNAPSHOT,
  priceUsd: 999.99,
  priceChange24hPct: -6.4,
};

const DRYRUN_POST: DailyPost = {
  eventKey: PARIS_DAY,
  figures: DRYRUN_SNAPSHOT,
  tweetId: null,
};

/**
 * A real inbound crossing, matching the swap card's reference design, so
 * `/social/card/swap/<transferId>` renders it locally. Also used by
 * `src/domain/__tests__/swap.test.ts`, so the domain tests, the card and local preview share
 * one set of numbers.
 */
const SWAP_FIGURES: SwapFigures = {
  transferId: "near-intents-9xZhoxm6UVBejoUwXUtbPBZsxrMVWtBDmHrmwTjBB1zw",
  timestamp: 1_785_869_315,
  zecAmountZat: 98_753_141_281,
  usdAtSwap: 500_638.92503815755,
  counterpartAsset: "USDC",
  counterpartChain: "ETH",
  counterpartChainName: "Ethereum",
  counterpartAmount: 507_500,
  counterpartIsNative: false,
  venue: "NEAR Intents",
  zcashTxid: "ba191814decc7c7c425f9141b39ca1b6a72deb662ea474cb12a75cd3bd83db7c",
};

const SWAP_POST: SocialPost<SwapFigures> = {
  eventKey: SWAP_FIGURES.transferId,
  figures: SWAP_FIGURES,
  tweetId: null,
};

/**
 * A second claimed row under `SWAP_DRYRUN_KIND`: a native-asset crossing rather than a token
 * one, so a dry run is visibly distinct and exercises `swapCounterpartLabel`'s branch for an
 * asset that is its own chain's coin (never "2.50 BTC on Bitcoin").
 */
const SWAP_DRYRUN_FIGURES: SwapFigures = {
  transferId: "near-intents-2akNnboSq4iA8bn4526YEas2VfMzPpMsKekouyyuRhBs",
  timestamp: 1_785_869_315,
  zecAmountZat: 26_286_799_829,
  usdAtSwap: 193_129.11834366302,
  counterpartAsset: "BTC",
  counterpartChain: "BTC",
  counterpartChainName: "Bitcoin",
  counterpartAmount: 2.5,
  counterpartIsNative: true,
  venue: "Maya Protocol",
  zcashTxid: "8b4f6fa852997131f653ab9913b51b1ce2abf28a53c24be633d18ad572628781",
  // Outbound, so the fixtures cover both directions of the swap card.
  direction: "out",
};

const SWAP_DRYRUN_POST: SocialPost<SwapFigures> = {
  eventKey: SWAP_DRYRUN_FIGURES.transferId,
  figures: SWAP_DRYRUN_FIGURES,
  tweetId: null,
};

/**
 * A real mainnet shielding — the largest of its fortnight, and Ironwood only, which is
 * what almost every large crossing looks like.
 */
const SHIELDING_FIGURES: BoundaryFigures = {
  txid: "97d9e97db08967319516f224ef66c5618bab465d13d3327f5a942154b6b89338",
  blockHeight: 3_456_631,
  timestamp: 1_787_393_919,
  pools: [{ pool: "ironwood", valueBalanceZat: 6_938_583_540_000 }],
  priceUsd: 804.5431518554688,
};

const SHIELDING_POST: SocialPost<BoundaryFigures> = {
  eventKey: SHIELDING_FIGURES.txid,
  figures: SHIELDING_FIGURES,
  tweetId: "1900000000000000003",
};

/**
 * A real mainnet unshielding covering two cases the shielding one cannot: it leaves Orchard
 * rather than Ironwood, and it moves two pools at once — a shape a small share of postable
 * crossings take.
 */
const UNSHIELDING_FIGURES: BoundaryFigures = {
  txid: "d860bc0f19e7d14cac8f038b5fcab374253ba028de5aa97df14a15f8830d661f",
  blockHeight: 3_367_633,
  timestamp: 1_780_669_931,
  pools: [
    { pool: "orchard", valueBalanceZat: -5_891_668_958_810 },
    { pool: "sapling", valueBalanceZat: -135_801_146_190 },
  ],
  priceUsd: 389.2999267578125,
};

const UNSHIELDING_POST: SocialPost<BoundaryFigures> = {
  eventKey: UNSHIELDING_FIGURES.txid,
  figures: UNSHIELDING_FIGURES,
  tweetId: null,
};

/**
 * The fixture's answer to `readSocialPost`. Only the rows above have ever been claimed;
 * every other (kind, key) pair resolves to `null`, exactly as a real ledger miss does.
 */
export function getSocialPost(
  kind: string,
  key: string,
): SocialPost<SocialSnapshot | SwapFigures | BoundaryFigures> | null {
  if (kind === DAILY_KIND && key === DAILY_POST.eventKey) return DAILY_POST;
  if (kind === DAILY_DRYRUN_KIND && key === DRYRUN_POST.eventKey) return DRYRUN_POST;
  if (kind === SWAP_KIND && key === SWAP_POST.eventKey) return SWAP_POST;
  if (kind === SWAP_DRYRUN_KIND && key === SWAP_DRYRUN_POST.eventKey) return SWAP_DRYRUN_POST;
  if (kind === SHIELDING_KIND && key === SHIELDING_POST.eventKey) return SHIELDING_POST;
  if (kind === UNSHIELDING_KIND && key === UNSHIELDING_POST.eventKey) return UNSHIELDING_POST;
  return null;
}
