import { PaginationStep } from "@/components/PaginationStep";

export interface CursorPaginationProps {
  /** Href for the previous (newer) page; null disables the control. */
  newerHref: string | null;
  /** Href for the next (older) page; null disables the control. */
  olderHref: string | null;
  /** Href for the head of the list; null when the head is already on screen. */
  newestHref: string | null;
  /** Href for the final page; null when it is already on screen. */
  oldestHref: string | null;
  /**
   * What sits between the controls — a page ordinal where one honestly exists, nothing where
   * it does not. On a keyset list an ordinal only exists when it is derivable without a
   * COUNT(*): `/blocks` computes one from heights; the timestamp-sorted lists show only the
   * controls.
   */
  rangeLabel?: string | null;
}

/**
 * Keyset ("cursor") pagination control. A page ordinal appears only where one is
 * derivable without a COUNT(*) — `/blocks` computes "page x of y" from heights, which are
 * dense; the timestamp-sorted lists have no honest ordinal and show only the controls.
 * Use {@link Pagination} instead for the one page that still pages by offset
 * (`/mempool` — the mempool is a bounded snapshot, so a page count there is honest).
 *
 * The ends are reachable in one hop even so: "oldest" is a seek from the far end of the
 * index rather than a jump to a counted page — see `ORIGIN_CURSOR`.
 */
export function CursorPagination({
  newerHref,
  olderHref,
  newestHref,
  oldestHref,
  rangeLabel = null,
}: CursorPaginationProps) {
  return (
    <nav
      aria-label="Pagination"
      className="mt-4 flex flex-wrap items-center justify-center gap-2 text-sm text-ink-dim"
    >
      {/*
        Words for the jumps, arrows for the steps: "first"/"last" land somewhere definite,
        while the arrows move one page. Every control keeps a spoken name — see
        `PaginationStep.description` — because a bare arrow has none.
      */}
      <PaginationStep href={newestHref} label="« first" description="First page — newest" />
      <PaginationStep href={newerHref} label="←" description="Newer page" />
      {rangeLabel != null ? (
        <span className="px-1 text-xs text-ink-faint" aria-live="polite">
          {rangeLabel}
        </span>
      ) : null}
      <PaginationStep href={olderHref} label="→" description="Older page" />
      <PaginationStep href={oldestHref} label="last »" description="Last page — oldest" />
    </nav>
  );
}
