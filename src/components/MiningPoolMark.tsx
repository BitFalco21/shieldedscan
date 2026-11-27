import type { MiningPool } from "@/domain";
import { EcosystemLogo } from "@/components/EcosystemLogo";
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
  return <EcosystemLogo logo={miningPool.logo} data-mining-pool-logo className={className} />;
}
