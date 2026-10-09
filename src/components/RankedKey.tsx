import { formatSharePct } from "@/lib/format";

export interface RankedKeyItem {
  key: string;
  label: string;
  /** The class colouring this series on the chart, so the swatch matches its segments. */
  colorClass: string;
  value: number;
}

export interface RankedKeyProps {
  items: RankedKeyItem[];
  /** What the figures cover: the period, and the total the shares are of. */
  caption: string;
  formatValue: (value: number) => string;
  /** Keys kept at the bottom whatever their size: a fold of the rest does not rank among them. */
  pinnedLast?: readonly string[];
  highlighted: string | null;
  onHighlight: (key: string | null) => void;
}

/**
 * A chart's legend as a ranked table: each series, largest first, with its amount and its share
 * of the total the caption names. It answers "which matters most" without a hover, and pointing
 * at a row brings that series forward on the chart.
 */
export function RankedKey({
  items,
  caption,
  formatValue,
  pinnedLast = [],
  highlighted,
  onHighlight,
}: RankedKeyProps) {
  const total = items.reduce((sum, item) => sum + item.value, 0);
  const pinned = (key: string) => pinnedLast.includes(key);
  const ranked = [...items].sort(
    (a, b) => Number(pinned(a.key)) - Number(pinned(b.key)) || b.value - a.value,
  );
  return (
    <table className="w-full text-xs tabular-nums" onPointerLeave={() => onHighlight(null)}>
      <caption className="microlabel pb-2 text-left text-ink-faint">{caption}</caption>
      <tbody>
        {ranked.map((item) => (
          <tr
            key={item.key}
            onPointerEnter={() => onHighlight(item.key)}
            className={`border-t border-edge-faint transition-opacity motion-reduce:transition-none ${
              highlighted !== null && highlighted !== item.key ? "opacity-35" : ""
            }`}
          >
            <th scope="row" className="py-1.5 text-left font-normal text-ink">
              <span className="flex items-center gap-2">
                <span aria-hidden className={`inline-flex ${item.colorClass}`}>
                  <span className="chart-band inline-block h-2.5 w-2.5 bg-current" />
                </span>
                {item.label}
              </span>
            </th>
            <td className="py-1.5 pl-3 text-right text-ink">{formatValue(item.value)}</td>
            <td className="w-14 py-1.5 text-right text-ink-faint">
              {total > 0 ? formatSharePct((100 * item.value) / total) : "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
