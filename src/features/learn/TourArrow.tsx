export interface TourArrowProps {
  on: boolean;
  /**
   * In the flow beside its target instead of floating over the free space to its right: for a
   * target whose right side holds other content (a ledger row's fee), where floating would
   * cover it. The row then gives the arrow its own room, wrapping if it has to.
   */
  inline?: boolean;
}

/**
 * The guided run's pointer: an arrow just to the right of the thing Zeno is about to press, nudging
 * toward it. By default it is placed absolutely against its parent, which must be `relative` and
 * have free room on its right, so it appearing and disappearing moves nothing on the page.
 * Sized to fit beside the widest button it points at in a 375px phone's panel.
 *
 * Decorative (`aria-hidden`): what it points at is said in words by Zeno's line, which is the live
 * region a screen reader follows.
 */
export function TourArrow({ on, inline = false }: TourArrowProps) {
  if (!on) return null;
  return (
    <span
      aria-hidden
      data-tour-arrow
      className={`tour-arrow pointer-events-none flex text-green ${
        inline ? "items-center" : "absolute top-1/2 left-full ml-2.5 -translate-y-1/2"
      }`}
    >
      <svg
        viewBox="0 0 24 14"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-3.5 w-[1.375rem]"
      >
        <path d="M23 7H2M8 1 2 7l6 6" />
      </svg>
    </span>
  );
}
