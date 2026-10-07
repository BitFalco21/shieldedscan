import type { MinerGroup } from "@/domain";
import { HashLink } from "@/components/HashLink";
import { formatCount } from "@/lib/format";

/**
 * How a miner is named on this page — and, always, on what authority.
 *
 * The basis is never hidden behind a tooltip. A reader looking at a hashrate table is
 * looking at claims of very different strength sitting in one column: "Foundry USA" because
 * Foundry wrote that into its own coinbase and anyone can check it, versus a name we took
 * from a list somebody else maintains, versus an address that names itself nowhere. Printing
 * all three identically would launder the weakest into the authority of the strongest. That
 * is why the basis is rendered beside the name rather than the name standing alone — and it
 * is the pattern any future address labelling should copy, since the problem is identical.
 *
 * An unattributed miner is shown as its payout address, linked, because that is the honest
 * identifier and it is checkable. A shielded coinbase has no address at all and says so.
 */
export interface MinerNameProps {
  group: MinerGroup;
}

export function MinerName({ group }: MinerNameProps) {
  if (group.address === null) {
    return (
      <span className="inline-flex flex-col">
        <span className="text-sm text-ink">shielded coinbase</span>
        <span className="text-[10px] tracking-[0.08em] text-ink-faint">
          reward paid into a pool — no address
        </span>
      </span>
    );
  }

  if (group.name === null) {
    return (
      <span className="inline-flex flex-col">
        <HashLink value={group.address} href={`/address/${group.address}`} edge={8} />
        <span className="text-[10px] tracking-[0.08em] text-ink-faint">names itself nowhere</span>
      </span>
    );
  }

  return (
    <span className="inline-flex flex-col">
      <span className="text-sm font-semibold text-ink-bright">{group.name}</span>
      <span className="text-[10px] tracking-[0.08em] text-ink-faint">
        {group.basis === "self-declared"
          ? `self-declared in ${formatCount(group.selfDeclaredBlocks)} of ${formatCount(group.blocks)}`
          : "named from an off-chain list"}
      </span>
    </span>
  );
}
