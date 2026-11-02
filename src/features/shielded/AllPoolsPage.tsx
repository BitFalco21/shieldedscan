import type { SupplyBreakdown } from "@/domain";
import { PageHeader } from "@/components/PageHeader";
import { AllPoolsLive } from "./AllPoolsLive";
import { ShieldedViewTabs } from "./ShieldedViewTabs";

export interface AllPoolsPageProps {
  supply: SupplyBreakdown;
}

/** `/shielded`: every ZEC of the 21M, by where it sits. The header stays server-rendered. */
export function AllPoolsPage({ supply }: AllPoolsPageProps) {
  return (
    <>
      <PageHeader eyebrow="SHIELDED" title="Every ZEC, in every pool">
        <ShieldedViewTabs active="all" />
      </PageHeader>
      <AllPoolsLive initial={supply} />
    </>
  );
}
