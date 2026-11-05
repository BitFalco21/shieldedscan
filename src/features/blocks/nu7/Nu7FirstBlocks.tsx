import { NU7_HEIGHT, targetSpacingAt, type BlockSummary } from "@/domain";
import Link from "@/components/Link";
import { formatCount } from "@/lib/format";
import { firstNu7Intervals } from "./nu7-countdown";

export interface Nu7FirstBlocksProps {
  /** The activation block and the blocks after it that exist, in any order. */
  blocks: readonly BlockSummary[];
}

/** The bar's scale: the old target, so the new one sits at a third. */
const SCALE = targetSpacingAt(NU7_HEIGHT - 1);
const TARGET = targetSpacingAt(NU7_HEIGHT);

/**
 * The first blocks under NU7, each against the new 25 s target: the beat getting faster, from the
 * chain's own timestamps. Omitted until a block after the activation exists. Miner timestamps
 * can run backwards, so a negative interval prints as it is and draws no bar.
 */
export function Nu7FirstBlocks({ blocks }: Nu7FirstBlocksProps) {
  const rows = firstNu7Intervals(blocks);
  if (rows.length === 0) return null;
  return (
    <section aria-labelledby="nu7-first" className="panel mt-3 p-4 sm:p-5">
      <h2 id="nu7-first" className="microlabel mb-3 text-ink-faint">
        first NU7 blocks · time since the previous one ·{" "}
        <span className="text-warn">{TARGET} s target</span>
      </h2>
      <ul className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 text-xs">
        {rows.map((row) => (
          <li key={row.height} className="contents">
            <Link href={`/block/${row.height}`} className="text-green">
              #{formatCount(row.height)}
            </Link>
            <svg
              aria-hidden="true"
              viewBox={`0 0 ${SCALE} 10`}
              preserveAspectRatio="none"
              className="h-2.5 w-full overflow-visible"
            >
              <rect width={SCALE} height="10" className="fill-green-faint opacity-40" />
              <rect
                width={Math.min(SCALE, Math.max(0, row.seconds))}
                height="10"
                className="fill-green-dim"
              />
              <rect x={TARGET - 0.5} y="-3" width="1" height="16" className="fill-warn" />
            </svg>
            <span className="text-right text-ink-dim tabular-nums">{row.seconds} s</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
