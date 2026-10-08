export interface SearchIconProps {
  /** Sizing classes. Keep the size a multiple of 9px so each cell lands on whole pixels. */
  className?: string;
}

/**
 * A magnifying glass drawn on a 9×9 pixel grid, in `currentColor` so it takes the colour of
 * the control it sits in. Pixel cells rather than a stroked circle: the terminal look, and
 * `crispEdges` keeps them sharp. Decorative: the control carries the accessible name.
 */
export function SearchIcon({ className = "h-[18px] w-[18px]" }: SearchIconProps) {
  return (
    <svg
      viewBox="0 0 9 9"
      aria-hidden
      className={`shrink-0 ${className}`.trim()}
      fill="currentColor"
      shapeRendering="crispEdges"
    >
      <path d="M2 0h3v1H2zM1 1h1v1H1zM5 1h1v1H5zM0 2h1v3H0zM6 2h1v3H6zM1 5h1v1H1zM5 5h1v1H5zM2 6h5v1H2zM6 7h2v1H6zM7 8h2v1H7z" />
    </svg>
  );
}
