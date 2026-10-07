import Link from "@/components/Link";
import { Badge, type BadgeHue, type BadgeTone } from "@/components/Badge";
import { CopyButton } from "@/components/CopyButton";
import { DataTable, type TableColumn } from "@/components/DataTable";
import { HashLink } from "@/components/HashLink";
import { InfoTip } from "@/components/InfoTip";
import { PageHeader } from "@/components/PageHeader";
import { Panel } from "@/components/Panel";
import { ZnsExplorerChip } from "@/components/ZnsExplorerChip";
import {
  formatZnsName,
  znsActionVerb,
  type ZnsLookup,
  type ZnsEventAction,
  type ZnsNameEvent,
  type ZnsRegistration,
} from "@/domain";
import {
  formatCount,
  formatDateLong,
  formatUtc,
  formatZecAmount,
  shortHash,
  timeAgo,
} from "@/lib/format";
import { coinTicker } from "@/lib/network";

export interface NamePageProps {
  /** A lookup that found a registration, a history, or both — never a withheld one. */
  lookup: ZnsLookup;
}

/**
 * address and take it away. The address leads, whole and copyable; the dates read as dates;
 * the marketplace appears only when the name is for sale; and the history reads the same on a
 * phone as on a desktop.
 *
 * The trust caveat — a registration says where its REGISTRANT pointed the name, nothing about
 * who holds the address, because a claim needs no proof of control — sits behind the `?` on
 * "RESOLVES TO", the same place the address page's chip puts it.
 */
export function NamePage({ lookup }: NamePageProps) {
  const registration = lookup.registrations[0] ?? null;
  const name = lookup.query;
  const latest = lookup.history[0];
  const status: NameStatus = registration
    ? registration.listingPriceZat !== null
      ? "for sale"
      : "registered"
    : latest?.action === "RELEASE"
      ? "released"
      : "not registered";
  const since = registration
    ? { verb: znsActionVerb(registration.lastAction), timestamp: registration.timestamp }
    : latest
      ? { verb: znsActionVerb(latest.action), timestamp: latest.timestamp }
      : null;

  return (
    <>
      {/* The heading is the name alone; the badge sits on the line beneath, since inside the
          <h1> it would fuse into the heading's text for screen readers and copy. */}
      <PageHeader
        breadcrumb={[{ label: "HOME", href: "/" }, { label: "ZCASH NAME" }]}
        title={<span className="text-3xl break-all sm:text-4xl">{formatZnsName(name)}</span>}
      >
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-dim">
          <StatusBadge status={status} />
          {since ? (
            <span data-zns-since>
              {since.verb} {formatDateLong(since.timestamp)} ·{" "}
              {timeAgo(since.timestamp, lookup.asOf)}
            </span>
          ) : null}
        </p>
      </PageHeader>

      {/* The full column, like every other page. */}
      {registration ? (
        <AddressPanel registration={registration} />
      ) : (
        <Panel>
          <p data-zns-unregistered className="text-sm text-ink-dim">
            {status === "released"
              ? "This name was released and points nowhere now. Its history is below."
              : "This name is not registered right now. Its history is below."}
          </p>
        </Panel>
      )}

      {lookup.history.length > 0 ? <History events={lookup.history} name={name} /> : null}

      <p className="mt-3 text-xs leading-relaxed text-ink-faint">
        From the{" "}
        <a
          href="https://www.zcashnames.com"
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          Zcash Name System
        </a>{" "}
        registry, every transaction checked against this explorer&apos;s chain.
      </p>
    </>
  );
}

type NameStatus = "registered" | "for sale" | "released" | "not registered";

/**
 * Green only for a live registration: green on this site means something is in force. The
 * site's one badge size, so FOR SALE here and LISTED in the history read as the same mark.
 */
function isLive(status: NameStatus): boolean {
  return status === "registered" || status === "for sale";
}

function StatusBadge({ status }: { status: NameStatus }) {
  return (
    <span data-zns-status className="inline-flex">
      <Badge tone={isLive(status) ? "accent" : "outline"}>{status}</Badge>
    </span>
  );
}

