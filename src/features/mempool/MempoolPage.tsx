import type { ReactNode } from "react";
import Link from "@/components/Link";
import type { MempoolComposition, MempoolEntry, MempoolStats, Transaction } from "@/domain";
import { publicValueZat } from "@/domain";
import { AmountZec } from "@/components/AmountZec";
import { DataTable, type TableColumn } from "@/components/DataTable";
import { Panel } from "@/components/Panel";
import { HashLink } from "@/components/HashLink";
import { Pagination } from "@/components/Pagination";
import { DIRECTION_COLUMN, TxDirectionCell } from "@/components/TxDirectionCell";
import { KindPill } from "@/components/KindPill";
import { PrivacyShield } from "@/components/PrivacyShield";
import { StatCard } from "@/components/StatCard";
import { StatGrid } from "@/components/StatGrid";
import { formatBytes, formatCount, shortHash, timeAgo } from "@/lib/format";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";

const COLUMNS: TableColumn[] = [
  { label: "TX HASH" },
  { label: "TYPE" },
  DIRECTION_COLUMN,
  { label: "VALUE", align: "right" },
  { label: "IN/OUT" },
  { label: "SIZE", align: "right" },
  { label: "FEE RATE", align: "right" },
  { label: "SEEN", align: "right" },
];

/**
 * Per-side structure counts, pool-typed: "1 transparent → 2 orchard".
 *
 * Sapling distinguishes spends from outputs; Orchard does not — an action carries a spend
 * slot and an output slot (possibly dummies), so its count appears on both sides. That is
 * the protocol's own resolution, not a rounding here.
 */
function ioSummary(tx: Transaction): { inputs: string[]; outputs: string[] } {
  const inParts: string[] = [];
  const outParts: string[] = [];
  if (tx.transparentInputs.length > 0) inParts.push(`${tx.transparentInputs.length} transparent`);
  if (tx.sprout !== null) inParts.push(`${tx.sprout.joinSplits} sprout`);
  if (tx.sapling !== null && tx.sapling.spends > 0) inParts.push(`${tx.sapling.spends} sapling`);
  if (tx.orchard !== null) inParts.push(`${tx.orchard.actions} orchard`);
  if (tx.transparentOutputs.length > 0)
    outParts.push(`${tx.transparentOutputs.length} transparent`);
  if (tx.sapling !== null && tx.sapling.outputs > 0) outParts.push(`${tx.sapling.outputs} sapling`);
  if (tx.orchard !== null) outParts.push(`${tx.orchard.actions} orchard`);
  return {
    inputs: inParts.length > 0 ? inParts : ["none"],
    outputs: outParts.length > 0 ? outParts : ["none"],
  };
}

/**
 * One side of the IN/OUT cell as count-and-pool atoms ("2 orchard"): a line may break between
 * them, never inside one, and the `·` stays on the atom before it. The arrow (`lead`) binds to
 * the first output, so it never ends a line pointing at nothing. Separate atoms keep the cell's
 * narrowest form small enough for the table to fit its panel at 1440px.
 */
function ioAtoms(side: string, parts: string[], lead = ""): ReactNode[] {
  const nodes: ReactNode[] = [];
  parts.forEach((part, i) => {
    if (i > 0) nodes.push(" ");
    nodes.push(
      <span key={`${side}${i}`} className="whitespace-nowrap">
        {`${i === 0 ? lead : ""}${part}${i < parts.length - 1 ? " ·" : ""}`}
      </span>,
    );
  });
  return nodes;
}

/** "6.7 zat/B"; the sub-zat rates real shielded transactions produce keep one decimal. */
function formatFeeRate(rate: number): string {
  return `${rate.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} zat/B`;
}

/**
 * The privacy make-up of the sampled entries, in ink. Counts beside dots, never a
 * percentage with an invisible denominator — the sample size is right there in the sub.
 */
