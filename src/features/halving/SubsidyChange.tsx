import type { HalvingEvent } from "@/domain";
import { FlushEnd } from "@/components/FlushEnd";
import { formatDeltaPct, formatZecAmount } from "@/lib/format";

export interface SubsidyChangeProps {
  next: HalvingEvent;
}

/** The before/after split, per recipient — the shape that makes the miner finding visible. */
export function SubsidyChange({ next }: SubsidyChangeProps) {
  const rows: { label: string; before: number; after: number }[] = [
    { label: "Total subsidy", before: next.before.totalZat, after: next.after.totalZat },
    { label: "To the miner", before: next.before.minerZat, after: next.after.minerZat },
    {
      label: "Funding streams",
      before: next.before.fundingStreamsZat,
      after: next.after.fundingStreamsZat,
    },
    { label: "Lockbox", before: next.before.lockboxZat, after: next.after.lockboxZat },
  ];

  return (
    <div className="overflow-x-auto">
      <table className="data-table w-full min-w-[24rem] text-sm">
        <caption className="sr-only">
          The block subsidy before and after the next halving, per recipient
        </caption>
        <thead>
          <tr className="microlabel text-left">
            <th className="border-b border-edge-faint pb-2 font-normal">PER BLOCK (ZEC)</th>
            <th className="border-b border-edge-faint pb-2 text-right font-normal">
              <FlushEnd>NOW</FlushEnd>
            </th>
            <th className="border-b border-edge-faint pb-2 text-right font-normal">
              <FlushEnd>AFTER</FlushEnd>
            </th>
            <th className="border-b border-edge-faint pb-2 text-right font-normal">
              <FlushEnd>CHANGE</FlushEnd>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const ends = row.before > 0 && row.after === 0;
            const pct = row.before === 0 ? 0 : (row.after / row.before - 1) * 100;
            return (
              <tr key={row.label} className="hairline-b last:border-0">
                <td className="text-ink-dim">{row.label}</td>
                <td className="text-right font-mono whitespace-nowrap text-ink-dim">
                  {formatZecAmount(row.before)}
                </td>
                <td className="text-right font-mono whitespace-nowrap text-ink-bright">
                  {formatZecAmount(row.after)}
                </td>
                <td className="text-right font-mono whitespace-nowrap">
                  {row.before === 0 ? (
                    <span className="text-ink-faint">—</span>
                  ) : ends ? (
                    <span className="text-warn">ends</span>
                  ) : (
                    <span className="text-red">−{formatDeltaPct(pct)}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
