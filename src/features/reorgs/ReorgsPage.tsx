import type { ReorgEvent, ReorgSummary } from "@/domain";
import { utcDayFromSeconds } from "@/domain";
import { CopyButton } from "@/components/CopyButton";
import { CursorPagination } from "@/components/CursorPagination";
import { DataTable, type TableColumn } from "@/components/DataTable";
import { Panel } from "@/components/Panel";
import { HashLink } from "@/components/HashLink";
import { StatCard } from "@/components/StatCard";
import { StatGrid } from "@/components/StatGrid";
import { formatCount, formatUtc, shortHash, timeAgo } from "@/lib/format";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";

const COLUMNS: TableColumn[] = [
  { label: "HEIGHT" },
  { label: "DEPTH" },
  { label: "ORPHANED HASH" },
  { label: "REPLACED BY" },
  { label: "DETECTED", align: "right" },
];

/**
 * The orphaned block's hash: monospace, copyable for verification, and deliberately NOT
 * a link — that block is gone from our node, and a link would promise a page that 404s.
 */
function OrphanedHash({ hash }: { hash: string }) {
  return (
    <span className="inline-flex flex-col">
      <span className="inline-flex items-center">
        <span className="font-mono text-sm text-ink-dim" title={hash}>
          {shortHash(hash, 8)}
        </span>
        <CopyButton value={hash} label="orphaned block hash" />
      </span>
      <span className="text-[10px] tracking-[0.08em] text-ink-faint">no longer in the chain</span>
    </span>
  );
}

function EmptyReorgs({ since }: { since: number }) {
  return (
    <EmptyState
      note={
        <>
          Recording began {formatUtc(since)} and this log fills only as our node actually witnesses
          a reorganisation — there is no source to backdate it from. An empty table means our
          node&apos;s history has matched the network&apos;s since then.
        </>
      }
    >
      No reorgs observed yet.
    </EmptyState>
  );
}

export interface ReorgsPageProps {
  events: ReorgEvent[];
  summary: ReorgSummary;
  now: number;
  /** Href for the previous (newer) page; null when already at the head. */
  newerHref: string | null;
  /** Href for the next (older) page; null when there is no older page. */
  olderHref: string | null;
  /** Href for the head of the log; null when it is already on screen. */
  newestHref: string | null;
  /** Href for the oldest page; null when it is already on screen. */
  oldestHref: string | null;
}

export function ReorgsPage({
  events,
  summary,
  now,
  newerHref,
  olderHref,
  newestHref,
  oldestHref,
}: ReorgsPageProps) {
  return (
    <>
      <PageHeader
        eyebrow="CHAIN"
        title="Reorgs"
        lede={`Chain reorganisations our own node observed and rolled back — one node's view of tip churn since ${formatUtc(summary.observingSince)}, not a census of the network.`}
      />

      <StatGrid columns={3}>
        <StatCard
          label="REORGS OBSERVED"
          value={formatCount(summary.observedCount)}
          sub="since recording began"
        />
        <StatCard
          label="DEEPEST SEEN"
          value={
            summary.deepestDepth !== null
              ? `${summary.deepestDepth} ${summary.deepestDepth === 1 ? "block" : "blocks"}`
              : "none yet"
          }
          sub="depth 1 is routine"
        />
        <StatCard
          label="OBSERVING SINCE"
          value={utcDayFromSeconds(summary.observingSince)}
          sub="no records exist before this"
        />
      </StatGrid>

      {events.length === 0 && summary.observedCount === 0 ? (
        <div className="mt-3">
          <EmptyReorgs since={summary.observingSince} />
        </div>
      ) : events.length === 0 ? (
        // A deep page past the end of the log — events exist, just not here.
        <EmptyState className="mt-3">Nothing on this page of the log.</EmptyState>
      ) : (
        <>
          <Panel className="mt-3">
            <DataTable caption="Observed reorgs, newest first" columns={COLUMNS}>
              {events.map((event) => (
                <tr key={event.id} className="row-hover hairline-b last:border-0">
                  <td className="font-mono tabular-nums">#{formatCount(event.height)}</td>
                  <td className="text-ink-dim tabular-nums">
                    {event.depth} {event.depth === 1 ? "block" : "blocks"}
                  </td>
                  <td>
                    <OrphanedHash hash={event.orphanedHash} />
                  </td>
                  <td>
                    <HashLink
                      value={event.replacedBy}
                      href={`/block/${event.replacedBy}`}
                      edge={8}
                    />
                  </td>
                  <td
                    className="text-right text-xs text-ink-faint tabular-nums"
                    title={formatUtc(event.detectedAt)}
                  >
                    {timeAgo(event.detectedAt, now)}
                  </td>
                </tr>
              ))}
            </DataTable>
          </Panel>
          <CursorPagination
            newerHref={newerHref}
            olderHref={olderHref}
            newestHref={newestHref}
            oldestHref={oldestHref}
            rangeLabel={`${events.length} of ${formatCount(summary.observedCount)} observed`}
          />
        </>
      )}

      <Panel title="READING THIS PAGE" className="mt-3">
        <div className="max-w-3xl space-y-3 text-sm leading-relaxed text-ink-dim">
          <p>
            Two miners sometimes solve the same height within moments of each other. The network
            briefly holds two competing tips, then converges on the chain with more work behind it —
            and the losing block becomes an orphan. Any node following the chain, ours included,
            rolls its copy back and adopts the winner. That rollback is what each row records.
          </p>
          <p>
            <span className="text-ink">
              A depth-1 reorg is routine on a proof-of-work chain and is not a sign of an attack.
            </span>{" "}
            Deeper reorgs grow rapidly rarer; a divergence deeper than 100 blocks would stop our
            follower for human inspection rather than being rolled back unattended.
          </p>
          <p>
            Each row is checkable rather than taken on trust: the orphaned hash is the block we held
            — it survives only in this log — and the replacing hash is live on chain at the same
            height. This log records what our node witnessed, from the date shown above; it starts
            sparse because recording started then, and nothing here is backdated or collected from
            third parties.
          </p>
        </div>
      </Panel>
    </>
  );
}
