import type { CSSProperties } from "react";
import { OG } from "./og-tokens";
import type { CompareCardFacts, CompareCardMark, CompareCardSide } from "./compare-card-facts";
import { OG_CARD_SIZE } from "./card-chrome";

export const COMPARE_CARD_SIZE = OG_CARD_SIZE;

/**
 * The card's stylesheet, as named objects (see `tx-card.tsx` for why, and for satori's
 * limits: flexbox only, no cascade, no pseudo-elements, every multi-child element needs an
 * explicit `display`). The phosphor bloom is layered `textShadow`; there is no raster.
 */
const S: Record<string, CSSProperties> = {
  card: {
    width: "100%",
    height: "100%",
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    background: OG.bg,
    padding: "44px 72px 48px",
    fontFamily: "JBM",
    color: OG.ink,
  },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  brand: {
    display: "flex",
    alignItems: "center",
    fontSize: 22,
    fontWeight: 800,
    letterSpacing: 1,
    color: OG.green,
    textShadow: `0 0 14px ${OG.greenDim}`,
  },
  cursor: { width: 12, height: 22, marginLeft: 4, background: OG.green },
  url: { fontSize: 19, letterSpacing: 1, color: OG.inkDim },

  // The formula row: Zcash · WITH THE MARKET CAP OF · Bitcoin, each name over its card.
  formula: { display: "flex", alignItems: "center", marginTop: 18 },
  who: {
    display: "flex",
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    fontSize: 40,
    fontWeight: 800,
    letterSpacing: -1,
    color: OG.inkBright,
  },
  whoZec: { color: OG.green },
  whoMark: { display: "flex", marginRight: 14 },
  // Wide enough for the phrase on one line at this tracking; a formula broken across two
  // lines defeats the row.
  word: {
    width: 340,
    textAlign: "center",
    fontSize: 16,
    letterSpacing: 4,
    color: OG.inkDim,
  },

  pair: { display: "flex", alignItems: "stretch", marginTop: 16 },
  coin: {
    display: "flex",
    flex: 1,
    flexDirection: "column",
    alignItems: "center",
    padding: "18px 28px",
    background: OG.panel,
    border: `1px solid ${OG.greenFaint}`,
    borderRadius: 6,
  },
  coinChoose: { border: `1px solid ${OG.greenDim}` },
  coinMark: { display: "flex" },
  ticker: { marginTop: 10, fontSize: 19, letterSpacing: 3, color: OG.inkDim },
  rows: { display: "flex", flexDirection: "column", width: "100%", marginTop: 12 },
  row: { display: "flex", justifyContent: "space-between", fontSize: 19, marginTop: 4 },
  rowLabel: { color: OG.inkFaint },
  rowValue: { color: OG.ink },
  rowCap: { color: OG.inkBright, fontWeight: 800 },
  arrow: {
    display: "flex",
    width: 120,
    alignItems: "center",
    justifyContent: "center",
    fontSize: 52,
    color: OG.greenDim,
  },

  bottom: { display: "flex", justifyContent: "space-between", alignItems: "flex-end" },
  verdict: { display: "flex", flexDirection: "column" },
  label: { fontSize: 18, letterSpacing: 3, color: OG.inkDim },
  figRow: { display: "flex", alignItems: "center", marginTop: 6 },
  figure: {
    fontSize: 84,
    fontWeight: 400,
    letterSpacing: -2,
    lineHeight: 1,
    color: OG.green,
    textShadow: `0 0 2px ${OG.inkBright}, 0 0 20px ${OG.greenDim}`,
  },
  pill: {
    display: "flex",
    marginLeft: 26,
    padding: "8px 16px",
    border: `1px solid ${OG.greenDim}`,
    borderRadius: 4,
    fontSize: 36,
    fontWeight: 800,
    color: OG.green,
  },
  meta: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    fontSize: 16,
    letterSpacing: 1,
    color: OG.inkFaint,
  },
  metaSource: { marginTop: 4, color: OG.inkDim },

  letter: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
    border: `2px solid ${OG.inkDim}`,
    color: OG.ink,
    fontWeight: 800,
  },
};

// Composed once, never as a literal at the element: the inline-style gate counts the `style=`
// literal form, and a spread there is the same bypass with extra steps.
const WHO_ZEC: CSSProperties = { ...S.who, ...S.whoZec };
const COIN_CHOOSE: CSSProperties = { ...S.coin, ...S.coinChoose };
const letterStyle = (px: number): CSSProperties => ({
  ...S.letter,
  width: px,
  height: px,
  fontSize: px * 0.42,
});

/** A brand mark at `px`, or the lettermark at the same size. */
function Mark({ mark, px }: { mark: CompareCardMark; px: number }) {
  if (mark.kind === "letter") {
    return <div style={letterStyle(px)}>{mark.letter}</div>;
  }
  const m = mark.mark;
  return (
    <svg viewBox={m.viewBox} width={px} height={px}>
      <g transform={m.transform}>
        <path
          d={m.d}
          fill={m.strokeWidth === undefined ? mark.color : "none"}
          fillRule={m.fillRule}
          stroke={m.strokeWidth === undefined ? undefined : mark.color}
          strokeWidth={m.strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}

function Coin({ side, choose }: { side: CompareCardSide; choose: boolean }) {
  return (
    <div style={choose ? COIN_CHOOSE : S.coin}>
      <div style={S.coinMark}>
        <Mark mark={side.mark} px={88} />
      </div>
      <div style={S.ticker}>{side.ticker}</div>
      <div style={S.rows}>
        <div style={S.row}>
          <div style={S.rowLabel}>price</div>
          <div style={S.rowValue}>{side.price}</div>
        </div>
        <div style={S.row}>
          <div style={S.rowLabel}>market cap</div>
          <div style={S.rowCap}>{side.marketCap}</div>
        </div>
      </div>
    </div>
  );
}

export interface CompareCardProps {
  facts: CompareCardFacts;
}

/**
 * The compare share card, as a satori tree: the page's own hero — formula, two coin cards,
 * the figure and the multiple — at 1200×630, with the source and read time, because a
 * market cap is a decaying claim and the image outlives the moment.
 */
export function CompareCard({ facts }: CompareCardProps) {
  return (
    <div style={S.card}>
      <div style={S.header}>
        <div style={S.brand}>
          ./shieldedscan
          <div style={S.cursor} />
        </div>
        <div style={S.url}>{facts.url}</div>
      </div>

      <div style={S.formula}>
        <div style={WHO_ZEC}>
          <div style={S.whoMark}>
            <Mark mark={facts.zec.mark} px={44} />
          </div>
          {facts.zec.name}
        </div>
        <div style={S.word}>WITH THE MARKET CAP OF</div>
        <div style={S.who}>
          <div style={S.whoMark}>
            <Mark mark={facts.other.mark} px={44} />
          </div>
          {facts.other.name}
        </div>
      </div>

      <div style={S.pair}>
        <Coin side={facts.zec} choose={false} />
        <div style={S.arrow}>→</div>
        <Coin side={facts.other} choose />
      </div>

      <div style={S.bottom}>
        <div style={S.verdict}>
          <div style={S.label}>ONE ZEC WOULD BE WORTH</div>
          <div style={S.figRow}>
            <div style={S.figure}>{facts.impliedPrice}</div>
            <div style={S.pill}>{facts.multiple}</div>
          </div>
        </div>
        <div style={S.meta}>
          <div>arithmetic, not a forecast</div>
          <div style={S.metaSource}>{facts.source}</div>
        </div>
      </div>
    </div>
  );
}
