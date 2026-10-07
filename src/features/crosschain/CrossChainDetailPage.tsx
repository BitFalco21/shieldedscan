import type { CrossChainTransfer } from "@/domain";
import {
  classifyZcashAddress,
  protocolLabel,
  zcashAddressKindLabel,
  zcashAddressKindNote,
} from "@/domain";
import { ActionPanel } from "@/components/ActionPanel";
import { CopyButton } from "@/components/CopyButton";
import { PageHeader } from "@/components/PageHeader";
import { Panel } from "@/components/Panel";
import { HashLink } from "@/components/HashLink";
import { ProtocolLogo } from "@/components/ProtocolLogo";
import { StatusPill } from "@/components/StatusPill";
import { InfoTip } from "@/components/InfoTip";
import { TransferLeg } from "@/components/TransferLeg";
import { formatUsdExact, formatUtc, shortHash } from "@/lib/format";
import { venueName, venueTransferUrl } from "@/lib/venue-links";
import { legsOf } from "./transferView";
import { transferAction } from "./transferAction";

/**
 * One chain's record of the transfer: the hash it settled in, and the address involved.
 *
 * Block heights are deliberately absent: the venues publish their own chain's height (Maya's,
 * not Zcash's), which would be wrong under a "Zcash" heading. No chain row either — the panel
 * title already names the chain.
 */
