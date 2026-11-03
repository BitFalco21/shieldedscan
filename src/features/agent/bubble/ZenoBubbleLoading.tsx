/**
 * What stands where the panel will be while its code loads on the first press: a slow phone
 * should see the press land rather than nothing.
 */
export function ZenoBubbleLoading() {
  return (
    <p
      role="status"
      className="panel fixed right-4 bottom-4 z-50 px-4 py-3 text-xs text-ink-faint sm:right-6 sm:bottom-6"
    >
      waking zeno…
    </p>
  );
}
