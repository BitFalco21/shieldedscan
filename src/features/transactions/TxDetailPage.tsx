import { network } from "@/lib/network";
import type { Transaction, ZcashTxCrossings } from "@/domain";
import { publicValueZat, feeDestinationSentence, txAction } from "@/domain";
import { AmountZec } from "@/components/AmountZec";
import { CopyButton } from "@/components/CopyButton";
import { ExportJsonButton } from "@/components/ExportJsonButton";
import { FactGrid, type Fact } from "@/components/FactGrid";
import { HashLink } from "@/components/HashLink";
import { KindPill } from "@/components/KindPill";
import { ActionPanel } from "@/components/ActionPanel";
import { PageHeader } from "@/components/PageHeader";
import { privacyVariantFor } from "@/components/PrivacyShield";
import { formatBytes, formatCount, formatUtc, formatZatUsd, formatZec } from "@/lib/format";
import { TxFlow } from "./TxFlow";
import { SwapLegStrip } from "@/features/crosschain/SwapLegStrip";
import Link from "@/components/Link";

export interface TxDetailPageProps {
  tx: Transaction;
  tipHeight: number;
  /**
   * Spot ZEC price, for the approximate USD figures beside public amounts. `null` when the
   * price feed has nothing — the ZEC amount then stands alone.
   */
  priceUsd: number | null;
  /**
   * The crossings this transaction is the Zcash leg of — usually none. Optional so a caller
   * that cannot know (a testnet build, where no venue bridges) simply passes nothing.
   */
  crossings?: ZcashTxCrossings;
}

/**
 * A public ZEC amount with its approximate dollar value.
 *
 * Only rendered for genuinely public amounts: a veiled value never gets a USD figure, because
 * pricing an amount asserts you know it. A missing price drops the dollar line silently — the ZEC
 * amount is the fact, the conversion a convenience.
 */
function ZecWithUsd({ zat, priceUsd }: { zat: number; priceUsd: number | null }) {
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-2">
      <span className="font-semibold text-ink-bright tabular-nums">{formatZec(zat)}</span>
      {priceUsd === null ? null : (
        <span className="text-xs text-ink-faint tabular-nums">{formatZatUsd(zat, priceUsd)}</span>
      )}
    </span>
  );
}

/**
 * A bundle's value balance, direction spelled out from the domain sign — positive means value
 * entered the pool. (The RPC states the inverse; the parse layer already negated it.)
 *
 * The arrow is a connector, not a direction: it always points at the phrase that explains the
 * amount. The sign and the preposition already state the direction, and an arrow relative to an
 * unstated frame of reference reads as backwards to half its readers. Prose uses `→` for "moved to"
 * site-wide (as `TxTypeBadges` does); `←` is reserved for navigation.
 */
function valueBalanceFact(pool: "Sapling" | "Orchard" | "Ironwood", balanceZat: number): Fact {
  const label = `${pool.toUpperCase()} VALUE BALANCE`;
  if (balanceZat === 0) {
    return { label, value: "0 — nothing crossed the pool boundary" };
  }
  const magnitude = formatZec(Math.abs(balanceZat));
  return {
    label,
    // FactGrid values break-all for the hash case; this one is prose, and "Orchard"
    // must not shatter mid-word at a panel edge.
    value: (
      <span className="break-normal">
        {balanceZat > 0
          ? `+${magnitude} → into the ${pool} pool`
          : `−${magnitude} → out of the ${pool} pool`}
      </span>
    ),
  };
}

/**
 * The block a confirmed transaction sits in: the height leads, the hash follows.
 *
 * The height is what a reader reads; the hash is the identifier they copy, and the only thing here
 * that names that exact block across a reorg. Both link to the block page — the hash by its own
 * URL, through `HashLink` — because an elided hash beside a clickable height reads as a control
 * that ought to work.
 */
function BlockFact({ height, hash }: { height: number | null; hash: string | null }) {
  if (height === null) {
    return <span className="text-ink-faint">pending — not yet in a block</span>;
  }
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-2">
      <Link
        href={`/block/${height}`}
        className="font-semibold text-green tabular-nums hover:underline"
      >
        #{formatCount(height)}
      </Link>
      {hash === null ? null : (
        <span className="text-xs">
          <HashLink value={hash} href={`/block/${hash}`} edge={6} copyable copyLabel="block hash" />
        </span>
      )}
    </span>
  );
}

/** How many swap strips show before the rest fold away; venues batch, up to 20 seen. */
const SWAP_LEGS_SHOWN = 2;

/**
 * The swap strips, with batches folded: a transaction that settled twenty crossings would
 * otherwise push the page's own subject below the fold. The count is always the exact total
 * the API reported, and a list the API capped says so — a bounded list is only honest beside
 * the number it was cut from.
 */
