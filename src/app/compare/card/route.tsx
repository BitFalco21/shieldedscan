import { ImageResponse } from "next/og";
import { NextResponse, type NextRequest } from "next/server";
import { getDataSource } from "@/data";
import { parseVsParam, resolveComparison } from "@/domain";
import { isTestnet } from "@/lib/network";
import { CompareCard, COMPARE_CARD_SIZE } from "@/features/og/compare-card";
import { compareCardFacts } from "@/features/og/compare-card-facts";
import { JBM_EXTRABOLD_B64, JBM_REGULAR_B64 } from "@/features/og/fonts.generated";

/**
 * The share card for one comparison: `/compare/card?vs=bitcoin`.
 *
 * A route handler rather than Next's `opengraph-image` file convention, because that
 * convention receives route params, not the query string, and the comparison lives in `?vs=`.
 * `generateMetadata` on `/compare` points `og:image` here per asset.
 *
 * The answer depends on a query parameter and is shared-cached, so `Netlify-Vary: query=vs`
 * is required: without it every comparison previews as whichever one was fetched first. Five
 * minutes of shared cache bounds how far the printed read time can lag.
 */
export const dynamic = "force-dynamic";

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

const HEADERS = {
  "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=600",
  "Netlify-Vary": "query=vs",
};

function siteCardRedirect(request: NextRequest): Response {
  return NextResponse.redirect(new URL("/og.png", request.url), {
    status: 302,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function GET(request: NextRequest): Promise<Response> {
  // Absent on testnet, like the page: TAZ has no market, and a card naming one would be a
  // mainnet figure under a testnet URL.
  if (isTestnet) return new Response(null, { status: 404 });

  // Images are rendered only for the canonical spelling of a real comparison. Anything else
  // previews as the site's static card through an uncached redirect, so arbitrary `vs` values
  // cannot each cost a fresh image render.
  const raw = request.nextUrl.searchParams.get("vs") ?? undefined;
  const vs = parseVsParam(raw);
  if (raw !== undefined && vs !== raw) return siteCardRedirect(request);
  const snapshot = await getDataSource().getMarketSnapshot();
  const selection =
    snapshot === null ? ({ kind: "none" } as const) : resolveComparison(snapshot, vs);
  if (snapshot === null || selection.kind !== "comparison") return siteCardRedirect(request);

  return new ImageResponse(
    <CompareCard facts={compareCardFacts(snapshot, selection.comparison)} />,
    {
      ...COMPARE_CARD_SIZE,
      fonts: FONTS,
      headers: HEADERS,
    },
  );
}
