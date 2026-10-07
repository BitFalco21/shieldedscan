import Link from "@/components/Link";
import type { Transaction } from "@/domain";
import { publicValueZat, txDirectionLabel } from "@/domain";
import { AmountZec } from "@/components/AmountZec";
import { Panel } from "@/components/Panel";
import { PrivacyShield, privacyVariantFor } from "@/components/PrivacyShield";
import { liveRowClass } from "@/lib/live-row";
import { shortHash } from "@/lib/format";

export interface LatestTxsPanelProps {
  txs: Transaction[];
  /** Txids that arrived on the most recent poll. Empty on a server render. */
  freshIds?: readonly string[];
}

export function LatestTxsPanel({ txs, freshIds = [] }: LatestTxsPanelProps) {
  const fresh = new Set(freshIds);
  return (
    <Panel
      fill
      title="LATEST TRANSACTIONS"
      action={
        <Link href="/txs" className="text-[10px] tracking-widest text-ink-dim hover:text-green">
          see all →
        </Link>
      }
    >
      <ul className="grid h-full auto-rows-fr">
        {txs.map((tx) => (
          <li
            key={tx.txid}
            className={liveRowClass("hairline-b text-sm last:border-0", fresh.has(tx.txid))}
          >
            {/*
              The whole row is one link, so the hash renders as plain text rather
              than a nested anchor. Anything less makes users aim at a 9-character
              target to reach the transaction.
            */}
            <Link
              href={`/tx/${tx.txid}`}
              className="row-hover flex h-full items-center gap-3 rounded-sm px-1 py-2.5"
            >
              <PrivacyShield variant={privacyVariantFor(tx)} />
              <span className="text-green" title={tx.txid}>
                {shortHash(tx.txid)}
              </span>
              {/*
                `txDirectionLabel`, not `txKindLabel`: the shield already says shielded, mixed or
                transparent, so only the direction is added. Hidden below `sm`, where a large
                amount plus "UNSHIELDING" would overflow the panel at 375px; the full grammar is
                on /txs.
              */}
              <span className="text-xs whitespace-nowrap text-ink-faint max-sm:hidden">
                {txDirectionLabel(tx)}
              </span>
              <span className="ml-auto text-right">
                <AmountZec zat={publicValueZat(tx)} />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
