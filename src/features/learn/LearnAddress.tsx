import { CHIP } from "./learn-ui";

export interface LearnAddressProps {
  address: string;
  /** Whose it is, said as a chip beside it. */
  owner?: "you" | "exchange";
  /**
   * `wallet` (default) shortens only long unified addresses, as a wallet's receive screen does;
   * `short` cuts every address to its ends, as an explorer's list does.
   */
  variant?: "wallet" | "short";
}

/**
 * An address as the learning page shows it: shortened the way wallets and explorers do, with
 * the whole string in its title so it can still be read and checked.
 */
export function LearnAddress({ address, owner, variant = "wallet" }: LearnAddressProps) {
  const shown =
    variant === "short"
      ? `${address.slice(0, 8)}…${address.slice(-6)}`
      : address.length <= 40
        ? address
        : `${address.slice(0, 12)}…${address.slice(-8)}`;
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-1.5">
      <span title={address} className="break-all text-ink">
        {shown}
      </span>
      {owner ? (
        <span
          className={`${CHIP} ${owner === "you" ? "border-green-dim text-green" : "border-edge-faint text-ink-dim"}`}
        >
          {owner}
        </span>
      ) : null}
    </span>
  );
}
