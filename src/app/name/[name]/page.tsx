import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { formatZnsName, parseZnsName } from "@/domain";
import { getDataSource } from "@/data";
import { DataUnavailable } from "@/components/DataUnavailable";
import { NamePage } from "@/features/name/NamePage";
import { isTestnet } from "@/lib/network";
import { nullIfTransient } from "@/lib/transient-upstream";
import { pageShareMetadata } from "@/lib/share-card";

// A name can move between two views, and a stale render would show the address it moved away
// from, the one thing a name page must not do.
export const fetchCache = "force-no-store";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ name: string }>;
}): Promise<Metadata> {
  const name = parseZnsName(decodeURIComponent((await params).name));
  if (name === null) return { title: "Zcash name" };
  const title = `${formatZnsName(name)} · Zcash name`;
  const description = `Where ${formatZnsName(name)} points in the Zcash Name System, with its history.`;
  // The preview's text and image are this name's. The image is set explicitly, because a
  // page's own `openGraph.images` outranks the route's `opengraph-image` file; relying on the
  // file would serve the site's /og.png under a name's title.
  const share = pageShareMetadata(title, description);
  const image = { url: `/name/${name}/opengraph-image`, width: 1200, height: 630, alt: title };
  return {
    title,
    description,
    openGraph: { ...share.openGraph, images: [image] },
    twitter: { ...share.twitter, images: [image.url] },
  };
}

/**
 * `/name/<name>` — one Zcash Name System name. Mainnet only: the registry is a mainnet one, and
 * the testnet API mounts no ZNS route. A name that was never registered is a real 404 (no
 * `loading.tsx` may sit above this route); an unreadable or stale registry is
 * `DataUnavailable`, never a 404 — "no such name" is a claim we could not check.
 */
export default async function Page({ params }: { params: Promise<{ name: string }> }) {
  if (isTestnet) notFound();
  const raw = decodeURIComponent((await params).name);
  const name = parseZnsName(raw);
  if (name === null) notFound();
  const lookup = await nullIfTransient(() => getDataSource().getZnsName(name));
  if (lookup === null || lookup.withheld) {
    return (
      <DataUnavailable what="the Zcash Name System registry" refreshesWithin="a few minutes" />
    );
  }
  if (lookup.registrations.length === 0 && lookup.history.length === 0) notFound();
  return <NamePage lookup={lookup} />;
}
