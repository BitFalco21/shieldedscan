import { ZCASHD_BADGE_DATA_URI } from "@/components/zcashd-badge.generated";

/**
 * zcashd's mark: the coloured ⓩ coin zcashd itself prints on its metrics screen when it starts
 * (`METRICS_ART` in github.com/zcash/zcash `src/metrics.h`), above "Thank you for running a
 * zcashd node!". It is the image zcashd shows its own operator, so it names the software rather
 * than the currency, and it is visibly distinct from the ⓩ this site uses to label a ZEC amount.
 *
 * A raster, like the Zebra badge, derived rather than traced: `brand/derive-zcashd-badge.py`
 * parses the art's ANSI escapes cell by cell (exact colours, VGA palette) into a 1.8 KB PNG
 * shipped as an inline `data:` URI — no request, and the CSP already admits `data:` images.
 * Re-run the script if zcashd ever changes the art.
 *
 * Decorative (`alt=""`, `aria-hidden`): the client's name sits beside every mark. The mark names
 * what a node runs, a fact the node declared in its handshake.
 */
export interface ZcashdMarkProps {
  /** Rendered size in px, square. */
  size?: number;
}

export function ZcashdMark({ size = 18 }: ZcashdMarkProps) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={ZCASHD_BADGE_DATA_URI}
      alt=""
      aria-hidden
      width={size}
      height={size}
      draggable={false}
      className="shrink-0"
    />
  );
}
