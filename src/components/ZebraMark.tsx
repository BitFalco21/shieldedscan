import { ZEBRA_BADGE_DATA_URI } from "@/components/zebra-badge.generated";

/**
 * Zebra's mark: the Zcash Foundation's badge — a gear holding a striped zebra head — as the
 * Foundation publishes it.
 *
 * A raster mark (`brand/derive-zebra-badge.py`): the Foundation ships the badge only as a PNG,
 * and a quantised copy of their own pixels is more faithful than a trace of a three-colour figure
 * drawn at 18px. It ships as a 2.4 KB `data:` URI inside the page, so it costs no request; the
 * CSP is `img-src 'self' data:`.
 *
 * Decorative (`alt=""`, `aria-hidden`): the client's name sits beside every mark, so a screen
 * reader hears "Zebra" once.
 */
export interface ZebraMarkProps {
  /** Rendered size in px, square. */
  size?: number;
}

export function ZebraMark({ size = 18 }: ZebraMarkProps) {
  // An inline data: URI; next/image would add a loader round trip and a wrapper to a mark that
  // ships inside the HTML.
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={ZEBRA_BADGE_DATA_URI}
      alt=""
      aria-hidden
      width={size}
      height={size}
      draggable={false}
      className="shrink-0"
    />
  );
}
