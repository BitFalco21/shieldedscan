import Link from "@/components/Link";
import type { NetClientShare, NetNodePage, NetNodeRow } from "@/domain";
import { share, uptimeTier } from "@/domain";
import { ClientMark } from "@/components/ClientMark";
import { CursorPagination } from "@/components/CursorPagination";
import { DataTable } from "@/components/DataTable";
import { FilterChips } from "@/components/FilterChips";
import { FilterPopover } from "@/components/FilterPopover";
import { Panel } from "@/components/Panel";
import { formatCount, timeAgo } from "@/lib/format";
import { formatWindow, netPct, shortAsnOrg } from "../net-format";
import { tierToneClass } from "../net-palette";
import { NetBar } from "../NetBar";
import { networkNodesHref } from "./networkNodesHref";
import { EmptyState } from "@/components/EmptyState";

export interface HostingNetworkOption {
  asn: number | null;
  org: string;
  count: number;
}

export interface NodesListPageProps {
  page: NetNodePage;
  /** The clients the software chips offer, from the summary — the whole answering set's. */
  clients: NetClientShare[];
  /** The hosting networks the menu offers: the largest, from the health tab's ranking. */
  hostingNetworks: HostingNetworkOption[];
  /** The read's instant, for "last seen … ago". */
  now: number;
  /** The answering window, from the summary, so the subtitle states the window the API used. */
  windowSeconds: number;
  newerHref: string | null;
  olderHref: string | null;
  newestHref: string | null;
  oldestHref: string | null;
}

/**
 * Every answering node, one row each, most-answering first. A row is a one-way hash of the
 * address and nothing on it can be reversed into one — the page says so under the table.
 *
 * The sentence above the table prints the API's echoed filter, not the requested one, so a
 * reader sees what was actually applied; the adapter already refuses a mismatch.
 */
export function NodesListPage({
  page,
  clients,
  hostingNetworks,
  now,
  windowSeconds,
  newerHref,
  olderHref,
  newestHref,
  oldestHref,
}: NodesListPageProps) {
  const applied = page.applied;
  const filtered = applied.client !== null || applied.asn !== null;
  const appliedOrg =
    applied.asn === null
      ? null
      : (hostingNetworks.find((h) => h.asn === applied.asn)?.org ??
        page.items.find((r) => r.asn === applied.asn)?.asnOrg ??
        `AS${applied.asn}`);
  const hostedOnLabel = appliedOrg === null ? "all networks" : shortAsnOrg(appliedOrg);

  return (
    <div className="grid min-w-0 gap-3.5">
      <p className="net-found" data-total={page.total} data-denominator={page.denominator}>
        A total of <b className="tabular-nums">{formatCount(page.total)}</b>{" "}
        {applied.client !== null ? `${applied.client} ` : ""}
        {page.total === 1 ? "node" : "nodes"} found
        {appliedOrg !== null ? ` hosted on ${shortAsnOrg(appliedOrg)}` : ""}
        {filtered ? (
          <span className="text-sm text-ink-faint"> · of {formatCount(page.denominator)}</span>
        ) : null}
        <small className="mt-0.5 block text-[12.5px] font-normal text-ink-faint">
          answered a handshake in the last {formatWindow(windowSeconds)}
        </small>
      </p>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <FilterChips
          ariaLabel="Filter by software"
          label="software"
          activeValue={applied.client ?? "all"}
          options={[
            {
              value: "all",
              label: "all",
              href: networkNodesHref({ client: null, asn: applied.asn }),
            },
            ...clients.map((c) => ({
              value: c.client,
              label: c.client,
              icon: <ClientMark client={c.client} size={13} />,
              href: networkNodesHref({ client: c.client, asn: applied.asn }),
            })),
          ]}
        />
        <nav aria-label="Filter by hosting network" className="flex items-center gap-2">
          <span className="microlabel text-ink-faint">hosted on</span>
          <FilterPopover
            ariaLabel={`${hostedOnLabel} — filter by hosting network`}
            filtered={applied.asn !== null}
            align="left"
            icon="caret"
            // Sized like the software chips beside it; otherwise the popover's label inherits
            // the body size and reads as a heading.
            label={<span className="microlabel">{hostedOnLabel}</span>}
          >
            <Link
              href={networkNodesHref({ client: applied.client, asn: null })}
              aria-current={applied.asn === null ? "page" : undefined}
              className={`microlabel rounded-sm px-2 py-1.5 whitespace-nowrap ${
                applied.asn === null ? "text-green" : "text-ink-dim hover:text-green"
              }`}
            >
              all networks
            </Link>
            {hostingNetworks
              .filter((h) => h.asn !== null)
              .map((h) => {
                const active = applied.asn === h.asn;
                return (
                  <Link
                    key={h.asn}
                    href={networkNodesHref({ client: applied.client, asn: h.asn })}
                    aria-current={active ? "page" : undefined}
                    className={`flex justify-between gap-3.5 rounded-sm px-2 py-1.5 text-xs whitespace-nowrap ${
                      active ? "text-green" : "text-ink-dim hover:text-green"
                    }`}
                    title={h.org}
                  >
                    <span>{shortAsnOrg(h.org)}</span>
                    <span className="text-ink-faint tabular-nums">{h.count}</span>
                  </Link>
                );
              })}
          </FilterPopover>
        </nav>
      </div>

      {/* `min-w-0` is load-bearing: a grid item's automatic minimum is its content's
          min-content width, and a table of nowrap cells is ~750px wide, so without it the
          whole tab scrolls sideways at 375px. With it the DataTable's own wrapper scrolls.
          The cells carry no padding (`.data-table` sets the gutters), so each header sits
          over its column. The two multi-word headers hold one line, and LOCATION gives the
          width back: it may break between city and country, never inside either. */}
      <Panel className="min-w-0">
        <DataTable
          caption="Answering nodes, most-answering first"
          columns={[
            { label: "node" },
            { label: "software" },
            { label: "location" },
            { label: "hosted on", className: "hidden sm:table-cell" },
            { label: "latency", align: "right" },
            { label: "answered our crawls", className: "whitespace-nowrap" },
            {
              label: "last seen",
              align: "right",
              className: "hidden whitespace-nowrap sm:table-cell",
            },
          ]}
        >
          {page.items.map((row) => (
            <NodeRow key={row.id} row={row} now={now} />
          ))}
        </DataTable>
        {page.items.length === 0 ? (
          <EmptyState inset className="mt-3">
            No answering node matches this filter. The chips above widen it.
          </EmptyState>
        ) : null}
        <CursorPagination
          newerHref={newerHref}
          olderHref={olderHref}
          newestHref={newestHref}
          oldestHref={oldestHref}
        />
      </Panel>
      <p className="text-xs text-ink-faint">
        Every answering node, one row each. A row is a one-way hash of the address and nothing on it
        can be reversed into one. Answered is our crawls it answered over those that tried it, since
        we first saw it. Nodes already connected to our own node turn our crawler away, because the
        two share an address, so most nodes score low here without being down.
      </p>
    </div>
  );
}

