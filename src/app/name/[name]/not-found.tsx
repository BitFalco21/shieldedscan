import Link from "@/components/Link";
import { NotFoundExplorerChip } from "@/features/name/NotFoundExplorerChip";
import { ZNS_REFERRAL_URL } from "@/lib/links";

/**
 * A name nobody has registered: still a real 404, but one that says what it is
 * rather than the generic dead end. It does not say "available": some names are held back as
 * protected names, and the registry opens claiming in stages, so it offers to reserve a name.
 */
export default function NameNotFound() {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 text-center">
      <div className="microlabel">ZCASH NAME</div>
      <h1 className="text-2xl font-bold tracking-tight text-ink-bright">
        No one has registered this name
      </h1>
      <p className="max-w-md text-sm text-ink-dim">It is not in the Zcash Name System registry.</p>
      {/* Reserving a name is the reader's next step, so it is the green chip, labelled as the
          referral it is; the registry's own page for this name and the way back stay beside it. */}
      <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
        <a
          data-zns-referral
          href={ZNS_REFERRAL_URL}
          target="_blank"
          rel="sponsored noopener noreferrer"
          className="btn btn-primary inline-flex items-center gap-1.5 text-sm whitespace-nowrap"
        >
          reserve a name on zcashnames.com <span aria-hidden="true">↗</span>
        </a>
        <NotFoundExplorerChip tone="secondary" />
        <Link href="/" className="btn btn-secondary text-sm">
          ← back to overview
        </Link>
      </div>
      <p className="text-xs text-ink-faint">
        Referral link: a name reserved through it credits ShieldedScan.
      </p>
    </div>
  );
}
