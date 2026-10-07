import { PageHeader } from "@/components/PageHeader";

/**
 * The heading both compare views open with, shared so the eyebrow, title and lede cannot
 * drift between the two tabs.
 */
export function CompareHeader() {
  return (
    <PageHeader
      eyebrow="MARKET"
      title="Compare"
      lede="What one ZEC would be worth if Zcash carried another asset's market capitalisation. Exact arithmetic over public figures — nothing here is a forecast, and nothing here is advice."
    />
  );
}
