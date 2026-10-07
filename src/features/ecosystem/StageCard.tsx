import { ecosystemHost, type EcosystemEntry } from "@/domain/ecosystem";
import { categoryLabel } from "./search";

export interface StageCardProps {
  entry: EcosystemEntry;
  slot: number;
  /** The top of the project's disc, in stage (viewBox) units after the camera. */
  x: number;
  y: number;
  /** Stage units per screen pixel, so the card keeps one size at every zoom. */
  unit: number;
  halfW: number;
  halfH: number;
}

const PAD = 12;
const CHAR_W = 7.3;
const ROW = 17;

/**
 * What the map cannot print under every disc: the full name, its category, where the link
 * goes, and which catalogue put the project on the list. Drawn inside the SVG rather than as
 * an HTML tooltip, because positioning HTML over the stage needs a runtime inline style and
 * this site allows exactly two of those (ChartHover's). It never takes the pointer, so it
 * cannot swallow the click it sits above.
 */
export function StageCard({ entry, slot, x, y, unit, halfW, halfH }: StageCardProps) {
  const rows = [
    { text: entry.name, cls: "eco-card-name" },
    { text: categoryLabel(entry.category), cls: `eco-card-kind flow-${slot}` },
    { text: `${ecosystemHost(entry.url)} ↗`, cls: "eco-card-host" },
    { text: entry.source, cls: "eco-card-source" },
  ];
  const width = PAD * 2 + Math.max(...rows.map((r) => r.text.length)) * CHAR_W;
  const height = PAD * 2 + rows.length * ROW - 4;
  const w = width * unit;
  const h = height * unit;
  // Above the disc when there is room, below it otherwise; never off either side.
  const above = y - h - 10 * unit > -halfH;
  const top = above ? y - h - 10 * unit : y + 70 * unit;
  const left = Math.min(halfW - w - 8 * unit, Math.max(-halfW + 8 * unit, x - w / 2));
  return (
    <g
      transform={`translate(${left.toFixed(1)} ${top.toFixed(1)}) scale(${unit.toFixed(4)})`}
      className="eco-card"
      aria-hidden
    >
      <rect width={width} height={height} rx={4} className="eco-card-box" />
      {rows.map((r, i) => (
        <text key={i} x={PAD} y={PAD + 12 + i * ROW} className={r.cls}>
          {r.text}
        </text>
      ))}
    </g>
  );
}
