import Link from "@/components/Link";

export interface PaginationStepProps {
  /** Where this step goes; `null` renders it as unavailable rather than hiding it. */
  href: string | null;
  /** What the control shows — may be a bare arrow. */
  label: string;
  /**
   * What the control says. Required because the step controls are arrows only: "→" is not a
   * name, and "link, right arrow" conveys nothing about where it goes. Doubles as the tooltip.
   */
  description: string;
}

/**
 * One control in a pagination bar, shared by the keyset and offset bars so the two read
 * identically on the pages that still differ underneath.
 *
 * An unavailable step stays on screen, dimmed: the ends of a list are easier to recognise
 * when the controls hold their position instead of appearing and disappearing under the
 * cursor. It also carries `aria-disabled`, so that state reaches a screen reader rather
 * than being expressed by opacity alone.
 */
export function PaginationStep({ href, label, description }: PaginationStepProps) {
  if (href === null) {
    return (
      <span
        aria-disabled="true"
        aria-label={description}
        className="px-3 py-1 whitespace-nowrap opacity-40"
      >
        {label}
      </span>
    );
  }
  return (
    <Link
      href={href}
      aria-label={description}
      title={description}
      className="panel px-3 py-1 whitespace-nowrap hover:text-green"
    >
      {label}
    </Link>
  );
}
