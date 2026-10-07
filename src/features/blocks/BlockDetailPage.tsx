import { network } from "@/lib/network";
import type { Block, BlockMiner, Transaction, TransparentOutput } from "@/domain";
import {
  blockFeesZat,
  blockSummaryOf,
  publicValueZat,
  feeDestinationSentence,
  targetSpacingSeconds,
} from "@/domain";
import { AmountZec } from "@/components/AmountZec";
import { DataTable, type TableColumn } from "@/components/DataTable";
import { FactGrid } from "@/components/FactGrid";
import { Panel } from "@/components/Panel";
import { AddressLink } from "@/components/AddressLink";
import { HashLink } from "@/components/HashLink";
import { KindPill } from "@/components/KindPill";
import { DIRECTION_COLUMN, TxDirectionCell } from "@/components/TxDirectionCell";
import { PageHeader } from "@/components/PageHeader";
import { formatBytes, formatCount, formatUtc, formatZec } from "@/lib/format";
import Link from "@/components/Link";
import { ShieldedMiner } from "./ShieldedMiner";

export interface BlockDetailPageProps {
  block: Block;
  txs: Transaction[];
  tipHeight: number;
  oldestHeight: number;
}

const TX_COLUMNS: TableColumn[] = [
  { label: "HASH" },
  { label: "TYPE" },
  DIRECTION_COLUMN,
  { label: "VALUE", align: "right" },
];

/**
 * An amount that is public by nature but may not be derivable.
 *
 * Deliberately not `AmountZec`: that renders `null` as the veil, which says "shielded —
 * encrypted on-chain". A fee we could not resolve is not shielded, it is merely unknown to
 * us, and borrowing the privacy grammar for our own gap would be a lie about the protocol.
 */
function PublicAmount({ zat, unknownNote }: { zat: number | null; unknownNote: string }) {
  if (zat === null) {
    return (
      <span className="text-sm text-ink-faint" title={unknownNote}>
        unknown
      </span>
    );
  }
  return (
    <span className="text-sm font-semibold text-ink-bright tabular-nums">{formatZec(zat)}</span>
  );
}

/** Who took the reward. A shielded coinbase is the veil, never the word "unknown". */
function MinerValue({ miner }: { miner: BlockMiner }) {
  if (miner.kind === "transparent") {
    return <AddressLink address={miner.address} edge={10} copyable />;
  }
  if (miner.kind === "shielded") {
    return <ShieldedMiner glyphs={6} />;
  }
  return <span className="text-sm text-ink-faint">no payee — the coinbase names no address</span>;
}

