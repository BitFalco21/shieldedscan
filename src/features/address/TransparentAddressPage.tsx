import Link from "@/components/Link";
import type { AddressLabel, Transaction, TransparentAddress } from "@/domain";
import { addressDeltaZat, addressLabel } from "@/domain";
import { ChainLogo } from "@/components/ChainLogo";
import { CopyButton } from "@/components/CopyButton";
import { DataTable } from "@/components/DataTable";
import { HashLink } from "@/components/HashLink";
import { CursorPagination } from "@/components/CursorPagination";
import { PageHeader } from "@/components/PageHeader";
import { Panel } from "@/components/Panel";
import { DIRECTION_COLUMN, TxDirectionCell } from "@/components/TxDirectionCell";
import { KindPill } from "@/components/KindPill";
import { LabelIcon } from "@/components/LabelIcon";
import { StatCard } from "@/components/StatCard";
import { StatGrid } from "@/components/StatGrid";
import { formatCount, formatUtc, formatZatUsd, formatZec, timeAgo } from "@/lib/format";

export interface TransparentAddressPageProps {
  info: TransparentAddress;
  txs: Transaction[];
  now: number;
  /**
   * Keyset controls: the history is served by an index seek that knows no total, so the page
   * shows no ordinal.
   */
  newerHref: string | null;
  olderHref: string | null;
  newestHref: string | null;
  oldestHref: string | null;
  /**
   * Null when the price feed is cold. A null drops the dollar line SILENTLY rather than
   * printing "unavailable" three times across one row — the ZEC figure is the fact here
   * and the conversion a convenience, which is the same trade `TxDetailPage` makes.
   */
  priceUsd: number | null;
}

// TYPE carries the shield and the word (what happened); DIRECTION carries the path the value
// took, which the word cannot say. Every row states two different facts.
const COLUMNS = [
  { label: "TXID" },
  { label: "TYPE" },
  DIRECTION_COLUMN,
  { label: "NET" },
  { label: "BLOCK" },
  { label: "SEEN", align: "right" as const },
];

/** A ZEC figure carrying the asset's own mark, so the unit reads before the number does. */
function ZecFigure({ zat }: { zat: number }) {
  return (
    <span className="inline-flex items-center gap-2">
      <ChainLogo chain="ZEC" emphasis="strong" />
      <span className="tabular-nums">{formatZec(zat)}</span>
    </span>
  );
}

/**
 * What this transaction did to this address's balance.
 *
 * Signed explicitly, because a bare number under a heading of NET would not say which way
 * it went. Red is reserved for negative deltas and an outgoing amount is exactly that, but the
 * sign carries the same message on its own, so it stays readable without the colour.
 */
function NetDelta({ tx, address }: { tx: Transaction; address: string }) {
  const delta = addressDeltaZat(tx, address);
  if (delta === 0) {
    // Reachable: a transaction can name this address on both sides and net to nothing.
    return <span className="text-ink-faint tabular-nums">0</span>;
  }
  const positive = delta > 0;
  return (
    <span className={`whitespace-nowrap tabular-nums ${positive ? "text-green" : "text-red"}`}>
      {positive ? "+" : "−"}
      {formatZec(Math.abs(delta))}
    </span>
  );
}

/**
 * The name tag, and the theft flag when there is one — the header's facts line.
 *
 * The name sits under the address rather than replacing it, unlike `/tx`: a reader lands here
 * to see the address itself, so the name is a note about the page's subject. The labelling
 * basis is recorded per entry, not printed.
 *
 * The flag is warn ink, not the accent: green is this site's privacy signal, and a theft flag
 * is a warning. It names who flagged it and links to their post, so the claim is theirs and
 * checkable rather than stated in this site's voice.
 */
