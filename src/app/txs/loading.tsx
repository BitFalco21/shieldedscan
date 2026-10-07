import { TableSkeleton } from "@/components/TableSkeleton";
import { PageHeader } from "@/components/PageHeader";

/**
 * Table-shaped skeleton for `/txs`, replacing the generic root skeleton with
 * one shaped like the five-column table that is actually arriving (TX, KIND,
 * BLOCK, VALUE, TIME). The filter chips are omitted here — they depend on the
 * active `kind` query param, not on data, so they're free to render with the
 * page's own content once it resolves rather than being faked here.
 */
export default function Loading() {
  return (
    <>
      <PageHeader eyebrow="CHAIN" title="Transactions" />
      <TableSkeleton columns={5} rows={8} />
    </>
  );
}
