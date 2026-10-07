import type { NetClient } from "@/domain";
import {
  ZAKURA_CORE_D,
  ZAKURA_PETAL_D,
  ZAKURA_TRANSLATE,
  ZAKURA_VIEWBOX_SIZE,
} from "@/components/ZakuraMark";
import { ZCASHD_BADGE_DATA_URI } from "@/components/zcashd-badge.generated";
import { ZEBRA_BADGE_DATA_URI } from "@/components/zebra-badge.generated";

export interface CellMarkProps {
  client: NetClient;
  /** The cell's centre and side in viewBox units. */
  x: number;
  y: number;
  z: number;
}

/**
 * A cell drawn as its modal client's mark — the same marks `ClientMark` draws beside a name in
 * every table, from the same path data and badge, so the map cannot show one client two ways.
 *
 * Inside the map's `<svg>` rather than an `<svg>` per cell, so it zooms and pans with the one
 * `<g>` the map transforms. Shown only under the software lens (CSS keyed on the svg's
 * `data-lens`) and never interactive: the invisible cell rect beneath keeps the focus, the label
 * and the nearest-cell picking. An unknown client is a neutral disc.
 *
 * No `id`, no `clipPath`: forty cells would share it.
 */
export function CellMark({ client, x, y, z }: CellMarkProps) {
  const left = x - z / 2;
  const top = y - z / 2;
  switch (client) {
    case "Zebra":
      return (
        <image
          className="net-cell-mark"
          href={ZEBRA_BADGE_DATA_URI}
          x={left}
          y={top}
          width={z}
          height={z}
          preserveAspectRatio="xMidYMid meet"
        />
      );
    case "Zakura": {
      const s = z / ZAKURA_VIEWBOX_SIZE;
      return (
        <g
          className="net-cell-mark"
          transform={`translate(${left} ${top}) scale(${s}) translate(${ZAKURA_TRANSLATE[0]} ${ZAKURA_TRANSLATE[1]})`}
        >
          <path className="brand-zakura-petal" fill="currentColor" d={ZAKURA_PETAL_D} />
          <path className="brand-zakura-core" fill="currentColor" d={ZAKURA_CORE_D} />
        </g>
      );
    }
    case "zcashd":
      return (
        <image
          className="net-cell-mark"
          href={ZCASHD_BADGE_DATA_URI}
          x={left}
          y={top}
          width={z}
          height={z}
          preserveAspectRatio="xMidYMid meet"
        />
      );
    default:
      return <circle className="net-cell-mark net-cell-mark-other" cx={x} cy={y} r={z * 0.42} />;
  }
}
