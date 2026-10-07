import type { CSSProperties } from "react";
import { OG } from "./og-tokens";
import type { NameCardFacts } from "./name-card-facts";
import { CARD_CHROME, CardHeader, OG_CARD_SIZE } from "./card-chrome";

export const NAME_CARD_SIZE = OG_CARD_SIZE;

/**
 * The name card's own styles; the frame, brand and footer are `CARD_CHROME`. satori takes
 * flexbox only; every element holding more than one child declares a `display`.
 */
const S: Record<string, CSSProperties> = {
  body: { display: "flex", flexDirection: "column" },
  name: {
    fontWeight: 800,
    lineHeight: 1.05,
    color: OG.green,
    textShadow: `0 0 2px ${OG.inkBright}, 0 0 16px ${OG.greenDim}`,
  },
  address: { display: "flex", marginTop: 28, fontSize: 34, letterSpacing: 1, color: OG.inkBright },
  arrow: { marginRight: 18, color: OG.greenDim },
  since: { fontSize: 22, letterSpacing: 2, color: OG.inkDim },
};

export interface NameCardProps {
  facts: NameCardFacts;
}

/** The name share card, as a satori tree. It prints `facts` and decides nothing. */
export function NameCard({ facts }: NameCardProps) {
  // Sized per name, so it is built here rather than inline in the tree.
  const nameStyle: CSSProperties = { ...S.name, fontSize: facts.nameSize };
  return (
    <div style={CARD_CHROME.card}>
      <div style={CARD_CHROME.frame} />
      <CardHeader stamp={facts.stamp} />

      <div style={S.body}>
        <div style={nameStyle}>{facts.name}</div>
        <div style={S.address}>
          <div style={S.arrow}>→</div>
          <div>{facts.addressShort}</div>
        </div>
      </div>

      <div style={CARD_CHROME.footer}>
        <div style={S.since}>{facts.since}</div>
        <div style={CARD_CHROME.host}>{facts.host}</div>
      </div>
    </div>
  );
}