function AddressPanel({ registration: r }: { registration: ZnsRegistration }) {
  return (
    // The section label is the Panel title, as on every panel; the `?` is its hint, beside the
    // heading rather than inside it, so the heading's name is "RESOLVES TO" alone.
    <Panel
      title="RESOLVES TO"
      hint={
        <InfoTip
          label="Resolves to"
          text="A Zcash name is chosen by whoever registers it. It shows where they pointed it, not who holds this address."
        />
      }
    >
      {/* ~48 characters a line, so the address can be checked by eye before paying. The two
          actions are icons at its end: copy, and an arrow to the address page, which carries
          `?name=` so the chip there re-checks the name. */}
      <p className="max-w-[48ch] font-mono text-base leading-relaxed break-all text-ink-bright">
        {r.address}
        <span className="ml-1 inline-flex items-center gap-2 align-middle whitespace-nowrap">
          <CopyButton value={r.address} label="address" />
          <Link
            href={`/address/${r.address}?name=${r.name}`}
            aria-label="Open address page"
            title="Open address page"
            className="text-ink-faint hover:text-green"
          >
            →
          </Link>
        </span>
      </p>

      {r.listingPriceZat !== null ? (
        <div data-zns-listing className="mt-6 border-t border-edge-faint pt-5 text-sm">
          <div className="microlabel">FOR SALE</div>
          {/* The price and the way to act on it share a row; the link is a chip in the site's
              primary-action style, since it is the one thing a reader can do here. It wraps
              under the price on a narrow screen. */}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="text-base whitespace-nowrap text-ink-bright tabular-nums">
              {formatZecAmount(r.listingPriceZat)} {coinTicker}
            </span>
            {/* Their explorer, filtered to this name. Buying happens there, never here. */}
            <ZnsExplorerChip name={r.name}>buy on zcashnames.com</ZnsExplorerChip>
          </div>
          <p className="mt-2 text-ink-dim">If bought, it will point wherever the buyer chooses.</p>
        </div>
      ) : null}
    </Panel>
  );
}

// DATE and POINTED AT drop on a phone, header and cells together (DataTable's rule), so the
// evidence columns — block and transaction — stay on screen; the header already dates the last
// action.
const ACTION_BADGE: Record<ZnsEventAction, { tone: BadgeTone; hue?: BadgeHue }> = {
  CLAIM: { tone: "hue", hue: "flow-4" },
  UPDATE: { tone: "hue", hue: "flow-2" },
  BUY: { tone: "hue", hue: "flow-5" },
  LIST: { tone: "hue", hue: "flow-1" },
  SETPRICE: { tone: "hue", hue: "flow-1" },
  DELIST: { tone: "neutral" },
  RELEASE: { tone: "faint" },
};

const HISTORY_COLUMNS: TableColumn[] = [
  { label: "ACTION" },
  { label: "DATE", className: "hidden sm:table-cell" },
  { label: "BLOCK" },
  { label: "TRANSACTION" },
  { label: "POINTED AT", className: "hidden sm:table-cell" },
  { label: "PRICE", align: "right" },
];

/**
 * The name's history as a block explorer shows a list: one row per action, labelled columns, the
 * block and the transaction each a link to its own page. Every cell is one unbreakable unit, so a
 * narrow screen scrolls the table rather than splitting a height or a hash across lines.
 *
 * Each action's badge has its own colour: the three actions that point the name at an address
 * each get a hue (claimed emerald, updated azure, bought violet), the two price events share
 * the marketplace's gold, and the two that undo something stay neutral ink. The hues are the
 * flow palette's, at the shared `Badge` size. The word always names the action; the colour
 * only helps a reader scan.
 */
function History({ events, name }: { events: ZnsNameEvent[]; name: string }) {
  return (
    <Panel title="HISTORY" className="mt-3">
      <DataTable
        caption={`History of ${formatZnsName(name)}, newest first`}
        columns={HISTORY_COLUMNS}
      >
        {events.map((e) => (
          <tr
            key={`${e.txid}-${e.action}`}
            data-zns-event
            className="row-hover hairline-b last:border-0"
          >
            <td className="whitespace-nowrap">
              <span data-zns-action={e.action} className="inline-flex">
                <Badge {...ACTION_BADGE[e.action]}>{znsActionVerb(e.action)}</Badge>
              </span>
            </td>
            <td
              className="hidden whitespace-nowrap text-ink-dim sm:table-cell"
              title={formatUtc(e.timestamp)}
            >
              {formatDateLong(e.timestamp)}
            </td>
            <td className="whitespace-nowrap tabular-nums">
              <Link href={`/block/${e.height}`} className="text-green hover:underline">
                {formatCount(e.height)}
              </Link>
            </td>
            <td className="whitespace-nowrap">
              <HashLink value={e.txid} href={`/tx/${e.txid}`} edge={6} copyable />
            </td>
            <td className="hidden whitespace-nowrap sm:table-cell">
              {e.address ? (
                <Link
                  href={`/address/${e.address}?name=${name}`}
                  className="font-mono text-green hover:underline"
                  title={e.address}
                >
                  {shortHash(e.address, 6)}
                </Link>
              ) : (
                <span className="text-ink-faint" aria-label="no address">
                  —
                </span>
              )}
            </td>
            <td className="text-right whitespace-nowrap tabular-nums">
              {/* A dash for "this action carries no price" — a claim or an update simply has
                  none. Not a shielded value, which is never a dash; nothing is hidden here. */}
              {e.priceZat === null ? (
                <span className="text-ink-faint" aria-label="no price">
                  —
                </span>
              ) : (
                `${formatZecAmount(e.priceZat)} ${coinTicker}`
              )}
            </td>
          </tr>
        ))}
      </DataTable>
    </Panel>
  );
}
