export interface Nu7MiniBeatProps {
  /** Before activation the beat is slow and amber; after it, three times faster and green. */
  active: boolean;
}

/**
 * The site bar's tiny heartbeat: one blip sweeping across a flat line, a third as fast before
 * NU7 as after it. SVG and a CSS animation, so it costs no script on every page and the
 * reduced-motion rule parks it mid-trace. Decorative.
 */
export function Nu7MiniBeat({ active }: Nu7MiniBeatProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 34 14"
      className={`h-3.5 w-[34px] shrink-0 overflow-hidden ${active ? "text-green" : "text-warn"}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    >
      <path d="M0 8.5H34" className="opacity-60" />
      <path
        d="M-5 8.5L-3 10.5L0 2L3 11.5L5 8.5"
        className={`nu7-blip ${active ? "nu7-blip-fast" : ""}`}
      />
    </svg>
  );
}
