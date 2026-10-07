import { ImageResponse } from "next/og";
import { classifySearchQuery } from "@/domain";
import { getDataSource } from "@/data";
import { TxCard, TX_CARD_SIZE } from "@/features/og/tx-card";
import { txCardFacts } from "@/features/og/tx-card-facts";
import { siteCardFacts } from "@/features/og/site-card-facts";
import { JBM_EXTRABOLD_B64, JBM_REGULAR_B64 } from "@/features/og/fonts.generated";

/**
 * The share card for one transaction.
 *
 * Next's file convention: this route emits `og:image`, `twitter:image` and their dimensions,
 * absolute against `metadataBase`, and overrides the site-wide `/og.png` for transaction URLs.
 *
 * Cost: each distinct txid is one data read plus a satori render; the CDN answers later scrapes.
 */
export const alt = "shieldedscan transaction summary";
export const size = TX_CARD_SIZE;
export const contentType = "image/png";

/**
 * Per-route, so it takes the shorter of the two needs: a confirmed transaction's card never
 * changes, but a "not yet in a block" card must not outlive its truth by more than five minutes.
 */
export const revalidate = 300;

/**
 * satori cannot read woff2, so the card renders from TTF subsets (`brand/subset-og-fonts.py`)
 * embedded base64 in a generated module. Not a file read: `fetch(new URL(..., import.meta.url))`
 * is unimplemented in this runtime, and an `fs` read depends on deployment file tracing.
 */
const FONTS = [
  {
    name: "JBM",
    data: Buffer.from(JBM_REGULAR_B64, "base64"),
    weight: 400 as const,
    style: "normal" as const,
  },
  {
    name: "JBM",
    data: Buffer.from(JBM_EXTRABOLD_B64, "base64"),
    weight: 800 as const,
    style: "normal" as const,
  },
];

export default async function Image({ params }: { params: Promise<{ txid: string }> }) {
  const { txid } = await params;

  // The shape check comes first, so a malformed id never reaches a data read. It uses
  // `classifySearchQuery` rather than a local regex, keeping one definition of a txid.
  // A well-formed but absent id renders the site card rather than a broken image.
  const query = classifySearchQuery(txid);
  const data = getDataSource();
  const tx = query.type === "hash64" ? await data.getTransaction(query.hash) : null;

  if (!tx) {
    return new ImageResponse(<TxCard facts={siteCardFacts()} />, { ...size, fonts: FONTS });
  }

  // Daily closes, never the live price: the image is permanent once scraped, so a figure is
  // valued at its own day's close, printed beside it. The map is memoised per instance, and
  // testnet returns `{}`, so the card prints coin only.
  const [dailyUsd, chain] = await Promise.all([data.getDailyPriceMap(), data.getChainInfo()]);

  return new ImageResponse(
    <TxCard
      facts={txCardFacts(tx, {
        dailyUsd,
        currentUsd: chain.priceUsd,
        nowSeconds: Math.floor(Date.now() / 1000),
      })}
    />,
    { ...size, fonts: FONTS },
  );
}
