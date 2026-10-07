import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { classifyZcashAddress, parseZnsName, type ZnsRegistration } from "@/domain";
import { getDataSource } from "@/data";
import { ShieldedAddressPage } from "@/features/address/ShieldedAddressPage";
import { TransparentAddressPage } from "@/features/address/TransparentAddressPage";
import { shortHash } from "@/lib/format";
import { isTestnet } from "@/lib/network";
import { nullIfTransient } from "@/lib/transient-upstream";
import { cursorNavHrefs, type CursorStep } from "@/app/_shared/cursor-nav";

// Tip-sensitive: skip Next's fetch Data Cache (ARCHITECTURE.md, "Caching and freshness").
export const fetchCache = "force-no-store";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ addr: string }>;
}): Promise<Metadata> {
  const { addr } = await params;
  return { title: `Address ${shortHash(addr, 8)}` };
}

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ addr: string }>;
  searchParams: Promise<{ before?: string; after?: string; name?: string }>;
}) {
  const { addr } = await params;
  const { before, after, name } = await searchParams;
  // A shielded address is answered before any lookup: there is nothing to look up by design,
  // and the node can reject a valid `u1…` as malformed. `/v1` and `/chain/search` answer from
  // the same classifier.
  const kind = classifyZcashAddress(addr);
  const data = getDataSource();
  if (kind === "sapling" || kind === "unified") {
    return (
      <ShieldedAddressPage
        address={addr}
        kind={kind}
        searchedName={
          kind === "unified" && !isTestnet ? await searchedName(data, name, addr) : null
        }
      />
    );
  }
  const known = await data.getAddress(addr);
  if (known?.kind === "transparent") {
    const [{ items: txs, nextCursor, prevCursor }, chain] = await Promise.all([
      data.getAddressTransactions(known.address, { before, after, limit: 10 }),
      data.getChainInfo(),
    ]);
    const base = `/address/${encodeURIComponent(known.address)}`;
    const href = (step?: CursorStep) =>
      step ? `${base}?${step.name}=${encodeURIComponent(step.value)}` : base;
    return (
      <TransparentAddressPage
        info={known}
        txs={txs}
        now={chain.lastBlockTimestamp}
        priceUsd={chain.priceUsd}
        {...cursorNavHrefs({ nextCursor, prevCursor }, href)}
      />
    );
  }
  // The API can still answer with a shielded kind (the fixture source does); render it the
  // same way rather than treating it as unknown.
  if (known) {
    return <ShieldedAddressPage address={known.address} kind={known.kind} />;
  }
  notFound();
}

/**
 * The name a reader searched to arrive here, only if the registry still points it at this
 * address. Re-asked rather than trusted from the URL, so a hand-made link cannot put a name on
 * an address page. Any failure — outage, withheld, a miss, a different address — shows nothing:
 * an absent chip is the honest rendering, and "no name" would be a claim we did not check.
 */
async function searchedName(
  data: ReturnType<typeof getDataSource>,
  raw: string | undefined,
  address: string,
): Promise<ZnsRegistration | null> {
  const asked = raw === undefined ? null : parseZnsName(raw);
  if (asked === null) return null;
  const lookup = await nullIfTransient(() => data.getZnsName(asked));
  const hit = lookup?.registrations[0];
  return hit && !lookup?.withheld && hit.address === address ? hit : null;
}
