import type { ImgHTMLAttributes } from "react";

export interface EcosystemLogoProps extends Omit<
  ImgHTMLAttributes<HTMLImageElement>,
  "src" | "alt" | "width" | "height"
> {
  /** The id of a committed icon under `public/ecosystem/logos/`. */
  logo: string;
  className?: string;
}

/**
 * An organisation's logo at 16 px, drawn before its name. Decorative: the name beside it is what
 * a screen reader hears. The icon is the reviewed file `/ecosystem` serves, from our own origin,
 * so the CSP needs nothing new.
 */
export function EcosystemLogo({ logo, className = "", ...rest }: EcosystemLogoProps) {
  return (
    // A committed 64 px icon from our own origin: next/image would add a loader round trip for
    // a file that is already small.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      {...rest}
      src={`/ecosystem/logos/${logo}.png`}
      alt=""
      aria-hidden
      width={16}
      height={16}
      className={`-my-0.5 h-4 w-4 shrink-0 rounded-sm ${className}`.trim()}
    />
  );
}
