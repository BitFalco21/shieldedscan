import { notFound, permanentRedirect } from "next/navigation";
import { minersWindowFromMining, MINERS_DEFAULT_WINDOW } from "@/domain";
import { isTestnet } from "@/lib/network";

/** Rendered on request: the redirect reads the query, so it is never prerendered stale. */
export const fetchCache = "force-no-store";

/**
 * `/mining` moved to `/miners`: a permanent redirect, so old links and search results land on
 * the same figures. Its rolling 24h and 3d windows have no whole-day form and open on 7D; no
 * window meant 7d here, so it still does.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ window?: string }>;
}) {
  if (isTestnet) notFound();
  const window = minersWindowFromMining((await searchParams).window);
  permanentRedirect(window === MINERS_DEFAULT_WINDOW ? "/miners" : `/miners?window=${window}`);
}
