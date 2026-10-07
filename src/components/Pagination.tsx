import { PaginationStep } from "@/components/PaginationStep";

export interface PaginationProps {
  page: number;
  totalPages: number;
  hrefFor: (p: number) => string;
}

/**
 * Offset pagination, for `/mempool`: the mempool is a bounded snapshot, so a page count there is
 * honest. Same controls and same words as {@link CursorPagination}, so the difference underneath
 * stays underneath.
 */
export function Pagination({ page, totalPages, hrefFor }: PaginationProps) {
  const newer = page > 1;
  const older = page < totalPages;
  return (
    <nav
      aria-label="Pagination"
      className="mt-4 flex flex-wrap items-center justify-center gap-2 text-sm text-ink-dim"
    >
      <PaginationStep
        href={newer ? hrefFor(1) : null}
        label="« first"
        description="First page — newest"
      />
      <PaginationStep href={newer ? hrefFor(page - 1) : null} label="←" description="Newer page" />
      <span className="px-1 text-xs text-ink-faint" aria-current="page">
        {page} / {totalPages}
      </span>
      <PaginationStep href={older ? hrefFor(page + 1) : null} label="→" description="Older page" />
      <PaginationStep
        href={older ? hrefFor(totalPages) : null}
        label="last »"
        description="Last page — oldest"
      />
    </nav>
  );
}
