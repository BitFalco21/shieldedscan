import type { BreadcrumbItem } from "@/components/Breadcrumb";
import { DataUnavailable } from "@/components/DataUnavailable";
import { PageHeader } from "@/components/PageHeader";

export interface SubjectUnavailableProps {
  /** The trail the detail page would show, ending in the kind of subject. */
  breadcrumb: readonly BreadcrumbItem[];
  /** What the reader asked for, exactly as asked: an address, a txid, a height or hash. */
  subject: string;
  /** The unavailable panel's subject, e.g. "This address". */
  what: string;
}

/**
 * A detail page whose subject could not be read: the page's own header, so the reader still sees
 * what they asked for, over one unavailable panel. Not a not-found: whether the subject exists
 * is exactly what we failed to learn.
 */
export function SubjectUnavailable({ breadcrumb, subject, what }: SubjectUnavailableProps) {
  return (
    <>
      <PageHeader breadcrumb={breadcrumb} titleVariant="identifier" title={subject} />
      <DataUnavailable what={what} className="mt-3" />
    </>
  );
}
