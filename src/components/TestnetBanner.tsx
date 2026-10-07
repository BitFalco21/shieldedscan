import { MAINNET_SITE_URL, isTestnet } from "@/lib/network";

/**
 * The unmissable testnet marker — a full-width strip above the nav on every page of the
 * testnet deployment, and nothing at all on mainnet. Testnet coins (TAZ) have no value, and a
 * figure quoted off this site must never be mistakable for real ZEC.
 *
 * Amber, not green: green is this site's privacy signal and the banner is a warning. It renders
 * only where NEXT_PUBLIC_NETWORK=testnet.
 *
 * A plain link, not `next/link`: it leaves this deployment for the mainnet one. It points at the
 * mainnet root — the path-preserving toggle lives in the footer; the banner's job is escape.
 */
export function TestnetBanner() {
  if (!isTestnet) return null;
  return (
    <div className="border-b border-warn-edge bg-warn-wash px-6 py-2 text-center text-xs">
      <span className="font-bold tracking-[0.14em] text-warn uppercase">testnet</span>
      <span className="text-ink-dim">
        {" "}
        — this is the Zcash test network. Coins here (TAZ) have no value.{" "}
      </span>
      <a
        href={MAINNET_SITE_URL}
        className="font-bold whitespace-nowrap text-warn underline underline-offset-2 hover:text-ink-bright"
      >
        switch to mainnet →
      </a>
    </div>
  );
}
