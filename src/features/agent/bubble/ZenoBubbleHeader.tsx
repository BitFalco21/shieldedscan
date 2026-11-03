import type { MouseEvent } from "react";
import Link from "@/components/Link";
import { ZenoLive } from "../ZenoLive";
import type { ZenoTurn } from "../zeno-mood";

export interface ZenoBubbleHeaderProps {
  turn: ZenoTurn | null;
  /** A turn is running: ↗ would end it (the bubble unmounts on `/ai-agent`), so it waits. */
  busy: boolean;
  onContinue: (event: MouseEvent<HTMLAnchorElement>) => void;
  onClose: () => void;
}

/** The control row's square targets: 44px on a phone, compact beside a mouse. */
const TARGET =
  "inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded text-ink-dim hover:text-green sm:size-8";

/**
 * Zeno's head, the wordmark and what he answers from; then ↗ and close. `clear` sits at the top of
 * the transcript, as on the console: the header is too narrow for a third control and the line.
 *
 * The wordmark is the console's type (weight, tracking, colour) without its glow and raster: the
 * glow budget names the console's readout, not a corner of every page, and the raster on small
 * type is grey haze (`agent.css`).
 */
export function ZenoBubbleHeader({ turn, busy, onContinue, onClose }: ZenoBubbleHeaderProps) {
  return (
    <header className="flex flex-none items-center gap-2 border-b border-edge-faint py-2 pr-2 pl-4 sm:gap-2.5">
      <ZenoLive turn={turn} variant="head" className="w-9" />
      <div className="min-w-0 flex-1">
        <p className="text-base leading-none font-extrabold tracking-[0.07em] text-green">ZENO</p>
        <p className="mt-1 truncate text-[11px] text-ink-faint sm:text-xs">
          answers from ShieldedScan’s data
        </p>
      </div>
      <Link
        href="/ai-agent"
        onClick={onContinue}
        aria-disabled={busy || undefined}
        aria-label="Continue in the full Zeno page"
        title={busy ? "Wait for the answer, then continue" : "Continue in the full Zeno page"}
        className={[TARGET, busy ? "cursor-not-allowed opacity-60" : ""].join(" ")}
      >
        <span aria-hidden>↗</span>
      </Link>
      <button type="button" onClick={onClose} aria-label="Close Zeno" className={TARGET}>
        <span aria-hidden>✕</span>
      </button>
    </header>
  );
}
