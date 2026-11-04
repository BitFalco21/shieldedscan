/**
 * A note above the bubble while the panel's code loads on the first press: a slow phone should
 * see the press land rather than nothing.
 */
export function ZenoBubbleLoading() {
  return (
    <p
      role="status"
      // Above the bubble, which stays pressable while this waits.
      className="panel fixed right-4 bottom-24 z-50 px-4 py-3 text-xs text-ink-faint sm:right-6"
    >
      waking zeno…
    </p>
  );
}
