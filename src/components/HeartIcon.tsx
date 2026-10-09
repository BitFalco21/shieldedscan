export interface HeartIconProps {
  /** Sizing classes. Keep them multiples of 7×6px so each cell lands on whole pixels. */
  className?: string;
}

/**
 * A heart on a 7×6 pixel grid, drawn like `SearchIcon`: `currentColor` cells, kept sharp by
 * `crispEdges`. Decorative: the control carries the accessible name.
 */
export function HeartIcon({ className = "h-3 w-3.5" }: HeartIconProps) {
  return (
    <svg
      viewBox="0 0 7 6"
      aria-hidden
      className={`shrink-0 ${className}`.trim()}
      fill="currentColor"
      shapeRendering="crispEdges"
    >
      <path d="M1 0h2v1H1zM4 0h2v1H4zM0 1h7v2H0zM1 3h5v1H1zM2 4h3v1H2zM3 5h1v1H3z" />
    </svg>
  );
}
