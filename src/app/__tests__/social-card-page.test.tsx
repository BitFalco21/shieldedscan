import { describe, expect, it, vi } from "vitest";
import { DailyCard } from "@/features/social/DailyCard";
import { SwapCard } from "@/features/social/SwapCard";
import Page from "../social/card/[kind]/[key]/page";
import type { DailyPost, SocialPost } from "@/domain/social";
import type { SwapFigures } from "@/domain/swap";

/**
 * The card route reads the row of the requested `[kind]` (a dry run is stored under its own
 * kind), so a claimed row of the right kind renders and a missing or unrecognised kind 404s
 * before reaching the data source. It also dispatches on kind to the right component:
 * `swap`/`swap-dryrun` reach `SwapCard`, not `DailyCard`.
 */

const DRYRUN_POST: DailyPost = {
  eventKey: "2026-08-29",
  figures: {
    readAtUnix: 1_788_019_200,
    readAtHeight: 3_464_715,
    parisDay: "2026-08-29",
    priceUsd: 999.99,
    priceChange24hPct: -6.4,
    pools: [
      { pool: "ironwood", balanceZat: 380_304_006_000_000 },
      { pool: "sapling", balanceZat: 52_496_937_000_000 },
      { pool: "orchard", balanceZat: 47_531_481_000_000 },
      { pool: "sprout", balanceZat: 2_262_127_000_000 },
    ],
    circulatingSupplyZat: 1_684_356_591_554_480,
    flow24h: {
      timestamp: 1_788_019_200 - 86_400,
      shieldedZat: 981_742_000_000,
      unshieldedZat: 981_406_000_000,
    },
    recentCloses: [
      { day: "2026-08-28", usd: 797.6 },
      { day: "2026-08-29", usd: 807.88 },
    ],
  },
  tweetId: null,
};

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

const readSocialPost = vi.fn(async (kind: string, key: string) => {
  if (kind === "daily-dryrun" && key === "2026-08-29") return DRYRUN_POST;
  if (kind === "swap" && key === SWAP_POST.eventKey) return SWAP_POST;
  return null;
});

vi.mock("@/data", () => ({
  getDataSource: () => ({ readSocialPost }),
}));

const props = (kind: string, key: string) => ({
  params: Promise.resolve({ kind, key }),
});

describe("/social/card/[kind]/[key]", () => {
  it("renders the row claimed under a DRY-RUN kind, not the real daily one", async () => {
    const element = await Page(props("daily-dryrun", "2026-08-29"));
    expect(element.type).toBe(DailyCard);
    expect(element.props).toMatchObject({ snapshot: DRYRUN_POST.figures });
    expect(readSocialPost).toHaveBeenCalledWith("daily-dryrun", "2026-08-29");
  });

  it("404s a key that is not shaped like one, without calling the data source", async () => {
    for (const key of ["..", ".", "a/b", "x y", "2026-08-29%00", "a".repeat(201)]) {
      readSocialPost.mockClear();
      await expect(Page(props("daily", key)), key).rejects.toThrow();
      expect(readSocialPost, key).not.toHaveBeenCalled();
    }
  });

  it("404s a key that was never claimed under that kind", async () => {
    readSocialPost.mockClear();
    await expect(Page(props("daily-dryrun", "2099-01-01"))).rejects.toThrow();
    expect(readSocialPost).toHaveBeenCalledWith("daily-dryrun", "2099-01-01");
  });

  // The kind segment is attacker-supplied on a public route: an unrecognised value must 404
  // without reaching the data source.
  it("404s an unrecognised kind without ever calling the data source", async () => {
    readSocialPost.mockClear();
    await expect(Page(props("../../etc/passwd", "2026-08-29"))).rejects.toThrow();
    expect(readSocialPost).not.toHaveBeenCalled();
  });

  it("dispatches a `swap` kind to SwapCard, not DailyCard", async () => {
    const element = await Page(props("swap", SWAP_POST.eventKey));
    expect(element.type).toBe(SwapCard);
    expect(element.props).toMatchObject({ figures: SWAP_POST.figures });
    expect(readSocialPost).toHaveBeenCalledWith("swap", SWAP_POST.eventKey);
  });

  it("404s a swap key that was never claimed under that kind", async () => {
    readSocialPost.mockClear();
    await expect(Page(props("swap", "never-claimed"))).rejects.toThrow();
    expect(readSocialPost).toHaveBeenCalledWith("swap", "never-claimed");
  });
});
