import { TableSkeleton } from "@/components/TableSkeleton";
import { PageHeader } from "@/components/PageHeader";

/**
 * Table-shaped skeleton for `/blocks`, replacing the generic root skeleton
 * with one shaped like the six-column table that is actually arriving
 * (HEIGHT, HASH, TXS, POOLS, SIZE, TIME).
 */
export default function Loading() {
  return (
    <>
      <PageHeader eyebrow="CHAIN" title="Blocks" />
      <TableSkeleton columns={6} rows={8} />
    </>
  );
}
