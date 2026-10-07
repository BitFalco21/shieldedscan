import type { CrossChainProtocol } from "@/domain";
import { brandMark, markSizeClass, type MarkSize } from "@/components/brand-marks";

/**
 * A swap protocol's mark.
 *
 * NEAR Intents settles on NEAR and uses its mark. Maya's M-bridge and THORChain's bolt are
 * constructions from each protocol's official mark (see `brand-marks.ts`).
 */
const PROTOCOL_MARK: Record<CrossChainProtocol, string | null> = {
  "near-intents": "NEAR",
  maya: "MAYA",
  thorchain: "THOR",
};

const INITIAL: Record<CrossChainProtocol, string> = {
  "near-intents": "N",
  maya: "M",
  thorchain: "T",
};

/** The lettermark's diameter and type at each size — 18px in a row, as before. */
const LETTERMARK: Record<MarkSize, string> = {
  sm: "h-3.5 w-3.5 text-[8px]",
  default: "h-[18px] w-[18px] text-[9px]",
  lg: "h-[34px] w-[34px] text-[15px]",
  xl: "h-24 w-24 border-2 text-[40px]",
};

export interface ProtocolLogoProps {
  protocol: CrossChainProtocol;
  /** `sm` (14px) inside a sentence; the 18px row mark by default. See `MarkSize`. */
  size?: MarkSize;
}

export function ProtocolLogo({ protocol, size = "default" }: ProtocolLogoProps) {
  const ticker = PROTOCOL_MARK[protocol];
  const mark = ticker === null ? null : brandMark(ticker);

  if (mark === null || ticker === null) {
    return (
      <span
        aria-hidden
        className={`flex shrink-0 items-center justify-center rounded-full border border-ink-faint leading-none font-semibold text-ink-dim ${LETTERMARK[size]}`}
      >
        {INITIAL[protocol]}
      </span>
    );
  }

  return (
    <svg
      aria-hidden
      viewBox={mark.viewBox}
      className={`brand-${ticker.toLowerCase()} ${markSizeClass(mark, size)}`}
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