function LegPanel({
  title,
  titleNote,
  txid,
  txHref,
  address,
  addressHref,
  addressNote,
}: {
  title: string;
  /**
   * A caveat about the whole leg, shown beside the panel title rather than under one field,
   * where it would read as a fact about that field.
   */
  titleNote?: string;
  txid: string | null;
  txHref: string | null;
  address: string | null;
  addressHref: string | null;
  addressNote: string | null;
}) {
  return (
    <Panel
      title={
        titleNote === undefined ? (
          title
        ) : (
          <span className="inline-flex flex-wrap items-baseline gap-x-2">
            {title}
            <span className="text-[10px] tracking-normal text-ink-faint normal-case">
              {titleNote}
            </span>
          </span>
        )
      }
      className="flex-1"
    >
      <dl className="space-y-3">
        <div>
          <dt className="microlabel">TRANSACTION HASH</dt>
          <dd className="mt-1 font-mono text-xs break-all">
            {txid === null ? (
              <em className="text-ink-dim">awaiting settlement</em>
            ) : txHref !== null ? (
              <HashLink value={txid} href={txHref} edge={8} copyable />
            ) : (
              <span title={txid} className="text-ink-dim">
                {shortHash(txid, 10)}
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt className="microlabel">ADDRESS</dt>
          <dd className="mt-1 font-mono text-xs break-all">
            {address === null ? (
              <em className="text-ink-dim">not published by the protocol</em>
            ) : addressHref !== null ? (
              <HashLink value={address} href={addressHref} edge={8} copyable />
            ) : (
              <span title={address} className="text-ink-dim">
                {shortHash(address, 10)}
              </span>
            )}
          </dd>
          {addressNote !== null ? (
            <dd className="mt-1 text-xs text-ink-dim">{addressNote}</dd>
          ) : null}
        </div>
      </dl>
    </Panel>
  );
}

export interface CrossChainDetailPageProps {
  transfer: CrossChainTransfer;
  zcashTxHref: string | null;
}

export function CrossChainDetailPage({ transfer, zcashTxHref }: CrossChainDetailPageProps) {
  const { source, destination } = legsOf(transfer);
  const venueUrl = venueTransferUrl(transfer);
  const kind = classifyZcashAddress(transfer.zcashAddress);
  const inbound = transfer.direction === "in";
  const action = transferAction(transfer);

  return (
    <>
      {/* The transfer ID lives here, copyable, and nowhere else — a row states each fact
          once. */}
      <PageHeader
        breadcrumb={[
          { label: "HOME", href: "/" },
          { label: "CROSS-CHAIN", href: "/cross-chain" },
          { label: "TRANSFER" },
        ]}
        title={inbound ? "Inbound to Zcash" : "Outbound from Zcash"}
        meta={
          <span className="inline-flex max-w-full min-w-0 items-center gap-1 font-mono">
            <span className="break-all text-ink-faint">{transfer.id}</span>
            <CopyButton value={transfer.id} label="transfer ID" />
          </span>
        }
      />

      {/* The same action box a transaction page opens with, so a crossing reads like every
          other action on the site. No dollar line under the sentence: VALUE AT SWAP below
          states the venue's figure, and each leg carries its own. */}
      <ActionPanel icon="swap" parts={action.parts} details={[]} />

      {/* The route, reading left to right, with the protocol that carried it in between. */}
      <Panel className="mt-3">
        <div className="flex flex-col items-stretch gap-4 lg:flex-row lg:items-center">
          <div className="flex-1">
            <LegLabel label="SOURCE" note={inbound ? action.farSideNote : null} />
            <TransferLeg {...source} role="from" />
          </div>

          <div className="flex shrink-0 flex-col items-center gap-1 px-2">
            <span className="inline-flex items-center gap-1.5 rounded-sm border border-edge-faint px-2.5 py-1 text-xs whitespace-nowrap text-ink-dim">
              <ProtocolLogo protocol={transfer.protocol} />
              {protocolLabel(transfer.protocol)}
              {/* The far leg of a swap is the one thing on this site that cannot be checked
                  against the Zcash chain, so it links to the venue's own record, as an arrow
                  inside the protocol badge. Rendered only for a real hash —
                  `venueTransferUrl` returns null for a locally generated surrogate id rather
                  than producing a dead link. `rel="noreferrer"` so the venue is not told
                  which page sent the visitor. */}
              {venueUrl !== null ? (
                <a
                  href={venueUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  aria-label={`Open this transfer on the ${venueName(transfer)} (opens a new tab)`}
                  title={`Open on the ${venueName(transfer)}`}
                  className="ml-0.5 text-ink-faint hover:text-green"
                >
                  ↗
                </a>
              ) : null}
            </span>
            <span aria-hidden className="text-lg text-ink-faint">
              ⟶
            </span>
          </div>

          <div className="flex-1">
            <LegLabel label="DESTINATION" note={inbound ? null : action.farSideNote} />
            <TransferLeg {...destination} role="to" />
          </div>
        </div>

        <div className="hairline-b my-4" />

        <div className="flex flex-wrap items-center gap-x-10 gap-y-4">
          <div>
            <div className="microlabel">STATUS</div>
            <div className="mt-1">
              <StatusPill status={transfer.status} />
            </div>
          </div>
          <div>
            <div className="microlabel">VALUE AT SWAP</div>
            <div className="mt-1 font-mono text-sm tabular-nums">
              {transfer.usdValueAtSwap === null ? (
                <em className="text-xs text-ink-dim">not published</em>
              ) : (
                formatUsdExact(transfer.usdValueAtSwap)
              )}
            </div>
          </div>
          <div>
            <div className="microlabel">SETTLED</div>
            <div className="mt-1 font-mono text-sm">{formatUtc(transfer.timestamp)}</div>
          </div>
        </div>
      </Panel>

      <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-stretch">
        <LegPanel
          title={`ZCASH LEG — ${zcashAddressKindLabel(kind)} BOUNDARY`}
          txid={transfer.zcashTxid}
          txHref={zcashTxHref}
          address={transfer.zcashAddress}
          addressHref={transfer.zcashAddress === null ? null : `/address/${transfer.zcashAddress}`}
          addressNote={zcashAddressKindNote(kind)}
        />
        <LegPanel
          title={`${transfer.counterpartChain} LEG — EXTERNAL CHAIN`}
          titleNote="not indexed by this explorer"
          txid={transfer.counterpartTxHash}
          txHref={null}
          address={transfer.counterpartAddress}
          addressHref={null}
          addressNote={null}
        />
      </div>

      {inbound ? (
        <div className="veil mt-3 px-4 py-3">
          <p className="text-xs leading-relaxed text-ink-dim">
            What happens after arrival is up to the recipient — funds may move behind the veil.
            That&apos;s the point of Zcash.
          </p>
        </div>
      ) : null}
    </>
  );
}

/**
 * A leg's label, with the far-side note as a tip beside it when that leg is not Zcash. `relative`
 * is load-bearing: it is the box the tip anchors to, so the tip starts at the label's left edge.
 */
function LegLabel({ label, note }: { label: string; note: string | null }) {
  return (
    <div className="microlabel relative mb-2 flex items-center">
      {label}
      {note === null ? null : <InfoTip text={note} label={`${label.toLowerCase()} chain`} />}
    </div>
  );
}
