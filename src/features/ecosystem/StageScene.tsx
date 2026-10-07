import { memo } from "react";
import { brandMark } from "@/components/brand-marks";
import { CORE_SIZE, NODE_R, initial } from "./layout";
import type { Scene, SceneNode } from "./scene";

export interface StageSceneProps {
  scene: Scene;
  logos: ReadonlySet<string>;
  /** A project the reader picked from search: it stays bright while the rest recede. */
  highlightId: string | null;
  /** The project under the pointer or focus: its name is drawn even where it had no room. */
  hoveredId: string | null;
}
/** An icon inside its disc: 0.7 of the diameter keeps a square's corners inside the circle. */
const ICON = Math.round(NODE_R * 2 * 0.7);
const LINE_H = 16;
const fixed = (n: number) => Math.round(n * 10) / 10;

/**
 * Everything drawn inside the camera: category arcs and labels, then each project and the
 * Zcash mark in depth order. Memoised on the scene, so a pan or zoom — which changes only the
 * camera's transform around it — re-renders nothing in here.
 *
 * Every project is an `<a>` to its own site, opened in a new tab, with `noopener noreferrer`:
 * the site is not told which page sent the visitor (the venue-link rule), and the map stays
 * where the reader left it. No `id` anywhere, so no `clipPath`: an icon sits square inside
 * its round plate instead of being cut to a circle.
 */
export const StageScene = memo(function StageScene({
  scene,
  logos,
  highlightId,
  hoveredId,
}: StageSceneProps) {
  const zec = brandMark("ZEC");
  return (
    <>
      {scene.sectors.map((s) => (
        <g key={s.id} className={`flow-${s.slot}`} aria-hidden>
          <polyline points={s.arc} className="eco-arc" />
          <text
            transform={`translate(${fixed(s.label.x)} ${fixed(s.label.y)}) scale(${fixed2(s.label.scale * s.labelScale)})`}
            textAnchor={s.anchor}
            className="eco-category-label"
          >
            {s.lines.map((line, i) => (
              <tspan
                key={i}
                x={0}
                y={(i - (s.label.y < 0 ? s.lines.length - 1 : 0)) * LINE_H}
                dominantBaseline="middle"
              >
                {line}
                {i === s.lines.length - 1 ? (
                  <tspan className="eco-category-count"> {s.count}</tspan>
                ) : null}
              </tspan>
            ))}
          </text>
        </g>
      ))}

      {scene.items.map((item) =>
        item.kind === "core" ? (
          zec ? (
            <svg
              key="core"
              x={fixed(item.x - (CORE_SIZE * item.scale) / 2)}
              y={fixed(item.y - (CORE_SIZE * item.scale) / 2)}
              width={fixed(CORE_SIZE * item.scale)}
              height={fixed(CORE_SIZE * item.scale)}
              viewBox={zec.viewBox}
              className="brand-zec"
              aria-hidden
            >
              <path d={zec.d} fill="currentColor" />
            </svg>
          ) : null
        ) : (
          <ProjectNode
            key={item.node.entry.id}
            item={item}
            hasLogo={logos.has(item.node.entry.id)}
            dim={highlightId !== null && highlightId !== item.node.entry.id}
            lit={highlightId === item.node.entry.id}
            named={
              item.showLabel ||
              highlightId === item.node.entry.id ||
              hoveredId === item.node.entry.id
            }
          />
        ),
      )}
    </>
  );
});

function fixed2(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function ProjectNode({
  item,
  hasLogo,
  dim,
  lit,
  named,
}: {
  item: SceneNode;
  hasLogo: boolean;
  dim: boolean;
  lit: boolean;
  named: boolean;
}) {
  const { entry, slot, lines } = item.node;
  const state = lit ? " is-lit" : dim ? " is-dim" : "";
  // The transform sits on a <g>: React types an <a> as the HTML element, which has no
  // transform attribute, and an SVG link inside a positioned group behaves identically.
  return (
    <g
      transform={`translate(${fixed(item.x)} ${fixed(item.y)}) scale(${fixed2(item.scale)})`}
      opacity={item.fade < 1 ? fixed2(item.fade) : undefined}
    >
      <a
        href={entry.url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`${entry.name} (opens in a new tab)`}
        data-eco-id={entry.id}
        className={`eco-node flow-${slot}${state}`}
      >
        <circle r={NODE_R} className="eco-plate" />
        {hasLogo ? (
          <image
            href={`/ecosystem/logos/${entry.id}.png`}
            x={-ICON / 2}
            y={-ICON / 2}
            width={ICON}
            height={ICON}
            aria-hidden
          />
        ) : (
          <text textAnchor="middle" dominantBaseline="central" className="eco-initial" aria-hidden>
            {initial(entry.name)}
          </text>
        )}
        {named ? (
          // Anchored at the disc's foot, so a name scaled up for legibility grows downward from
          // where it would sit and never onto its own logo.
          <g
            transform={
              item.labelScale > 1
                ? `translate(0 ${NODE_R}) scale(${fixed2(item.labelScale)}) translate(0 ${-NODE_R})`
                : undefined
            }
          >
            {lines.map((line, i) => (
              <text
                key={i}
                y={NODE_R + 15 + i * LINE_H}
                textAnchor="middle"
                dominantBaseline="middle"
                className="eco-name"
                aria-hidden
              >
                {line}
              </text>
            ))}
          </g>
        ) : null}
      </a>
    </g>
  );
}
