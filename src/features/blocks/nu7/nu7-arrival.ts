/**
 * Whether this tab watched the countdown reach the activation block. In memory only: it lives as
 * long as the page's JavaScript, which is what carries it across the countdown's
 * `router.refresh()` to the real block page, and is gone on a reload. Nothing is stored.
 */
let watched = false;

export function markNu7Watched(): void {
  watched = true;
}

/** Read once by the activation banner, so a later visit in the same tab renders it still. */
export function consumeNu7Watched(): boolean {
  const was = watched;
  watched = false;
  return was;
}
