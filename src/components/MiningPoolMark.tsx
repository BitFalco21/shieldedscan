import type { MiningPool } from "@/domain";
import { LabelIcon } from "@/components/LabelIcon";

export interface MiningPoolMarkProps {
  miningPool: MiningPool;
  className?: string;
}

/**
 * A mining pool's logo at 16 px, drawn before its name; the label glyph where it has none, so a
 * name never stands bare.
 *
 * Decorative: the name beside it is what a screen reader hears. The icon is the reviewed file
 * `/ecosystem` serves, from our own origin, so the CSP needs nothing new.
 */
export function MiningPoolMark({ miningPool, className = "" }: MiningPoolMarkProps) {
  if (miningPool.logo === null) {
    return <LabelIcon className={`text-green-dim ${className}`.trim()} />;
  }
  return (
    // A committed 64 px icon from our own origin: next/image would add a loader round trip for
    // a file that is already small.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/ecosystem/logos/${miningPool.logo}.png`}
      alt=""
      aria-hidden
      width={16}
      height={16}
      data-mining-pool-logo
      className={`h-4 w-4 shrink-0 rounded-sm ${className}`.trim()}
    />
  );
}
