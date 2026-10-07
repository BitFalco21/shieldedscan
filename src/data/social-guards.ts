import {
  SHIELDING_DRYRUN_KIND,
  SHIELDING_KIND,
  UNSHIELDING_DRYRUN_KIND,
  UNSHIELDING_KIND,
  type BoundaryFigures,
} from "@/domain/boundary";
import type { DailyPost, SocialPost, SocialSnapshot } from "@/domain/social";
import { SWAP_DRYRUN_KIND, SWAP_KIND, type SwapFigures } from "@/domain/swap";
import { isDailyClose, isShieldedPoolBalance, isShieldingFlowPoint } from "./chain-guards";

/**
 * Shape check for a published social snapshot. Each nullable field is checked against its
 * own nullability rather than defaulted: a stored snapshot was complete when written, so a
 * field that is neither its type nor `null` means the wire shape has drifted, and it must
 * throw.
 */
function isSocialSnapshot(value: unknown): value is SocialSnapshot {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Record<string, unknown>;
  return (
    typeof s.readAtUnix === "number" &&
    typeof s.readAtHeight === "number" &&
    typeof s.parisDay === "string" &&
    (s.priceUsd === null || typeof s.priceUsd === "number") &&
    (s.priceChange24hPct === null || typeof s.priceChange24hPct === "number") &&
    Array.isArray(s.pools) &&
    s.pools.every(isShieldedPoolBalance) &&
    (s.circulatingSupplyZat === null || typeof s.circulatingSupplyZat === "number") &&
    (s.flow24h === null || isShieldingFlowPoint(s.flow24h)) &&
    Array.isArray(s.recentCloses) &&
    s.recentCloses.every(isDailyClose)
  );
}

function isDailyPost(value: unknown): value is DailyPost {
  if (typeof value !== "object" || value === null) return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.eventKey === "string" &&
    isSocialSnapshot(p.figures) &&
    (p.tweetId === null || typeof p.tweetId === "string")
  );
}

function isSwapFigures(value: unknown): value is SwapFigures {
  if (typeof value !== "object" || value === null) return false;
  const f = value as Record<string, unknown>;
  return (
    typeof f.transferId === "string" &&
    typeof f.timestamp === "number" &&
    typeof f.zecAmountZat === "number" &&
    (f.usdAtSwap === null || typeof f.usdAtSwap === "number") &&
    typeof f.counterpartAsset === "string" &&
    typeof f.counterpartChain === "string" &&
    typeof f.counterpartChainName === "string" &&
    typeof f.counterpartAmount === "number" &&
    typeof f.counterpartIsNative === "boolean" &&
    typeof f.venue === "string" &&
    typeof f.zcashTxid === "string"
  );
}

/**
 * A boundary crossing's stored figures, shape-checked as a version-skew tripwire. The deep
 * check — which pools may be named and which directions drawn — is `boundaryIsComplete`,
 * run before the card renders; duplicating it here would give the two room to drift.
 */
function isBoundaryFigures(value: unknown): value is BoundaryFigures {
  if (typeof value !== "object" || value === null) return false;
  const f = value as Record<string, unknown>;
  return (
    typeof f.txid === "string" &&
    typeof f.blockHeight === "number" &&
    typeof f.timestamp === "number" &&
    (f.priceUsd === null || typeof f.priceUsd === "number") &&
    Array.isArray(f.pools) &&
    f.pools.every(
      (p) =>
        typeof p === "object" &&
        p !== null &&
        typeof (p as Record<string, unknown>).pool === "string" &&
        typeof (p as Record<string, unknown>).valueBalanceZat === "number",
    )
  );
}

function isBoundaryPost(value: unknown): value is SocialPost<BoundaryFigures> {
  if (typeof value !== "object" || value === null) return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.eventKey === "string" &&
    isBoundaryFigures(p.figures) &&
    (p.tweetId === null || typeof p.tweetId === "string")
  );
}

function isSwapPost(value: unknown): value is SocialPost<SwapFigures> {
  if (typeof value !== "object" || value === null) return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.eventKey === "string" &&
    isSwapFigures(p.figures) &&
    (p.tweetId === null || typeof p.tweetId === "string")
  );
}

/**
 * A published social post of the given ledger kind. `kind` picks the guard because the stored
 * `figures` carry no self-describing tag.
 */
export function isSocialPost(
  kind: string,
  value: unknown,
): value is SocialPost<SocialSnapshot | SwapFigures | BoundaryFigures> {
  if (kind === SWAP_KIND || kind === SWAP_DRYRUN_KIND) return isSwapPost(value);
  if (
    kind === SHIELDING_KIND ||
    kind === SHIELDING_DRYRUN_KIND ||
    kind === UNSHIELDING_KIND ||
    kind === UNSHIELDING_DRYRUN_KIND
  ) {
    return isBoundaryPost(value);
  }
  return isDailyPost(value);
}
