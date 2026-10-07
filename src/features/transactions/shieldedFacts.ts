import type { Transaction } from "@/domain";
import { netShieldedZat, reportsValueBalance } from "@/domain";
import { formatZec } from "@/lib/format";

/**
 * Generate fact labels and values for shielded pool components in a transaction.
 * Exported for direct testing of the NET TO POOL and SPROUT JOINSPLITS logic.
 */
export function shieldedFacts(tx: Transaction): { label: string; value: string }[] {
  const facts: { label: string; value: string }[] = [];
  // `reportsValueBalance`, not `hasShielded`: Sprout publishes no balance, so a Sprout-only
  // transaction must show no net at all rather than a fabricated 0.00.
  if (reportsValueBalance(tx)) {
    // Across every pool, so an Orchard→Ironwood migration nets to the fee that actually left
    // the shielded side rather than to the whole migrated amount.
    const net = netShieldedZat(tx);
    // "NET TO SHIELDED", not "NET TO POOL": `netShieldedZat` sums every pool, so on a migration
    // this is the fee that left the shielded side altogether, not what the pool named in the panel
    // title did.
    facts.push({ label: "NET TO SHIELDED", value: `${net > 0 ? "+" : ""}${formatZec(net)}` });
  }
  if (tx.ironwood) facts.push({ label: "IRONWOOD ACTIONS", value: String(tx.ironwood.actions) });
  if (tx.orchard) facts.push({ label: "ORCHARD ACTIONS", value: String(tx.orchard.actions) });
  if (tx.sapling)
    facts.push({
      label: "SAPLING SPENDS/OUTPUTS",
      value: `${tx.sapling.spends}/${tx.sapling.outputs}`,
    });
  if (tx.sprout) facts.push({ label: "SPROUT JOINSPLITS", value: String(tx.sprout.joinSplits) });
  return facts;
}
