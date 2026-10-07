import type { ReactNode } from "react";

export interface StageToolbarProps {
  threeD: boolean;
  onMode: (threeD: boolean) => void;
  onZoom: (factor: number) => void;
  onSearch: () => void;
  onReset: () => void;
  onSnapshot: () => void;
  snapshotBusy: boolean;
}

/**
 * The stage's control column: 2D/3D, zoom for anyone without a wheel or a trackpad, search,
 * back to the starting view, and a PNG of what is on screen. Every control has a spoken name
 * and a tooltip, because an icon alone names nothing to a screen reader.
 */
export function StageToolbar({
  threeD,
  onMode,
  onZoom,
  onSearch,
  onReset,
  onSnapshot,
  snapshotBusy,
}: StageToolbarProps) {
  return (
    <div className="flex flex-col items-end gap-2">
      <div
        role="group"
        aria-label="View"
        className="flex flex-col overflow-hidden rounded-md border border-edge bg-panel"
      >
        {([true, false] as const).map((d) => (
          <button
            key={String(d)}
            type="button"
            aria-pressed={threeD === d}
            onClick={() => onMode(d)}
            className={`eco-tool-mode ${threeD === d ? "is-on" : ""}`}
          >
            {d ? "3D" : "2D"}
          </button>
        ))}
      </div>
      <Tool label="Zoom in" onClick={() => onZoom(1.4)}>
        <path d="M12 5v14M5 12h14" />
      </Tool>
      <Tool label="Zoom out" onClick={() => onZoom(1 / 1.4)}>
        <path d="M5 12h14" />
      </Tool>
      <Tool label="Search projects ( / )" onClick={onSearch}>
        <circle cx="11" cy="11" r="6" />
        <path d="m20 20-4.5-4.5" />
      </Tool>
      <Tool label="Reset view" onClick={onReset}>
        <circle cx="12" cy="12" r="7" />
        <circle cx="12" cy="12" r="2" />
        <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
      </Tool>
      <Tool
        label={snapshotBusy ? "Saving snapshot…" : "Download a PNG snapshot"}
        onClick={onSnapshot}
        disabled={snapshotBusy}
      >
        <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
        <circle cx="12" cy="13" r="3.5" />
      </Tool>
    </div>
  );
}

function Tool({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="eco-tool"
    >
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
        {children}
      </svg>
    </button>
  );
}
