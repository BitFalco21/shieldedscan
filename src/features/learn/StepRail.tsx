export interface StepRailItem {
  label: string;
  done: boolean;
  /** Why the step can be passed by: "not needed", "skipped", or "optional" before it is reached. */
  tag?: string;
}

export interface StepRailProps {
  items: readonly StepRailItem[];
  current: number;
  onSelect: (index: number) => void;
}

/** The six real steps. Any step can be opened: the guide advises an order, it does not enforce one. */
export function StepRail({ items, current, onSelect }: StepRailProps) {
  return (
    <nav
      aria-label="Steps"
      className="grid grid-cols-3 gap-1.5 md:sticky md:top-4 md:grid-cols-1 md:gap-0.5"
    >
      {items.map((item, i) => {
        const here = i === current;
        const skipped = !item.done && (item.tag === "not needed" || item.tag === "skipped");
        return (
          <button
            key={item.label}
            type="button"
            aria-current={here ? "step" : undefined}
            onClick={() => onSelect(i)}
            className={`grid cursor-pointer grid-cols-[auto_1fr] items-baseline gap-x-2 rounded-sm border px-2 py-1.5 text-left text-xs transition-colors md:grid-cols-[auto_auto_1fr] md:text-sm ${
              here
                ? "border-edge bg-green-wash text-ink-bright"
                : `border-edge-faint md:border-transparent ${skipped ? "text-ink-faint" : "text-ink-dim"} hover:text-ink`
            }`}
          >
            <span
              aria-hidden
              className={`whitespace-nowrap ${item.done || here ? "text-green" : "text-ink-faint"}`}
            >
              {item.done ? "[✓]" : skipped ? "[–]" : here ? "[▸]" : "[ ]"}
            </span>
            <span aria-hidden className="hidden text-ink-faint tabular-nums md:inline">
              {String(i + 1).padStart(2, "0")}
            </span>
            <span>
              {item.label}
              {item.done ? <span className="sr-only"> (done)</span> : null}
              {item.tag ? (
                <span className="block text-[11px] text-ink-faint">{item.tag}</span>
              ) : null}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
