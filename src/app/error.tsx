"use client";

import { useEffect } from "react";
import Link from "@/components/Link";
import { RetryButton } from "@/components/RetryButton";
import { UPSTREAM_UNAVAILABLE_DIGEST } from "@/lib/transient-upstream";

/**
 * The route error boundary.
 *
 * Two different failures land here. A read the page cannot stand without timed out or the API
 * is down: the data source stamps such a failure with `UPSTREAM_UNAVAILABLE_DIGEST`, and the
 * page says it did not load. Anything else is a bug of ours and says so.
 *
 * "Try again" needs `router.refresh()`, not `reset()` alone. `reset()` re-renders this
 * boundary's subtree, but for a Server Component failure the router still holds the cached payload that failed, so
 * the re-render reaches the same dead state and the page visibly does not change.
 * `refresh()` discards that cache and re-runs the server render; `reset()` then clears the
 * boundary so the fresh result can mount. Both, in that order.
 *
 * It can still fail again, honestly so: while the API is unreachable every retry re-throws.
 * That is why there is also a way out to the homepage — a button that can only ever loop is
 * worse than no button.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const unavailable = error.digest === UPSTREAM_UNAVAILABLE_DIGEST;

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 text-center">
      <div className={`microlabel ${unavailable ? "text-warn" : ""}`}>
        {unavailable ? "TEMPORARILY UNAVAILABLE" : "SOMETHING BROKE"}
      </div>
      <h1 className="text-2xl font-bold tracking-tight text-ink-bright">
        {unavailable ? (
          "This page didn't load"
        ) : (
          <>This page failed to render — that&apos;s on us, not the chain</>
        )}
      </h1>
      <p className="max-w-md text-sm text-ink-dim">
        {unavailable
          ? "The data behind it could not be read just now. Nothing here is estimated in its place."
          : "Nothing was lost and nothing is hidden; the explorer hit an error building this view."}
      </p>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
        <RetryButton onRetry={reset} />
        <Link
          href="/"
          className="inline-flex min-h-11 items-center text-sm text-ink-dim hover:text-green"
        >
          back to overview
        </Link>
      </div>
      {/* The digest is the only handle on a server error whose message production withholds
          from the browser. Shown quietly, so a report can name it. */}
      {error.digest && !unavailable ? (
        <p className="mt-1 text-[11px] text-ink-faint">error {error.digest}</p>
      ) : null}
    </div>
  );
}
