import { GENESIS_TARGET } from "@/domain/bitcoin-keys";

export interface ReelStripProps {
  /** The derived address to land on, or null before the first pull. */
  address: string | null;
  /**
   * Per-position agreement with the target, or null while the reels are still moving. A hit
   * lights only once the strip has LANDED: a green border on a reel that has not stopped yet
   * would give the result away before the machine does.
   */
  hits: readonly boolean[] | null;
  /** Changes on every pull so the bands remount at their start position. */
  spinKey: number;
}

/** Filler glyphs a band scrolls past before landing. Base58 only — never a digit that could
 *  read as a real amount, and never a character the alphabet lacks (0, O, I, l). */
const FILLER = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const FILLER_ROWS = 8;

/**
 * Thirty-four reels under a payline that IS the target address. Each band renders its
 * filler rows then the final character LAST, so landing is one fixed CSS rule
 * (`translateY(calc(-100% + var(--reel-h)))`) and no per-reel inline style is needed; the
 * stagger comes from `.slot-reel:nth-child(k)` rules in globals.css. A 33-character address
 * simply leaves its last reel blank, which `matchPositions` reports as a miss.
 *
 * Presentational and aria-hidden as a whole: the address it lands on is printed in full on the
 * proof ticket, which is where a screen reader gets it once rather than as 34 glyphs.
 */
export function ReelStrip({ address, hits, spinKey }: ReelStripProps) {
  const target = GENESIS_TARGET.address;
  return (
    <div className="slot-window" aria-hidden="true">
      <div className="slot-row-label">
        <span>
          the target · <b>{target}</b>
        </span>
        <span>block 0 · coinbase</span>
      </div>
      <div className="slot-strip">
        {Array.from(target, (ch, i) => (
          <div key={i} className="slot-target-cell">
            {ch}
          </div>
        ))}
      </div>
      <div className="slot-payline">
        <span>payline</span>
      </div>
      <div className="slot-strip">
        {Array.from(target, (_, i) => {
          const final = address?.[i] ?? "";
          const hit = hits !== null && hits[i] === true;
          return (
            <div key={i} className={hit ? "slot-reel slot-reel-hit" : "slot-reel"}>
              <div key={spinKey} className="slot-reel-band">
                {Array.from({ length: FILLER_ROWS }, (_, row) => (
                  <span key={row}>{FILLER[(i * 7 + row * 11) % FILLER.length]}</span>
                ))}
                <span>{address === null ? "·" : final || " "}</span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="slot-row-label mt-2">
        <span>your address · derived from the key drawn</span>
        <span>{hits === null ? "— of 34" : `${hits.filter(Boolean).length} of 34`}</span>
      </div>
    </div>
  );
}
