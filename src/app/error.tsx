"use client";

import { useEffect, useTransition } from "react";
import Link from "@/components/Link";
import { useRouter } from "next/navigation";

/**
 * The route error boundary.
 *
 * "Try again" needs `router.refresh()`, not `reset()` alone. `reset()` re-renders this
 * boundary's subtree, but for a Server Component failure the router still holds the cached payload that failed, so
 * the re-render reaches the same dead state and the page visibly does not change.
 * `refresh()` discards that cache and re-runs the server render; `reset()` then clears the
 * boundary so the fresh result can mount. Both, in that order.
 *
 * It can still fail again, honestly so: while the API is unreachable every retry re-throws.
 * That is why there is also a way out to the homepage — a button that can only ever loop is
 * worse than no button. `useTransition` stops the retry from looking inert while the server
 * render is in flight.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();
  const [retrying, startTransition] = useTransition();

  useEffect(() => {
    console.error(error);
  }, [error]);

  function retry() {
    startTransition(() => {
      router.refresh();
      reset();
    });
  }

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 text-center">
      <div className="microlabel">SOMETHING BROKE</div>
      <h1 className="text-2xl font-bold tracking-tight text-ink-bright">
        This page failed to render — that&apos;s on us, not the chain
      </h1>
      <p className="max-w-md text-sm text-ink-dim">
        Nothing was lost and nothing is hidden; the explorer hit an error building this view.
      </p>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={retry}
          disabled={retrying}
          aria-busy={retrying}
          className="panel cursor-pointer px-5 py-2 text-sm hover:text-green disabled:cursor-wait disabled:opacity-60"
        >
          {retrying ? "Retrying…" : "Try again"}
        </button>
        <Link href="/" className="text-sm text-ink-dim hover:text-green">
          back to overview
        </Link>
      </div>
      {/* The digest is the only handle on a server error whose message production withholds
          from the browser. Shown quietly, so a report can name it. */}
      {error.digest ? (
        <p className="mt-1 text-[11px] text-ink-faint">error {error.digest}</p>
      ) : null}
    </div>
  );
}
