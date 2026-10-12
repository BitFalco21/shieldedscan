export interface SwapIconProps {
  className?: string;
}

/** A crossing between chains: the arrow across a chain boundary. Decorative; a label names it. */
export function SwapIcon({ className = "" }: SwapIconProps) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    >
      <path d="M4 12h15M15 8l4 4-4 4M12 3v3M12 18v3" />
    </svg>
  );
}
