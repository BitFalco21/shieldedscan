import { NU7_HEIGHT, type BlockSummary } from "@/domain";
import { PageHeader } from "@/components/PageHeader";
import { formatCount } from "@/lib/format";
import { Nu7Countdown } from "./Nu7Countdown";

export interface Nu7CountdownPageProps {
  tipHeight: number;
  tipTimestamp: number;
  recent: readonly BlockSummary[];
}

/**
 * What `/block/3543405` shows on mainnet until that block exists: the activation height is a
 * page people open before it can answer, so it counts down instead of answering 404.
 */
export function Nu7CountdownPage({ tipHeight, tipTimestamp, recent }: Nu7CountdownPageProps) {
  return (
    <>
      <PageHeader
        breadcrumb={[
          { label: "HOME", href: "/" },
          { label: "BLOCKS", href: "/blocks" },
          { label: `#${formatCount(NU7_HEIGHT)}` },
        ]}
        title={`NU7 activates at block #${formatCount(NU7_HEIGHT)}`}
      />
      <Nu7Countdown tipHeight={tipHeight} tipTimestamp={tipTimestamp} recent={recent} />
    </>
  );
}
