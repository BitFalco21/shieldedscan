import {
  brandMark,
  canonicalMarkTicker,
  markSizeClass,
  type MarkSize,
} from "@/components/brand-marks";

/**
 * A chain or asset's real mark, in ink.
 *
 * The actual brand silhouettes in their actual colours, inlined as path data and filled with
 * `currentColor`, which a `.brand-<ticker>` class sets. A class rather than a `fill` attribute
 * or inline style keeps brand colours in the token layer, auditable in one place — and several
 * brands are unreadable on a near-black background at their published hex.
 *
 * No CDN: the CSP is `img-src 'self' data:`, and a third-party image request per row would be
 * a tracking vector.
 *
 * A ticker with no mark falls back to a lettermark rather than a blank, because venues list
 * new chains without warning and an unknown one must still render.
 */

export interface ChainLogoProps {
  /** Chain or asset ticker, e.g. "BTC". Unknown values fall back to a lettermark. */
  chain: string;
  /**
   * A second ticker to try when `chain` has no mark — in practice the chain an asset sits on.
   * An asset whose ticker a venue never published renders under a placeholder label; the chain
   * it sits on is still a true statement about the row, and its mark beats a lettermark.
   */
  fallbackChain?: string;
  /** Emphasised marks carry full ink; the default sits back a little. */
  emphasis?: "normal" | "strong";
  /**
   * How large the mark is drawn. The default is the 18px row mark every table uses; `lg`
   * (34px) names an asset in a heading, `xl` (96px) is the hero of `/compare`'s coin cards,
   * and `sm` (14px) sits inside a line of prose. Sized here rather than by a utility on the
   * caller, because a wide mark (viewBox ratio past 1.6) keeps its height and lets its width
   * follow — a caller's `w-24` would squash it into a square.
   */
  size?: MarkSize;
}

/** Diameter and type size of the lettermark at each size. */
const LETTERMARK_CLASSES: Record<MarkSize, string> = {
  sm: "h-3.5 w-3.5 text-[8px]",
  default: "h-6 w-6 text-[11px]",
  lg: "h-[34px] w-[34px] text-[15px]",
  xl: "h-24 w-24 border-2 text-[40px]",
};

export function ChainLogo({
  chain,
  fallbackChain,
  emphasis = "strong",
  size = "default",
}: ChainLogoProps) {
  const direct = brandMark(chain);
  const fallback = direct === null && fallbackChain !== undefined ? brandMark(fallbackChain) : null;
  const mark = direct ?? fallback;
  // The canonical key, not the ticker we were handed: a venue may send "GNOSIS" for a mark
  // filed as "GNO", and the `.brand-*` class and the lettermark must follow the silhouette,
  // or the mark renders in an unrelated brand's colour.
  const marked =
    (direct !== null ? canonicalMarkTicker(chain) : canonicalMarkTicker(fallbackChain)) ??
    (direct !== null ? chain : (fallbackChain ?? chain));

  // A ticker with no mark keeps the ink lettermark: an unbranded circle is better than
  // a wrong logo, and better than a coloured blank.
  if (mark === null) {
    const tone = emphasis === "strong" ? "border-ink text-ink" : "border-ink-faint text-ink-dim";
    return (
      <span
        aria-hidden
        className={`flex shrink-0 items-center justify-center rounded-full border leading-none font-semibold ${LETTERMARK_CLASSES[size]} ${tone}`}
      >
        {marked.slice(0, 1).toUpperCase()}
      </span>
    );
  }

  return (
    <svg
      aria-hidden
      viewBox={mark.viewBox}
      // No `text-*` utility here: utilities sit in a later cascade layer than the
      // component classes, so one would override the brand colour entirely. Emphasis
      // therefore rides on opacity, which does not collide.
      className={`brand-${marked.toLowerCase()} ${markSizeClass(mark, size)} ${
        emphasis === "strong" ? "" : "opacity-75"
      }`}
      fill={mark.strokeWidth === undefined ? "currentColor" : "none"}
    >
      <g transform={mark.transform}>
        <path
          d={mark.d}
          {...(mark.fillRule === undefined ? {} : { fillRule: mark.fillRule })}
          {...(mark.strokeWidth === undefined
            ? {}
            : {
                stroke: "currentColor",
                strokeWidth: mark.strokeWidth,
                strokeLinecap: "round" as const,
                strokeLinejoin: "round" as const,
              })}
        />
      </g>
    </svg>
  );
}