function CompositionValue({ composition }: { composition: MempoolComposition }) {
  return (
    <span className="inline-flex items-center gap-3 text-lg font-bold text-ink-bright">
      <span className="inline-flex items-center gap-1.5">
        <PrivacyShield variant="shielded" />
        {composition.shielded}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <PrivacyShield variant="mixed" />
        {composition.mixed}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <PrivacyShield variant="transparent" />
        {composition.transparent}
      </span>
    </span>
  );
}

function EmptyMempool() {
  return <EmptyState>Nothing pending — every broadcast transaction has been mined.</EmptyState>;
}

export interface MempoolPageProps {
  entries: MempoolEntry[];
  stats: MempoolStats;
  /** Wall-clock seconds — mempool arrival times are node clock, not chain time. */
  now: number;
  page: number;
  totalPages: number;
}

export function MempoolPage({ entries, stats, now, page, totalPages }: MempoolPageProps) {
  const pageTxids = new Set(entries.map((entry) => entry.transaction.txid));
  const composition = stats.composition;

  return (
    <>
      <PageHeader
        eyebrow="UNCONFIRMED"
        title="Mempool"
        lede="The mempool differs between nodes — this is one node's view of pending transactions, not a canonical list."
      />

      <StatGrid columns={4}>
        <StatCard label="PENDING" value={formatCount(stats.pendingCount)} sub="transactions" />
        <StatCard label="TOTAL SIZE" value={formatBytes(stats.totalSizeBytes)} sub="in mempool" />
        <StatCard
          label="MEDIAN FEE RATE"
          value={
            stats.medianFeeRateZatPerByte !== null
              ? formatFeeRate(stats.medianFeeRateZatPerByte)
              : "no fees reported"
          }
          sub="what orders inclusion"
        />
        {composition !== null ? (
          <StatCard
            label="COMPOSITION"
            value={<CompositionValue composition={composition} />}
            sub={
              composition.sampled < stats.pendingCount
                ? `of ${composition.sampled} sampled — not the full mempool`
                : "shielded · mixed · transparent"
            }
          />
        ) : (
          <StatCard label="COMPOSITION" value="not sampled" sub="no entries classified" />
        )}
      </StatGrid>

      {entries.length === 0 ? (
        <div className="mt-3">
          <EmptyMempool />
        </div>
      ) : (
        <>
          <Panel className="mt-3">
            <DataTable caption="Pending transactions, newest seen first" columns={COLUMNS}>
              {entries.map(({ transaction: tx, seenAt, feeRateZatPerByte, dependsOn }) => {
                const io = ioSummary(tx);
                return (
                  <tr key={tx.txid} className="row-hover hairline-b last:border-0">
                    {/* One line for the hash at 1440px, as /txs renders it; between `sm` and
                        `lg` it may wrap (see TxsListPage). The "waits on" line beneath may still
                        wrap between its parents. */}
                    <td className="whitespace-nowrap sm:max-lg:whitespace-normal">
                      <HashLink value={tx.txid} href={`/tx/${tx.txid}`} edge={8} />
                      {dependsOn.length > 0 ? (
                        <div
                          className="mt-1 text-[10px] tracking-[0.08em] whitespace-normal text-ink-faint"
                          title="Spends an output of another pending transaction — miners cannot include this one before its parent."
                        >
                          ⧗ waits on{" "}
                          {/* A parent is one token: the line may break between parents, never
                              inside one ("dead03…" then "000000" on the next line). */}
                          {dependsOn.map((parent, index) => (
                            <span key={parent}>
                              {index > 0 ? ", " : ""}
                              <span className="whitespace-nowrap">
                                {pageTxids.has(parent) ? (
                                  <Link
                                    href={`/tx/${parent}`}
                                    className="text-green hover:underline"
                                  >
                                    {shortHash(parent, 6)}
                                  </Link>
                                ) : (
                                  <span title={parent}>{shortHash(parent, 6)}</span>
                                )}
                              </span>
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <KindPill tx={tx} />
                    </td>
                    <TxDirectionCell tx={tx} />
                    <td className="text-right whitespace-nowrap">
                      <AmountZec zat={publicValueZat(tx)} />
                    </td>
                    <td className="text-xs text-ink-dim">
                      {/* Breaks between atoms, never inside one (ioAtoms), so the table fits its
                          panel. Each side is its own inline-block, so the first break falls
                          before the arrow and a line never reads as a false in→out pair. */}
                      <span className="inline-block">{ioAtoms("in", io.inputs)}</span>{" "}
                      <span className="inline-block">{ioAtoms("out", io.outputs, "→ ")}</span>
                    </td>
                    {/* `whitespace-nowrap` here and on SEEN: "536 B" and "8s ago" are one
                        quantity each. */}
                    <td className="text-right whitespace-nowrap text-ink-dim tabular-nums">
                      {formatBytes(tx.sizeBytes)}
                    </td>
                    <td className="text-right whitespace-nowrap text-ink-dim tabular-nums">
                      {/*
                        A missing fee is a data gap on this node, not an encrypted value —
                        "unknown", never the veil, and never 0.0 reading as free.
                      */}
                      {tx.feeZat !== null ? (
                        formatFeeRate(feeRateZatPerByte)
                      ) : (
                        <em className="text-xs">unknown</em>
                      )}
                    </td>
                    <td
                      className="text-right text-xs whitespace-nowrap text-ink-faint tabular-nums"
                      title="when this node first saw it"
                    >
                      {timeAgo(seenAt, now)}
                    </td>
                  </tr>
                );
              })}
            </DataTable>
          </Panel>
          <Pagination page={page} totalPages={totalPages} hrefFor={(p) => `/mempool?page=${p}`} />
        </>
      )}

      <Panel title="READING THE MEMPOOL" className="mt-8">
        <div className="max-w-3xl space-y-3 text-sm leading-relaxed text-ink-dim">
          <p>
            The mempool is the waiting room: transactions broadcast to the network but not yet mined
            into a block. Miners pick from it roughly by fee rate — the fee paid per byte occupied —
            which is why that column matters more than the fee itself. A transaction marked{" "}
            <span className="text-ink">⧗ waits on</span> spends coins from another pending
            transaction and cannot be mined before its parent, whatever it pays.
          </p>
          {/*
            Stacked until `sm`, so each description gets the full column. From `sm` up every row
            is a two-column grid with the same fixed term column, so the descriptions share one
            left edge. Top-aligned rather than baseline: the term's first item is the shield, an
            SVG with no text baseline, and both cells share one line height.
          */}
          <dl className="space-y-3 sm:space-y-2">
            <div className="flex flex-col gap-1 sm:grid sm:grid-cols-[8.5rem_1fr] sm:items-start sm:gap-x-3">
              <dt className="flex items-center gap-2 text-ink">
                <PrivacyShield variant="shielded" /> shielded
              </dt>
              <dd>
                fully inside the shielded pools. Only the structure is public — how many actions,
                which pool, what fee. Amount, sender and recipient are encrypted here in the mempool
                and stay encrypted forever after it confirms.
              </dd>
            </div>
            <div className="flex flex-col gap-1 sm:grid sm:grid-cols-[8.5rem_1fr] sm:items-start sm:gap-x-3">
              <dt className="flex items-center gap-2 text-ink">
                <PrivacyShield variant="mixed" /> mixed
              </dt>
              <dd>
                crosses the shielded boundary: shielding, where transparent value enters the pools,
                or unshielding, where it leaves them. The transparent side — its addresses and
                amount — is public; the shielded side is not.
              </dd>
            </div>
            <div className="flex flex-col gap-1 sm:grid sm:grid-cols-[8.5rem_1fr] sm:items-start sm:gap-x-3">
              <dt className="flex items-center gap-2 text-ink">
                <PrivacyShield variant="transparent" /> transparent
              </dt>
              <dd>entirely public: addresses, amounts and fee, exactly as on Bitcoin.</dd>
            </div>
          </dl>
          <p>
            Redacted values on this page are not missing data — they are Zcash working as designed.
            Hidden by design, encrypted on-chain, visible only to holders of the viewing key.
          </p>
        </div>
      </Panel>
    </>
  );
}