function AddressNotes({ label }: { label: AddressLabel }) {
  return (
    <span className="flex flex-col items-start gap-3">
      <span
        data-name-tag
        className="inline-flex items-center gap-1.5 rounded-sm border border-edge px-2 py-0.5 text-xs text-ink-dim"
      >
        <LabelIcon />
        {label.name}
      </span>
      {label.flag ? (
        <span
          data-address-flag
          className="block max-w-xl rounded-sm border border-warn-edge bg-warn-wash px-3 py-2 text-xs text-ink"
        >
          This address was flagged by{" "}
          <a
            href={label.flag.href}
            rel="noreferrer"
            target="_blank"
            className="group text-warn underline underline-offset-2 hover:text-ink-bright"
          >
            <span>{label.flag.by}</span>{" "}
            <span aria-hidden className="font-extrabold">
              ↗
            </span>
            <span className="sr-only"> (opens a new tab)</span>
          </a>
          .
        </span>
      ) : null}
    </span>
  );
}

export function TransparentAddressPage({
  info,
  txs,
  now,
  priceUsd,
  newerHref,
  olderHref,
  newestHref,
  oldestHref,
}: TransparentAddressPageProps) {
  const label = addressLabel(info.address);
  return (
    <>
      {/* The address is the one string here a visitor will want to paste elsewhere, and it is
          too long to select by hand without error — hence the copy button inside the title. */}
      {/* The kind is the last crumb, with no eyebrow under it, so the title sits where /tx's
          and /block's do. */}
      <PageHeader
        breadcrumb={[{ label: "HOME", href: "/" }, { label: "TRANSPARENT ADDRESS" }]}
        titleVariant="identifier"
        title={
          <>
            <span>{info.address}</span>
            <CopyButton value={info.address} label="address" />
          </>
        }
        meta={label ? <AddressNotes label={label} /> : undefined}
        lede="Transparent addresses are fully public — balances and history below are visible to everyone, exactly like Bitcoin. For privacy, Zcash offers shielded addresses."
      />
      <StatGrid columns={3}>
        {/* A USD figure is allowed here because a transparent balance is public. BALANCE needs
            no qualifier: a current balance at a current price. RECEIVED and SENT do: they are
            lifetime sums, and without the qualifier "1,000 ZEC ≈ $473,000" would read as what
            the address received at the time, which these two numbers cannot support. */}
        <StatCard
          label="BALANCE"
          value={<ZecFigure zat={info.balanceZat} />}
          sub={priceUsd === null ? undefined : formatZatUsd(info.balanceZat, priceUsd)}
        />
        <StatCard
          label="TOTAL RECEIVED"
          value={<ZecFigure zat={info.totalReceivedZat} />}
          sub={
            priceUsd === null
              ? undefined
              : `${formatZatUsd(info.totalReceivedZat, priceUsd)} at today's price`
          }
        />
        <StatCard
          label="TOTAL SENT"
          value={<ZecFigure zat={info.totalSentZat} />}
          sub={
            priceUsd === null
              ? undefined
              : `${formatZatUsd(info.totalSentZat, priceUsd)} at today's price`
          }
        />
      </StatGrid>
      {/*
        The columns answer what an address page is for: what kind of transaction it was, which
        way value moved for this address, and when.
      */}
      <Panel title="TRANSACTIONS" className="mt-3">
        <DataTable caption={`Transactions for ${info.address}, newest first`} columns={COLUMNS}>
          {txs.map((tx) => (
            <tr key={tx.txid} className="row-hover hairline-b last:border-0">
              {/* The four list tables share one row shape: a one-line hash on a phone and from
                  `xl` (between, it may break after its ellipsis — see TxsListPage), and a time
                  that never splits into "8s / ago". */}
              <td className="whitespace-nowrap sm:max-xl:whitespace-normal">
                <HashLink value={tx.txid} href={`/tx/${tx.txid}`} edge={8} copyable />
              </td>
              <td>
                <KindPill tx={tx} />
              </td>
              <TxDirectionCell tx={tx} />
              <td className="text-xs">
                <NetDelta tx={tx} address={info.address} />
              </td>
              <td>
                {tx.blockHeight !== null ? (
                  <Link
                    href={`/block/${tx.blockHeight}`}
                    className="text-green tabular-nums hover:underline"
                  >
                    #{formatCount(tx.blockHeight)}
                  </Link>
                ) : (
                  <span className="microlabel text-ink-dim">PENDING</span>
                )}
              </td>
              <td
                className="text-right text-xs whitespace-nowrap text-ink-faint tabular-nums"
                title={formatUtc(tx.timestamp)}
              >
                {timeAgo(tx.timestamp, now)}
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
      />
    </>
  );
}
