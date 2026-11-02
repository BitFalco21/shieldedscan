export interface SupplyPartKeyProps {
  /** The part's ink class, from `supplyPartMeta`. */
  ink: string;
}

/**
 * A part's colour key, shared by the bar's legend and the cards so one finds the other. Outlined,
 * so the key for "still to mine" (the bar's own faint track) stays visible.
 */
export function SupplyPartKey({ ink }: SupplyPartKeyProps) {
  return (
    <svg viewBox="0 0 10 10" className={`size-2.5 shrink-0 border border-edge ${ink}`} aria-hidden>
      <rect width="10" height="10" fill="currentColor" />
    </svg>
  );
}
