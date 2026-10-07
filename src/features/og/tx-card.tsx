import type { CSSProperties } from "react";
import { SHIELD, SHIELD_LEFT } from "@/components/PrivacyShield";
import { CARD_CHROME, CardHeader, OG_CARD_SIZE } from "./card-chrome";
import { OG } from "./og-tokens";
import type { TxCardFacts } from "./tx-card-facts";
import type { PrivacyVariant } from "@/components/PrivacyShield";

export const TX_CARD_SIZE = OG_CARD_SIZE;

/**
 * The card's stylesheet, as named objects: one place where the card's spacing and weight are
 * decided, and the inline-style gate (`no-inline-styles.test.ts`) stays at its two ChartHover
 * lines. That gate is a text scan, so the banned form must not be written out even in a comment.
 *
 * satori supports a subset of CSS (flexbox only, no cascade, no pseudo-elements), so the
 * phosphor bloom is layered `textShadow` instead of the real `.crt-title` treatment, and there
 * is no scanline raster, which is an `::after` overlay satori cannot draw.
 */
const S: Record<string, CSSProperties> = {
  body: { display: "flex", flexDirection: "column" },
  verdict: {
    fontSize: 88,
    fontWeight: 800,
    letterSpacing: 4,
    lineHeight: 1,
    color: OG.green,
    /*
     * Two tight layers, not three wide ones: satori draws a text shadow as a soft blob rather
     * than a per-glyph bloom, so a wide layer reads as a green cloud.
     */
    textShadow: `0 0 2px ${OG.inkBright}, 0 0 16px ${OG.greenDim}`,
  },
  path: { marginTop: 22, fontSize: 30, letterSpacing: 3, color: OG.ink },
  shape: { marginTop: 14, fontSize: 20, letterSpacing: 2, color: OG.inkFaint },

  // Top-aligned, so VALUE and FEE sit on one line: bottom alignment made the labels
  // disagree by the height of whichever cell carried a price basis.
  figures: { display: "flex", gap: 96, alignItems: "flex-start" },
  figure: { display: "flex", flexDirection: "column" },
  /**
   * A wrapper with an explicit `display`, because satori refuses any element holding more than
   * one child without one, and a JSX fragment does not satisfy that: it renders through as
   * multiple children of whatever encloses it.
   */
  stack: { display: "flex", flexDirection: "column" },
  label: { fontSize: 17, letterSpacing: 3, color: OG.inkFaint, marginBottom: 10 },
  amount: { display: "flex", fontSize: 40, fontWeight: 800, color: OG.inkBright },
  basis: { marginTop: 8, fontSize: 16, letterSpacing: 2, color: OG.inkFaint },
  absent: { display: "flex", fontSize: 34, color: OG.inkFaint },

  // The Veil is drawn, never the ▓ character: the subset font makes a missing glyph likely.
  redaction: { display: "flex", gap: 5, marginBottom: 6 },
  bar: { width: 34, height: 34, background: OG.greenDim, borderRadius: 2 },
  veilNote: { fontSize: 16, letterSpacing: 2, color: OG.inkDim },

  // Absolute, so it cannot push the copy around as the verdict word changes length. Right
  // of the text column and vertically centred on the card.
  shield: { position: "absolute", top: 165, right: 74 },

  txid: { fontSize: 24, letterSpacing: 2, color: OG.inkDim },
};

/**
 * The privacy shield the site puts beside every transaction, at 300px instead of 14.
 *
 * The same silhouette and the same three states — filled, half-filled, outline — imported
 * from `PrivacyShield` rather than redrawn, because a mark that means something must not
 * exist twice. It sits behind the copy at low contrast: it is a restatement of the verdict
 * word for anyone who has learned the grammar, never the card's only carrier of it, so it
 * must not compete with the text.
 */
function Shield({ variant }: { variant: PrivacyVariant }) {
  const ink = variant === "transparent" ? OG.inkFaint : OG.greenDim;
  return (
    <svg style={S.shield} viewBox="0 0 24 24" width={300} height={300}>
      {variant === "mixed" ? <path d={SHIELD_LEFT} fill={ink} fillOpacity={0.26} /> : null}
      <path
        d={SHIELD}
        fill={variant === "shielded" ? ink : "none"}
        fillOpacity={0.26}
        stroke={ink}
        strokeOpacity={0.62}
        strokeWidth={1.4}
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Six bars, the width the site's inline redaction strip uses beside a value. */
function Redaction() {
  return (
    <div style={S.redaction}>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} style={S.bar} />
      ))}
    </div>
  );
}

export interface TxCardProps {
  facts: TxCardFacts;
}

/**
 * The transaction share card, as a satori tree.
 *
 * Not a React component in the site's sense — nothing renders it to the DOM — so it takes no
 * client state and reads no context. It prints `facts` and decides nothing: every refusal
 * (the Veil, a missing dollar figure, an absent flow path, a coinbase's absent fee) has
 * already been made in `txCardFacts`, which is what makes those refusals unit-testable.
 */
export function TxCard({ facts }: TxCardProps) {
  return (
    <div style={CARD_CHROME.card}>
      <div style={CARD_CHROME.frame} />
      {facts.shield !== null ? <Shield variant={facts.shield} /> : null}

      <CardHeader stamp={facts.stamp} />

      <div style={S.body}>
        <div style={S.verdict}>{facts.verdict}</div>
        {facts.path !== null ? <div style={S.path}>{facts.path}</div> : null}
        <div style={S.shape}>{facts.shape}</div>
      </div>

      {facts.value !== null || facts.fee !== null ? (
        <div style={S.figures}>
          {facts.value !== null ? (
            <div style={S.figure}>
              <div style={S.label}>VALUE</div>
              {facts.value.kind === "public" ? (
                <div style={S.stack}>
                  <div style={S.amount}>{facts.value.zec}</div>
                  {facts.value.usd !== null ? (
                    // One text child, not three: satori refuses an element with more than one
                    // child and no explicit `display`. A template string keeps this a leaf.
                    <div style={S.basis}>{`${facts.value.usd} · ${facts.value.usdBasis}`}</div>
                  ) : null}
                </div>
              ) : (
                <div style={S.stack}>
                  <Redaction />
                  <div style={S.veilNote}>SHIELDED BY DESIGN</div>
                </div>
              )}
            </div>
          ) : null}

          {facts.fee !== null ? (
            <div style={S.figure}>
              <div style={S.label}>FEE</div>
              {facts.fee.kind === "amount" ? (
                <div style={S.amount}>{facts.fee.zec}</div>
              ) : (
                <div style={S.absent}>{facts.fee.kind === "none" ? "none" : "unknown"}</div>
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      <div style={CARD_CHROME.footer}>
        <div style={S.txid}>{facts.txidShort}</div>
        <div style={CARD_CHROME.host}>{facts.host}</div>
      </div>
    </div>
  );
}