function NodeRow({ row, now }: { row: NetNodeRow; now: number }) {
  const answeredShare = row.attempted === 0 ? null : share(row.reached, row.attempted);
  return (
    <tr className="row-hover hairline-b">
      <td className="font-mono text-xs text-ink-dim tabular-nums">{row.id}</td>
      <td className="whitespace-nowrap">
        <span className="flex items-center gap-2">
          <ClientMark client={row.client} size={14} />
          <span>{row.client}</span>
          {row.version ? <small className="text-ink-faint">{row.version}</small> : null}
        </span>
      </td>
      <td>
        {row.city ? (
          <>
            <span className="whitespace-nowrap">{row.city}</span>{" "}
            <small className="whitespace-nowrap text-ink-faint">· {row.country}</small>
          </>
        ) : (
          <span className="whitespace-nowrap">
            {row.country ?? <span className="text-ink-faint">unplaced</span>}
          </span>
        )}
      </td>
      <td className="hidden text-ink-faint sm:table-cell" title={row.asnOrg ?? undefined}>
        {row.asnOrg === null ? "—" : shortAsnOrg(row.asnOrg)}
      </td>
      <td className="text-right whitespace-nowrap tabular-nums">
        {row.pingMs === null ? (
          <span className="text-ink-faint">—</span>
        ) : (
          `${Math.round(row.pingMs)} ms`
        )}
      </td>
      <td className="whitespace-nowrap">
        <span className="inline-grid grid-cols-[44px_auto] items-center gap-2">
          <NetBar
            share={answeredShare === null ? 0 : answeredShare.numerator / answeredShare.denominator}
            toneClass={tierToneClass(uptimeTier(answeredShare))}
            height={6}
          />
          <span className="tabular-nums">
            {answeredShare === null ? (
              <span className="text-ink-faint">—</span>
            ) : (
              <>
                {netPct(answeredShare.numerator, answeredShare.denominator)}
                <small className="text-ink-faint">
                  {" "}
                  · {row.reached} of {row.attempted}
                </small>
              </>
            )}
          </span>
        </span>
      </td>
      <td className="hidden text-right whitespace-nowrap text-ink-faint tabular-nums sm:table-cell">
        {timeAgo(row.lastReachable, now)}
      </td>
    </tr>
  );
}
