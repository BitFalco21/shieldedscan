import { ImageResponse } from "next/og";
import { parseZnsName } from "@/domain";
import { getDataSource } from "@/data";
import { NameCard, NAME_CARD_SIZE } from "@/features/og/name-card";
import { nameCardFacts } from "@/features/og/name-card-facts";
import { siteCardFacts } from "@/features/og/site-card-facts";
import { TxCard } from "@/features/og/tx-card";
import { JBM_EXTRABOLD_B64, JBM_REGULAR_B64 } from "@/features/og/fonts.generated";
import { isTestnet } from "@/lib/network";
import { nullIfTransient } from "@/lib/transient-upstream";

/**
 * The share card for one Zcash name — what a campaign post linking `/name/zenith` previews as.
 *
 * Five minutes of revalidation, because a name can move and a card naming the address it moved
 * away from is the one thing it must not keep saying; past that, scrapers cache on their side.
 * Anything without an address to state — a released name, a withheld registry, a name nobody
 * registered, testnet — previews as the site, never as a broken image or a guess.
 */
export const alt = "shieldedscan Zcash name";
export const size = NAME_CARD_SIZE;
export const contentType = "image/png";
export const revalidate = 300;

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

export default async function Image({ params }: { params: Promise<{ name: string }> }) {
  const name = parseZnsName(decodeURIComponent((await params).name));
  const lookup =
    name === null || isTestnet
      ? null
      : await nullIfTransient(() => getDataSource().getZnsName(name));
  const facts = lookup === null ? null : nameCardFacts(lookup);
  if (facts === null) {
    return new ImageResponse(<TxCard facts={{ ...siteCardFacts(), stamp: "ZCASH NAME" }} />, {
      ...size,
      fonts: FONTS,
    });
  }
  return new ImageResponse(<NameCard facts={facts} />, { ...size, fonts: FONTS });
}
