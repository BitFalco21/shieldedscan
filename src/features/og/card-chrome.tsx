import type { CSSProperties } from "react";
import { OG } from "./og-tokens";

/** Every share card's canvas: the 1.91:1 frame every link preview renders. */
export const OG_CARD_SIZE = { width: 1200, height: 630 } as const;

/**
 * The chrome the transaction and name cards share — page, hairline frame, brand header and
 * footer — so a transaction link and a name link preview as one site. satori takes flexbox
 * only; every element holding more than one child declares a `display`.
 */
export const CARD_CHROME: Record<string, CSSProperties> = {
  card: {
    width: "100%",
    height: "100%",
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    background: OG.bg,
    padding: "56px 64px",
    fontFamily: "JBM",
    color: OG.ink,
  },

  // A hairline frame in the panel's edge colour, so the card reads as one of the site's
  // panels rather than as text floating on black.
  frame: {
    position: "absolute",
    top: 24,
    left: 24,
    width: 1152,
    height: 582,
    border: `1px solid ${OG.greenFaint}`,
    borderRadius: 4,
  },

  header: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  brand: {
    display: "flex",
    alignItems: "center",
    fontSize: 27,
    fontWeight: 800,
    letterSpacing: 1,
    color: OG.green,
    textShadow: `0 0 14px ${OG.greenDim}`,
  },
  cursor: { width: 15, height: 27, marginLeft: 4, background: OG.green },
  stamp: { fontSize: 21, letterSpacing: 2, color: OG.inkDim },

  footer: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  host: { fontSize: 20, letterSpacing: 2, color: OG.greenDim },
};

export interface CardHeaderProps {
  /** The card's date stamp, printed at the right of the brand. */
  stamp: string;
}

/** The brand line across the top of a card: the wordmark with its cursor, and the stamp. */
export function CardHeader({ stamp }: CardHeaderProps) {
  return (
    <div style={CARD_CHROME.header}>
      <div style={CARD_CHROME.brand}>
        ./shieldedscan
        <div style={CARD_CHROME.cursor} />
      </div>
      <div style={CARD_CHROME.stamp}>{stamp}</div>
    </div>
  );
}
