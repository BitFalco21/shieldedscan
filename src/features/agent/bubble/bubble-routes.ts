/**
 * Where the Zeno bubble appears: every page, except
 *  - `/ai-agent`, which is Zeno already;
 *  - `/learn`, which has its own Zeno, launcher and drawer (`LearnZeno`): two would be one too many;
 *  - `/social/…`, the share cards, which are screenshotted rather than browsed.
 * The OG image routes render no layout, so they never reach this. Error and not-found pages keep
 * it: they render inside the same layout, and a way to ask is no harm there.
 *
 * Kept apart from the page descriptions so the launcher, which ships on every page, carries only
 * this check.
 */
const EXCLUDED = ["/ai-agent", "/learn", "/social"] as const;

export function isBubbleRoute(pathname: string): boolean {
  return !EXCLUDED.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
