import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDataSource } from "@/data";
import {
  DAILY_DRYRUN_KIND,
  DAILY_KIND,
  isSocialPostKind,
  type SocialSnapshot,
} from "@/domain/social";
import {
  SHIELDING_DRYRUN_KIND,
  SHIELDING_KIND,
  UNSHIELDING_DRYRUN_KIND,
  UNSHIELDING_KIND,
  type BoundaryFigures,
} from "@/domain/boundary";
import { SWAP_DRYRUN_KIND, SWAP_KIND, type SwapFigures } from "@/domain/swap";
import { DailyCard } from "@/features/social/DailyCard";
import { BoundaryCard } from "@/features/social/BoundaryCard";
import { SwapCard } from "@/features/social/SwapCard";

// The figures are whatever was claimed for this key, never a fresh read: the card, the post
// text and the ledger must be one set of numbers.
export const fetchCache = "force-no-store";

// `robots.ts` disallows crawling `/social/`, but a Disallow only stops fetching, not indexing
// a URL discovered elsewhere. This is the actual no-index directive.
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * One route serves every social card design; `[kind]` selects the component (including dry
 * runs) and `[key]` is the claimed post's key (a day, a transfer id or a txid).
 *
 * `kind` is attacker-supplied on this public route, so it is validated against the closed
 * `SOCIAL_POST_KINDS` set before it reaches `readSocialPost`. The dispatch below is exhaustive
 * over that set, so a new kind without a branch 404s instead of rendering the wrong card.
 */
export default async function Page({ params }: { params: Promise<{ kind: string; key: string }> }) {
  const { kind, key } = await params;
  if (!isSocialPostKind(kind)) notFound();
  // A post key is a day, a txid or a transfer id: letters, digits and a few separators, never a
  // dot. Anything else is not a key and is never sent upstream.
  if (!/^[A-Za-z0-9:_-]{1,200}$/.test(key)) notFound();
  const post = await getDataSource().readSocialPost(kind, key);
  if (!post) notFound();

  switch (kind) {
    case DAILY_KIND:
    case DAILY_DRYRUN_KIND:
      // `readSocialPost` already validated this shape for these kinds (`isDailyPost` in
      // `chain-api-source.ts`), so the cast narrows a checked fact.
      return <DailyCard snapshot={post.figures as SocialSnapshot} />;
    case SWAP_KIND:
    case SWAP_DRYRUN_KIND:
      return <SwapCard figures={post.figures as SwapFigures} />;
    case SHIELDING_KIND:
    case SHIELDING_DRYRUN_KIND:
    case UNSHIELDING_KIND:
    case UNSHIELDING_DRYRUN_KIND:
      // One component for both directions: the direction is derived from the stored pool
      // balances, not the kind, so the card and the ledger key cannot disagree. The shape
      // was validated by `isBoundaryPost`.
      return <BoundaryCard figures={post.figures as BoundaryFigures} />;
  }
}
