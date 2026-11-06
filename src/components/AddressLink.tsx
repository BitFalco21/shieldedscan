import Link from "@/components/Link";
import { addressLabel, miningPoolOf } from "@/domain";
import { CopyButton } from "@/components/CopyButton";
import { HashLink } from "@/components/HashLink";
import { LabelIcon } from "@/components/LabelIcon";
import { MiningPoolMark } from "@/components/MiningPoolMark";

export interface AddressLinkProps {
  address: string;
  /** Characters kept at each end when the address has no name. Ignored when it has one. */
  edge?: number;
  /** Render a copy button carrying the full address. */
  copyable?: boolean;
  /**
   * The address is shown as a block's payout, so a mining pool's name applies to it. Off
   * everywhere else: a pool's name stays out of the histories of the addresses it pays.
   */
  asMiner?: boolean;
}

/**
 * A transparent address, shown by name where one is known and by its elided form otherwise.
 *
 * The one place that decides this: a page asks this component and never asks `addressLabel`
 * or `miningPoolOf` and formats the answer itself, so every page names an address the same way.
 *
 * A name is an attribution and the address is the fact underneath it, so three things survive
 * the substitution:
 *
 *  - the link still goes to the address's own page,
 *  - `title` still carries the full address, so a reader can check the name against it,
 *  - the copy button still copies the address. A name is a string no wallet, node or explorer
 *    can consume.
 *
 * The label's basis is recorded on every entry (`domain/address-label.ts`,
 * `domain/mining-pools.ts`) but not rendered.
 *
 * Stays a Server Component: only `CopyButton` crosses the client boundary.
 */
export function AddressLink({
  address,
  edge = 4,
  copyable = false,
  asMiner = false,
}: AddressLinkProps) {
  const miningPool = asMiner ? miningPoolOf(address) : null;
  const name = miningPool?.name ?? addressLabel(address)?.name;
  if (name === undefined) {
    return (
      <HashLink
        value={address}
        href={`/address/${address}`}
        edge={edge}
        copyable={copyable}
        copyLabel="address"
      />
    );
  }
  // Mirrors HashLink's wrapper: as two siblings under a `justify-between` parent, the link and
  // its copy button would spread to opposite ends of the row.
  return (
    <span className="inline-flex min-w-0 items-center">
      {miningPool ? (
        <MiningPoolMark miningPool={miningPool} className="mr-1.5" />
      ) : (
        <LabelIcon className="mr-1 text-green-dim" />
      )}
      <Link
        href={`/address/${address}`}
        title={address}
        className="truncate text-green hover:underline"
      >
        {name}
      </Link>
      {copyable ? <CopyButton value={address} label="address" /> : null}
    </span>
  );
}
