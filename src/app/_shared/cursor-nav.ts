import { ORIGIN_CURSOR } from "@/data";

/** One end of a keyset page, as a query parameter. */
export interface CursorStep {
  name: "before" | "after";
  value: string;
}

/** The four links a cursor-paginated list renders, as its page component's props. */
export interface CursorNavHrefs {
  newerHref: string | null;
  olderHref: string | null;
  newestHref: string | null;
  oldestHref: string | null;
}

/**
 * The newer, older, newest and oldest links of a keyset page, from its cursors and a builder
 * that keeps the page's other query parameters. A link is null when the reader is already there.
 *
 * "Oldest" pages `after` `ORIGIN_CURSOR`, a sort key below every real row, so the far end is one
 * hop away with no `COUNT(*)` and no offset.
 */
export function cursorNavHrefs(
  page: { nextCursor: string | null; prevCursor: string | null },
  href: (step?: CursorStep) => string,
): CursorNavHrefs {
  return {
    newerHref: page.prevCursor ? href({ name: "after", value: page.prevCursor }) : null,
    olderHref: page.nextCursor ? href({ name: "before", value: page.nextCursor }) : null,
    newestHref: page.prevCursor ? href() : null,
    oldestHref: page.nextCursor ? href({ name: "after", value: ORIGIN_CURSOR }) : null,
  };
}
