import type { AllPoolsSupply } from "@/domain";
import { shareOfMaxSupplyPct } from "@/domain";
import { StatCard } from "@/components/StatCard";
import { StatGrid } from "@/components/StatGrid";
import { Unmeasured } from "@/components/Unmeasured";
import { formatSharePct, formatZec, formatZecSupply } from "@/lib/format";

export interface SupplyOverviewProps {
  supply: AllPoolsSupply;
}

/** An amount with its exact figure on hover, or "unavailable": never a stand-in number. */
function Amount({ zat }: { zat: number | null }) {
  if (zat === null) return <Unmeasured />;
  return <span title={formatZec(zat)}>{formatZecSupply(zat)}</span>;
}

/** The four totals the cards below add up to, each naming what its share is of. */
export function SupplyOverview({ supply }: SupplyOverviewProps) {
  const { issuedZat, circulatingZat, shieldedSharePct, unminedZat } = supply;
  return (
    <StatGrid columns={4}>
      <StatCard
        label="ISSUED"
        value={<Amount zat={issuedZat} />}
        sub={
          issuedZat === null ? "of 21M" : `${formatSharePct(shareOfMaxSupplyPct(issuedZat))} of 21M`
        }
      />
      <StatCard label="CIRCULATING" value={<Amount zat={circulatingZat} />} sub="spendable today" />
      <StatCard
        label="SHIELDED"
        value={shieldedSharePct === null ? <Unmeasured /> : formatSharePct(shieldedSharePct)}
        sub="of circulating"
      />
      <StatCard
        label="STILL TO MINE"
        value={<Amount zat={unminedZat} />}
        sub={
          unminedZat === null
            ? "of 21M"
            : `${formatSharePct(shareOfMaxSupplyPct(unminedZat))} of 21M`
        }
      />
    </StatGrid>
  );
}
