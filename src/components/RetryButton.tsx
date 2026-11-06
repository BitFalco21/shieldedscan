"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

export interface RetryButtonProps {
  /** Runs after the refresh is requested; the error boundary passes its `reset` here. */
  onRetry?: () => void;
}

/**
 * Asks the server for this page again. `router.refresh()` re-runs the server render without
 * the cached payload that failed; the transition keeps the button visibly busy until the new
 * render lands. On an edge-cached route the CDN may answer the first try with its stored copy
 * (`lib/edge-cache.ts`); a second try reaches a fresh render.
 */
export function RetryButton({ onRetry }: RetryButtonProps) {
  const router = useRouter();
  const [retrying, startTransition] = useTransition();

  function retry() {
    startTransition(() => {
      router.refresh();
      onRetry?.();
    });
  }

  return (
    <button
      type="button"
      onClick={retry}
      disabled={retrying}
      aria-busy={retrying}
      className="panel min-h-11 min-w-11 cursor-pointer px-5 py-2 text-sm text-ink hover:text-green disabled:cursor-wait disabled:opacity-60"
    >
      {retrying ? "Retrying…" : "Try again"}
    </button>
  );
}
