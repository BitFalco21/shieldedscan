import Link from "@/components/Link";
import { CopyButton } from "@/components/CopyButton";
import { shortHash } from "@/lib/format";

export interface HashLinkProps {
  value: string;
  href: string;
  edge?: number;
  /** Render a copy button carrying the full, untruncated `value` alongside the link. */
  copyable?: boolean;
  /**
   * What the copy button says it copies — "block hash", not "hash". Name it wherever a page
   * carries hashes of several kinds, or a screen reader hears a dozen buttons all called
   * "copy hash".
   */
  copyLabel?: string;
}

/**
 * Stays a Server Component: only `CopyButton` (rendered conditionally) needs
 * the client boundary, so this component's own markup never does.
 */
export function HashLink({
  value,
  href,
  edge = 4,
  copyable = false,
  copyLabel = "hash",
}: HashLinkProps) {
  // One inline-flex box keeps the copy button attached to the hash it copies: as two siblings
  // under a `justify-between` parent, they would spread to opposite ends of the row.
  return (
    <span className="inline-flex min-w-0 items-center">
      <Link href={href} title={value} className="text-green hover:underline">
        {shortHash(value, edge)}
      </Link>
      {copyable ? <CopyButton value={value} label={copyLabel} /> : null}
    </span>
  );
}