function FundingStreamValue({ streams }: { streams: TransparentOutput[] }) {
  if (streams.length === 0) {
    return <span className="text-sm text-ink-faint">none at this height</span>;
  }
  return (
    <ul className="space-y-1.5">
      {streams.map((stream) => (
        <li key={`${stream.address}:${stream.valueZat}`} className="flex flex-wrap gap-x-3 gap-y-1">
          {/* Copyable like every other address on a detail page: an elided address is useless
              without a way to take it whole. */}
          <AddressLink address={stream.address} edge={8} copyable />
          <span className="text-xs text-ink-dim tabular-nums">{formatZec(stream.valueZat)}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The header fields, behind a disclosure.
 *
 * Collapsed by default because nobody arrives at a block wanting its nonce — but the
 * people who do want it want it exactly, so nothing here is abbreviated or rounded away.
 * A commitment root that does not exist at this height is omitted rather than shown empty:
 * a pre-Sapling block has no final Sapling root, and a blank row would imply it does.
 */
function HeaderDetails({ block }: { block: Block }) {
  const facts = [
    {
      label: "VERSION",
      value: String(block.version),
      hint: "The block header format. It changes only at a network upgrade.",
    },
    {
      label: "DIFFICULTY",
      value: block.difficulty.toLocaleString("en-US", { maximumFractionDigits: 2 }),
      hint: `How hard it was to mine this block, relative to the easiest possible one. It adjusts every block so that blocks keep arriving about every ${targetSpacingSeconds(network, block.height)} seconds however much mining power is pointed at the chain.`,
    },
    {
      label: "BITS",
      value: block.bits,
      hint: "The difficulty target, packed into the four bytes the header actually stores. The DIFFICULTY figure above is this number made readable.",
    },
    {
      label: "NONCE",
      value: block.nonce,
      hint: "The value the miner varied until the block's hash met the target. It is the proof of work, and it is why finding a block takes real electricity.",
    },
    {
      label: "MERKLE ROOT",
      value: block.merkleRoot,
      hint: "One hash committing to every transaction in this block. Change any transaction and this changes, which is what makes the block tamper-evident.",
    },
    ...(block.finalSaplingRoot === null
      ? []
      : [
          {
            label: "FINAL SAPLING ROOT",
            value: block.finalSaplingRoot,
            hint: "A commitment to every Sapling note that exists as of this block. Shielded spends prove membership against a root like this one without revealing which note they spend.",
          },
        ]),
    ...(block.finalOrchardRoot === null
      ? []
      : [
          {
            label: "FINAL ORCHARD ROOT",
            value: block.finalOrchardRoot,
            hint: "The same commitment for the Orchard pool — the state every Orchard spend proves against.",
          },
        ]),
  ];

  return (
    <details className="panel mt-3 p-5">
      <summary className="disclosure microlabel text-green">MORE DETAILS</summary>
      <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {facts.map((fact) => (
          <div key={fact.label}>
            <dt className="microlabel">{fact.label}</dt>
            <dd className="mt-1 font-mono text-xs break-all text-ink">{fact.value}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

/**
 * A transaction's value, under the rule this explorer exists to get right.
 *
 * A fully shielded transfer has no public amount, not a small one. Showing its fee in an
 * amount column beside a transparent transfer's value would invite a false comparison.
 * `publicValueZat` draws that line and `AmountZec` renders the veil on the far side of it.
 */
function TxValue({ tx }: { tx: Transaction }) {
  return <AmountZec zat={publicValueZat(tx)} />;
}

export function BlockDetailPage({ block, txs, tipHeight, oldestHeight }: BlockDetailPageProps) {
  // Derived rather than carried: `confirmations` is tip-relative, and a block cached for an
  // hour would serve a stale count if the number travelled with it.
  const confirmations = tipHeight - block.height + 1;

  return (
    <>
      <PageHeader
        breadcrumb={[
          { label: "HOME", href: "/" },
          { label: "BLOCKS", href: "/blocks" },
          { label: `#${formatCount(block.height)}` },
        ]}
        title={
          <>
            Block <b className="text-green">#{formatCount(block.height)}</b>
          </>
        }
        actions={
          block.height > oldestHeight || block.height < tipHeight ? (
            <nav aria-label="Adjacent blocks" className="flex gap-3 text-xs text-ink-dim">
              {block.height > oldestHeight ? (
                <Link
                  href={`/block/${block.height - 1}`}
                  className="btn btn-secondary whitespace-nowrap"
                >
                  ← #{formatCount(block.height - 1)}
                </Link>
              ) : null}
              {block.height < tipHeight ? (
                <Link
                  href={`/block/${block.height + 1}`}
                  className="btn btn-secondary whitespace-nowrap"
                >
                  #{formatCount(block.height + 1)} →
                </Link>
              ) : null}
            </nav>
          ) : undefined
        }
        meta={
          <>
            <span>{formatCount(confirmations)} confirmations</span>
            <span>{formatUtc(block.timestamp)}</span>
            {block.coinbaseTag === null ? null : (
              // Miner-controlled text. React escapes it, and the parse boundary has already
              // stripped it to printable characters and capped its length.
              <span className="text-ink-faint" title="written into the coinbase by the miner">
                “{block.coinbaseTag}”
              </span>
            )}
          </>
        }
      />

      <FactGrid
        className="grid gap-3 sm:grid-cols-2"
        facts={[
          {
            label: "HASH",
            value: block.hash,
            hint: "This block's own identifier — the hash of its header, and the thing the next block points back to.",
          },
          {
            label: "PREVIOUS BLOCK",
            value: block.prevHash,
            hint: "The block this one builds on. Following these back links every block to the genesis block, which is what makes it a chain.",
          },
          { label: "SIZE", value: formatBytes(block.sizeBytes) },
          {
            label: "TRANSACTIONS",
            value: String(block.txids.length),
            hint: "How many transactions this block contains, including the coinbase that pays the miner.",
          },
        ]}
      />

      <FactGrid
        className="mt-3 grid gap-3 sm:grid-cols-2"
        facts={[
          {
            label: "BLOCK REWARD",
            hint: "Newly issued ZEC paid for mining this block. It halves on a fixed schedule, and part of it is directed to funding streams rather than to the miner.",
            value: (
              <PublicAmount
                zat={block.blockRewardZat}
                unknownNote="this block carries no coinbase"
              />
            ),
          },
          {
            label: "TOTAL FEES",
            hint: `Every fee paid by the transactions in this block. ${feeDestinationSentence(network, block.height)}`,
            value: (
              <PublicAmount
                zat={blockFeesZat(blockSummaryOf(block))}
                unknownNote="at least one transaction's inputs could not be resolved, so the total would be short by an unknown amount"
              />
            ),
          },
          {
            label: "MINER",
            hint: "Read from the coinbase: the miner is its largest transparent output. Zcash has no miner field, so this is derived rather than declared — and a miner is only NAMED where it wrote its own name into the block.",
            value: <MinerValue miner={block.miner} />,
          },
          {
            label: "FUNDING STREAMS",
            hint: "The share of each block reward that consensus directs to Zcash development funds rather than to the miner.",
            value: <FundingStreamValue streams={block.fundingStreams} />,
          },
        ]}
      />

      <HeaderDetails block={block} />

      <Panel title="TRANSACTIONS" className="mt-3">
        <DataTable caption={`Transactions in block ${block.height}`} columns={TX_COLUMNS}>
          {txs.map((tx) => (
            <tr key={tx.txid} className="row-hover hairline-b last:border-0">
              <td className="whitespace-nowrap">
                <HashLink value={tx.txid} href={`/tx/${tx.txid}`} edge={8} copyable />
              </td>
              <td>
                <KindPill tx={tx} />
              </td>
              <TxDirectionCell tx={tx} />
              <td className="text-right whitespace-nowrap">
                <TxValue tx={tx} />
              </td>
            </tr>
          ))}
        </DataTable>
      </Panel>
    </>
  );
}