function SwapLegs({ crossings }: { crossings: ZcashTxCrossings }) {
  const { transfers, total } = crossings;
  const shown = transfers.slice(0, SWAP_LEGS_SHOWN);
  const folded = transfers.slice(SWAP_LEGS_SHOWN);
  const unlisted = total - transfers.length;
  return (
    <div className="mt-3 flex flex-col gap-2">
      {total > 1 ? (
        <p className="microlabel text-ink-dim">
          This transaction settled {formatCount(total)} crossings
        </p>
      ) : null}
      {shown.map((transfer) => (
        <SwapLegStrip key={transfer.id} transfer={transfer} />
      ))}
      {folded.length > 0 ? (
        <details>
          <summary className="disclosure microlabel text-green">
            {folded.length} more {folded.length === 1 ? "crossing" : "crossings"}
          </summary>
          <div className="mt-2 flex flex-col gap-2">
            {folded.map((transfer) => (
              <SwapLegStrip key={transfer.id} transfer={transfer} />
            ))}
          </div>
        </details>
      ) : null}
      {unlisted > 0 ? (
        <p className="text-xs text-ink-faint">
          Showing {transfers.length} of {formatCount(total)}.
        </p>
      ) : null}
    </div>
  );
}

/** The one element carrying the raw hex; both buttons read it from the DOM by this id. */
const RAW_HEX_ID = "raw-hex";

