"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { isBubbleRoute } from "./bubble-routes";
import type { ZenoBubblePanel as Panel } from "./ZenoBubblePanel";
import { ZenoBubbleLoading } from "./ZenoBubbleLoading";

/**
 * The panel, its conversation loop and every answer component load on the first press, never
 * with the page. A bare `import()` rather than `next/dynamic`: the bundler already ships the
 * chunk loader, while `next/dynamic` would add its own runtime to every page for this one use.
 */
const loadPanel = () => import("./ZenoBubblePanel").then((m) => m.ZenoBubblePanel);

export interface ZenoBubbleProps {
  /**
   * Zeno's head, rendered by the server: the mascot's code then never reaches the browser just
   * to draw a corner button on every page.
   */
  head: ReactNode;
}

/**
 * Zeno's bubble at the bottom right of every page (`bubble-routes.ts` lists the exceptions), and
 * the panel it opens. Rendered by the root layout only when the agent is enabled: a flag-off or
 * testnet build still ships this small module, as every client module a layout imports is, but
 * never draws it and never fetches the panel.
 *
 * Nothing is sent and nothing heavy loads until the reader presses it; whether the panel is open
 * is remembered across pages in this component's state, and nowhere else.
 */
export function ZenoBubble({ head }: ZenoBubbleProps) {
  const pathname = usePathname() ?? "/";
  const shown = isBubbleRoute(pathname);
  const [open, setOpen] = useState(false);
  // Held as `{ Panel }`: a component stored bare would be called by `setState` as an updater.
  const [loaded, setLoaded] = useState<{ Panel: typeof Panel } | null>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);

  // Leaving for a page without the bubble closes it, so it does not spring open on the way back.
  const [wasShown, setWasShown] = useState(shown);
  if (shown !== wasShown) {
    setWasShown(shown);
    if (!shown) setOpen(false);
  }

  // Back to the bubble when the panel closes, as a dialog should — but only when the reader
  // closed it, not when a page change did.
  useEffect(() => {
    if (open || !returnFocus.current) return;
    returnFocus.current = false;
    launcherRef.current?.focus();
  }, [open]);

  function openPanel() {
    setOpen(true);
    if (loaded !== null) return;
    loadPanel().then(
      (Loaded) => setLoaded({ Panel: Loaded }),
      // Offline, or a deploy replaced the chunk: back to the bubble, which can be pressed again.
      () => {
        returnFocus.current = true;
        setOpen(false);
      },
    );
  }

  if (!shown) return null;

  return (
    <>
      {/* Room below the footer, so the bubble never sits over its last lines. */}
      <div aria-hidden className="h-24 flex-none bg-bg/90" />
      <button
        ref={launcherRef}
        type="button"
        hidden={open}
        aria-label="Ask Zeno about this page"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={openPanel}
        className="fixed right-4 bottom-[calc(env(safe-area-inset-bottom,0px)+1rem)] z-40 flex size-[60px] cursor-pointer items-center justify-center rounded-full border border-edge-strong bg-bg shadow-lg hover:border-green sm:right-6 sm:bottom-6 sm:h-14 sm:w-auto sm:gap-2.5 sm:pr-5 sm:pl-2.5"
      >
        {head}
        <span
          aria-hidden
          className="hidden text-lg leading-none font-extrabold tracking-[0.07em] text-green sm:inline"
        >
          ZENO
        </span>
      </button>
      {loaded === null ? (
        open && <ZenoBubbleLoading />
      ) : (
        <loaded.Panel
          open={open}
          onClose={() => {
            returnFocus.current = true;
            setOpen(false);
          }}
        />
      )}
    </>
  );
}
