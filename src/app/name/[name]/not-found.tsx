import Link from "@/components/Link";
import { NotFoundExplorerChip } from "@/features/name/NotFoundExplorerChip";

/**
 * A name nobody has registered: still a real 404, but one that says what it is
 * rather than the generic dead end. It does not say "available": some names are held back as
 * protected names, and during the registry's beta only invited testers can claim at all.
 */
export default function NameNotFound() {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 text-center">
      <div className="microlabel">ZCASH NAME</div>
      <h1 className="text-2xl font-bold tracking-tight text-ink-bright">
        No one has registered this name
      </h1>
      <p className="max-w-md text-sm text-ink-dim">It is not in the Zcash Name System registry.</p>
      {/* The registry's own page for the name is the next step, so it is the green chip; the way
          back stays beside it as a plain panel. */}
      <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
        <NotFoundExplorerChip />
        <Link href="/" className="panel px-5 py-1.5 text-sm hover:text-green">
          ← back to overview
        </Link>
      </div>
    </div>
  );
}