export function TxDetailPage({ tx, tipHeight, priceUsd, crossings }: TxDetailPageProps) {
  // Derived at render time, never carried on the transaction: a stored count would go
  // stale inside the CDN's cache window.
  const confirmations = tx.blockHeight !== null ? tipHeight - tx.blockHeight + 1 : null;
  // The hex is deliberately dropped from what the page passes on.
  const { rawHex: _rawHex, ...txWithoutRawHex } = tx;
  const value = publicValueZat(tx);

  /*
   * Order: value, then placement, then the mineability window, then encoding.
   *
   * The lead cell is always the value this transaction moved — a pool balance where one crossed,
   * PUBLIC VALUE where none did. NET TO SHIELDED stays out of this grid: it is in the flow panels
   * above, and these cells itemise it.
   *
   * FEE must be followed by BLOCK, never by an amount: `e2e/fees.spec.ts` attributes the first ZEC
   * figure within 48 characters after a `fee` label, so when FEE renders `none` or `unknown` the
   * next cell's amount would be read as the fee.
   */
  const facts: Fact[] = [
    // The pool balances lead, in protocol order (newest pool last, as everywhere else on the site).
    // Conditional, so a transparent transaction starts at PUBLIC VALUE. Every pool that moved is
    // itemised, including a migration's destination.
    ...(tx.sapling !== null ? [valueBalanceFact("Sapling", tx.sapling.valueBalanceZat)] : []),
    ...(tx.orchard !== null ? [valueBalanceFact("Orchard", tx.orchard.valueBalanceZat)] : []),
    ...(tx.ironwood !== null ? [valueBalanceFact("Ironwood", tx.ironwood.valueBalanceZat)] : []),
    {
      label: "PUBLIC VALUE",
      value:
        value !== null ? <ZecWithUsd zat={value} priceUsd={priceUsd} /> : <AmountZec zat={null} />,
      hint: "The total on transparent outputs — the part anyone can read. Anything inside a shielded pool is encrypted and is not counted here.",
    },
    {
      /*
       * A coinbase pays no fee — it collects the block's fees — so `feeZat` is null by
       * construction, not because anything failed to resolve. It renders "none"; "unknown" is
       * reserved for a fee that genuinely could not be derived. (`/v1` draws the same line:
       * `nonexistent` versus `indeterminate`.)
       */
      label: "FEE",
      value: tx.isCoinbase ? (
        <span className="text-ink-faint">none</span>
      ) : tx.feeZat !== null ? (
        <ZecWithUsd zat={tx.feeZat} priceUsd={priceUsd} />
      ) : (
        <span className="text-ink-faint">unknown</span>
      ),
      hint: tx.isCoinbase
        ? "A coinbase pays no fee. It is the transaction that creates the block reward and collects the fees every other transaction in the block paid."
        : `Zcash prices fees by ZIP-317 on logical actions. ${feeDestinationSentence(network, tx.blockHeight ?? tipHeight + 1)}`,
    },
    {
      // Directly after FEE by design — see the adjacency note above.
      label: "BLOCK",
      hint: "The block that includes this transaction.",
      value: <BlockFact height={tx.blockHeight} hash={tx.blockHash} />,
    },
    {
      label: "LOCK TIME",
      hint: "The earliest point a transaction may be mined. 0 means no restriction, which is almost always the case.",
      // Null cannot happen here in practice — the detail path always comes from the node,
      // which always has it — but the type says list paths may omit it, so honour that.
      value:
        tx.lockTime === null ? "—" : tx.lockTime === 0 ? "0 (no lock)" : formatCount(tx.lockTime),
    },
    {
      // Beside LOCK TIME, the other end of the window a transaction may be mined in, and below the
      // BLOCK that actually mined it (pinned by a test).
      label: "EXPIRY HEIGHT",
      value: tx.expiryHeight !== null ? `#${formatCount(tx.expiryHeight)}` : "none",
      hint: "The block height after which this transaction could no longer be mined. It stops a forgotten transaction from confirming unexpectedly weeks later.",
    },
    {
      label: "BINDING SIG",
      value: tx.bindingSigValid === null ? "n/a" : tx.bindingSigValid ? "✓ valid" : "✗ invalid",
      hint: "A signature proving the shielded value balances add up, without revealing any of the amounts. Only shielded transactions have one.",
    },
    {
      label: "VERSION",
      value: `${tx.version}${tx.version === 5 ? " (NU5)" : ""}`,
      hint: "The transaction format. Version 5 arrived with NU5 and is what Orchard transactions use.",
    },
    {
      // Last, and its own hint says why: fees are priced by ZIP-317 on logical actions, so
      // the size on the wire is the least consequential figure in this grid.
      label: "RAW SIZE",
      value: formatBytes(tx.sizeBytes),
      hint: "The transaction's size on the wire. Fees are priced by ZIP-317 on logical actions rather than by size, so a big transaction is not automatically an expensive one.",
    },
  ];

  const action = txAction(tx);

  return (
    <>
      {/* The txid is the title, with its copy button inside the <h1>: it is the one string on
          this page a visitor will paste elsewhere, and 64 hex characters are not selectable
          by hand without error. The kind pill and the export sit at the title row's right. */}
      <PageHeader
        breadcrumb={[
          { label: "HOME", href: "/" },
          tx.blockHeight !== null
            ? {
                label: `BLOCK #${formatCount(tx.blockHeight)}`,
                href: `/block/${tx.blockHeight}`,
              }
            : { label: "MEMPOOL" },
          { label: "TRANSACTION" },
        ]}
        titleVariant="identifier"
        title={
          <>
            <span>{tx.txid}</span>
            <CopyButton value={tx.txid} label="transaction ID" />
          </>
        }
        actions={
          <>
            <KindPill tx={tx} />
            {/* The hex is on the page once, below; both buttons read it from there rather than
                carrying extra copies through the RSC payload. */}
            <ExportJsonButton
              data={txWithoutRawHex}
              withRawHexFrom={RAW_HEX_ID}
              filename={`zcash-tx-${tx.txid.slice(0, 16)}.json`}
            />
          </>
        }
        meta={
          <>
            <span>
              STATUS{" "}
              <b className="text-ink">
                {confirmations !== null
                  ? `Confirmed · ${formatCount(confirmations)} confirmations`
                  : "Unconfirmed — in the mempool"}
              </b>
            </span>
            <span>
              TIME <b className="text-ink">{formatUtc(tx.timestamp)}</b>
            </span>
          </>
        }
      >
        {crossings !== undefined && crossings.transfers.length > 0 ? (
          <SwapLegs crossings={crossings} />
        ) : null}
        {/* What it did, as one sentence with the pools drawn inline, and what the chain does not
            record on its own line. The dollar figure prices only the amount the sentence states
            — a veiled amount is never priced. The fee is stated once, in FEE below; the flow's
            arrow keeps it only as the term reconciling the two sides' totals. */}
        <ActionPanel
          className="mt-3"
          icon={privacyVariantFor(tx)}
          parts={action.parts}
          details={
            action.amountZat !== null && priceUsd !== null
              ? [formatZatUsd(action.amountZat, priceUsd)]
              : []
          }
          limit={action.limit}
          limitLabel={action.limitLabel}
        />
      </PageHeader>

      <TxFlow tx={tx} />

      <FactGrid className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" facts={facts} />

      {tx.rawHex !== null ? (
        <details className="panel mt-3 p-5">
          <summary className="disclosure microlabel text-green">
            RAW TRANSACTION · {formatBytes(tx.rawHex.length / 2)}
          </summary>
          <div className="mt-3 flex items-start justify-between gap-3">
            <code
              id={RAW_HEX_ID}
              className="block max-h-64 overflow-y-auto font-mono text-xs break-all text-ink-faint"
            >
              {tx.rawHex}
            </code>
            <CopyButton fromElementId={RAW_HEX_ID} label="raw transaction hex" />
          </div>
        </details>
      ) : null}
    </>
  );
}
