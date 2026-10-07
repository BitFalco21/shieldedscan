import Link from "@/components/Link";
import type { ReactNode } from "react";
import { CopyButton } from "@/components/CopyButton";
import { InfoTip } from "@/components/InfoTip";
import { PageHeader } from "@/components/PageHeader";
import { Panel } from "@/components/Panel";
import { PoolBadge } from "@/components/PoolBadge";
import { PrivacyShield } from "@/components/PrivacyShield";
import {
  decodeUnifiedAddress,
  formatZnsName,
  znsActionVerb,
  type UnifiedReceiver,
  type ZnsRegistration,
} from "@/domain";
import { DecryptDemo } from "./DecryptDemo";
import { coinTicker, network } from "@/lib/network";
import { formatCount } from "@/lib/format";

export interface ShieldedAddressPageProps {
  address: string;
  kind: "sapling" | "unified";
  /**
   * The ZNS name the reader SEARCHED to get here, re-verified server-side to point at this
   * address — never a name looked up BY address. A claim does not prove control of the address
   * it names, so a standing reverse label would let anyone label anyone's address; a name the
   * reader typed is only the answer to their own question.
   */
  searchedName?: ZnsRegistration | null;
}

/**
 * A shielded address has no public history, so this page shows the absence rather than
 * explaining it: a one-line statement, then the dashboard a transparent address would get
 * (balance, transaction count, a history table) with every value a redaction bar, then three
 * one-sentence strips answering what a visitor arrives asking.
 *
 * Two things this page will not do:
 *
 *  - No viewing-key field, not even a disabled one. Rendering that control at all teaches
 *    visitors that pasting a key which reveals their entire history into a website is normal.
 *    The page says the opposite.
 *  - A receiver list is shown only when the decode is proven: `decodeUnifiedAddress` (ZIP 316:
 *    Bech32m + F4Jumble inverse + TLV) passes every official test vector and round-trips every
 *    successful decode back to the input string, refusing with null otherwise. Null renders no
 *    panel, never a partial list. The receiver set is public (it is the address string); which
 *    receiver any payment used is not, and the panel's caption says so.
 *
 * Accessibility: the four stat bars stand in for real per-address values, so they carry the
 * canonical `role="img"` pair. The mock history table is an illustration: its bars are
 * aria-hidden, and one sr-only sentence states the absence instead of twenty-four labels.
 */
export function ShieldedAddressPage({ address, kind, searchedName }: ShieldedAddressPageProps) {
  const unified = kind === "unified";
  const components = unified ? decodeUnifiedAddress(address) : null;
  // Honesty tag when the address belongs to the OTHER network — the classifier accepts
  // both, and a testnet address rendered under mainnet chrome unlabelled is a small lie.
  const addressNetwork =
    address.startsWith("utest1") || address.startsWith("ztestsapling1") ? "testnet" : "mainnet";
  const networkTag = addressNetwork === network ? "" : ` (${addressNetwork.toUpperCase()})`;
  return (
    <>
      {/* Copyable for the same reason as a transparent address: it is long, and a mistyped one
          silently looks up a different address. Copying the string reveals nothing — it is
          already in the URL bar, and there is no history to leak. */}
      {/* The kind, with its shield, is the last crumb, one line above the title, as on every
          detail page. */}
      <PageHeader
        breadcrumb={[
          { label: "HOME", href: "/" },
          {
            label: (
              <span className="inline-flex items-center gap-2 align-bottom">
                <PrivacyShield variant="shielded" />
                {unified ? `UNIFIED ADDRESS${networkTag}` : `SAPLING SHIELDED ADDRESS${networkTag}`}
              </span>
            ),
          },
        ]}
        titleVariant="identifier"
        title={
          <>
            <span>{address}</span>
            <CopyButton value={address} label="address" />
          </>
        }
      >
        {searchedName ? <SearchedName registration={searchedName} /> : null}
      </PageHeader>

      {/* The statement, one quiet line. */}
      <section className="veil flex flex-wrap items-baseline gap-x-2 gap-y-1 px-4 py-3 text-sm text-ink-dim">
        <span className="flex items-baseline gap-2 whitespace-nowrap text-ink">
          <PrivacyShield variant="shielded" />
          everything is private —
        </span>
        <span>
          balance, history, counterparties and memos are{" "}
          <span className="text-ink">encrypted on-chain</span>, readable only by the key holder.
          That is the point of Zcash.
        </span>
      </section>

      {/* The dashboard a transparent address would get, redacted. */}
      <Panel className="mt-3">
        <div className="hairline-b grid grid-cols-2 gap-4 pb-4 sm:grid-cols-4">
          <RedactedStat label="BALANCE" glyphs={`▓▓▓▓▓▓▓▓▓▓ ${coinTicker}`} />
          <RedactedStat label="TRANSACTIONS" glyphs="▓▓▓▓" />
          <RedactedStat label="FIRST SEEN" glyphs="▓▓▓▓▓▓▓" />
          <RedactedStat label="LAST ACTIVE" glyphs="▓▓▓▓▓▓▓" />
        </div>

        <div className="mt-4">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="microlabel">HISTORY</span>
              <DecryptDemo />
            </span>
            <span className="microlabel text-ink-faint normal-case">
              even the row count is private
            </span>
          </div>
          <p className="sr-only">
            History is encrypted on-chain: no rows can be shown, and even their count is private.
          </p>
          <div className="overflow-x-auto sm:overflow-x-visible">
            {/* The site's table look (`.data-table`: gutters, row height, the header rule) so the
                refused ledger reads as the same table a transparent address gets. Not the
                DataTable component: it is an illustration, with no sticky header to keep in view
                and a fixed layout so its bars cannot set the column widths. */}
            <table
              aria-label="history — encrypted on-chain"
              className="data-table w-full table-fixed border-collapse text-sm"
            >
              <thead>
                <tr className="microlabel text-left">
                  <th className="w-[42%] border-b border-edge-faint pb-2 font-normal">HASH</th>
                  <th className="hidden border-b border-edge-faint pb-2 font-normal sm:table-cell">
                    TYPE
                  </th>
                  <th className="border-b border-edge-faint pb-2 font-normal">VALUE</th>
                  <th className="border-b border-edge-faint pb-2 text-right font-normal">AGE</th>
                </tr>
              </thead>
              <tbody>
                {MOCK_ROWS.map((row, i) => (
                  <tr key={i} className={`hairline-b ${row.fade}`.trim()}>
                    <td>
                      <RedactedGlyphs glyphs="▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓" />
                    </td>
                    <td className="hidden sm:table-cell">
                      <RedactedGlyphs glyphs="▓▓▓▓▓" />
                    </td>
                    <td>
                      <RedactedGlyphs glyphs={row.value} />
                    </td>
                    <td className="text-right">
                      <RedactedGlyphs glyphs="▓▓▓" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Panel>

      {/* Three strips, one sentence each, in a panel; each strip's label is a sub-section
          label inside it. */}
      <Panel className="mt-3 text-sm text-ink-dim">
        <Strip label="WHAT IS PUBLIC">
          Aggregate activity only, never per-address —{" "}
          <Link href="/shielded" className="text-green hover:underline">
            the shielded pools
          </Link>{" "}
          carry live totals and{" "}
          <Link href="/txs?kind=shielded" className="text-green hover:underline">
            shielded transactions
          </Link>{" "}
          lists the activity.
        </Strip>
        <Strip label="THIS ADDRESS">
          {unified ? (
            <>
              A <code className="text-ink">u1…</code> unified address bundles Orchard, Sapling and
              optionally transparent receivers behind one string. Which one a payment used is also
              private.
            </>
          ) : (
            <>
              A <code className="text-ink">zs1…</code> address receives into the Sapling shielded
              pool — superseded by <code className="text-ink">u1…</code> unified addresses for new
              activity.
            </>
          )}
        </Strip>
        <Strip label="YOUR OWN BALANCE">
          If this address is yours, your wallet decrypts it locally.{" "}
          <span className="text-ink">
            Never paste a viewing key into a website, including this one
          </span>{" "}
          — that is why there is no field for it here.
        </Strip>
      </Panel>

      {/* The receivers this address publishes, decoded from the string itself and shown only
          when the decode round-trips (see the doc comment). Below the strips: claims first,
          technical unpacking last. The li is each row's ? tip's positioned ancestor. */}
      {components && (
        <Panel title="RECEIVERS" className="mt-3">
          <ul className="flex flex-col gap-3 text-sm text-ink-dim">
            {components.receivers.map((receiver, i) => (
              <li key={i} className="relative flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <ReceiverRow receiver={receiver} />
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-ink-faint">
            The receiver set is public — it is encoded in the address string itself. Which receiver
            a payment used stays private.
          </p>
        </Panel>
      )}
    </>
  );
}

/** Mock history rows: widths vary for realism, opacity fades the ledger out downward. */
const MOCK_ROWS = [
  { fade: "", value: "▓▓▓▓▓▓▓" },
  { fade: "opacity-75", value: "▓▓▓▓▓" },
  { fade: "opacity-60", value: "▓▓▓▓▓▓" },
  { fade: "opacity-40", value: "▓▓▓▓" },
  { fade: "opacity-25", value: "▓▓▓▓▓▓▓" },
  { fade: "opacity-10", value: "▓▓▓▓▓" },
] as const;

/** A stat cell whose value is genuinely unknowable: the canonical accessible redaction. */
function RedactedStat({ label, glyphs }: { label: string; glyphs: string }) {
  return (
    <div>
      <span className="microlabel block">{label}</span>
      <span
        role="img"
        aria-label="value shielded — encrypted on-chain"
        title="hidden by design — encrypted on-chain"
        data-decrypt-bar
        className="redact mt-1.5 inline-block max-w-full truncate text-sm"
      >
        {glyphs}
      </span>
    </div>
  );
}

/** A decorative bar in the mock ledger — hidden from screen readers, which get the
    sr-only sentence above the table instead of two dozen identical labels. */
function RedactedGlyphs({ glyphs }: { glyphs: string }) {
  return (
    <span
      aria-hidden
      title="hidden by design — encrypted on-chain"
      data-decrypt-bar
      className="redact inline-block max-w-full truncate text-sm"
    >
      {glyphs}
    </span>
  );
}

/**
 * One decoded receiver. A derived Sapling address links to its own page, which is generated
 * from the string alone and can never 404. A derived transparent address is plain text: its
 * page needs chain data, and an embedded t-address never used on-chain would be a dead link.
 * Orchard has no standalone address form, so the label is the row.
 */
function ReceiverRow({ receiver }: { receiver: UnifiedReceiver }) {
  switch (receiver.kind) {
    case "orchard":
      // The value cell says the useful thing in words: raw receiver bytes are consumable by no
      // wallet or tool. The row stays because whether an address carries an Orchard receiver is
      // real information; the decoder still exposes `receiverHex` for anything needing the bytes.
      return (
        <>
          <PoolBadge pool="orchard" />
          <span className="flex items-baseline whitespace-nowrap">
            shielded receiver
            <InfoTip
              label="orchard receiver"
              text="A diversifier plus the key senders encrypt payments to. Orchard deliberately has no address format of its own — a unified address is its only encoding."
            />
          </span>
          <span className="text-ink-faint">
            no standalone form — reachable only through this unified address
          </span>
        </>
      );
    case "sapling":
      return (
        <>
          <PoolBadge pool="sapling" />
          <span className="flex items-baseline whitespace-nowrap">
            shielded receiver
            <InfoTip
              label="sapling receiver"
              text="The standalone form of this Sapling receiver — a diversifier plus the key senders encrypt payments to. Paying it pays this unified address through Sapling."
            />
          </span>
          <Link
            href={`/address/${receiver.address}`}
            className="break-all text-green hover:underline"
          >
            {receiver.address}
          </Link>
        </>
      );
    case "p2pkh":
    case "p2sh":
      return (
        <>
          <PoolBadge pool="transparent" />
          <span className="flex items-baseline whitespace-nowrap">
            {receiver.kind === "p2pkh" ? "P2PKH receiver" : "P2SH receiver"}
            <InfoTip
              label="transparent receiver"
              text="The standalone form of this transparent receiver. Payments to it are public on-chain, exactly like any t-address."
            />
          </span>
          <span className="break-all text-ink">{receiver.address}</span>
        </>
      );
    case "unknown":
      return <span>unrecognised receiver (typecode {receiver.typecode})</span>;
  }
}

function Strip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="hairline-b grid gap-x-4 gap-y-1 py-3.5 first:pt-0 last:border-0 last:pb-0 sm:grid-cols-[12rem_1fr]">
      <span className="microlabel pt-0.5">{label}</span>
      <span>{children}</span>
    </div>
  );
}

/**
 * "zenith.zcash points here", with the transaction it rests on. Worded as where the REGISTRANT
 * pointed the name, because that is all a registration establishes — the `?` says so for anyone
 * who reads the name as the holder's identity.
 */
function SearchedName({ registration: r }: { registration: ZnsRegistration }) {
  return (
    <p
      data-zns-name
      className="relative mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-dim"
    >
      <Link
        href={`/name/${r.name}`}
        className="rounded-sm border border-edge px-2 py-0.5 text-ink hover:text-green"
      >
        {formatZnsName(r.name)}
      </Link>
      <span>
        points here · ZNS name {znsActionVerb(r.lastAction)} at block{" "}
        <Link href={`/tx/${r.txid}`} className="underline hover:text-green">
          {formatCount(r.height)}
        </Link>
      </span>
      {r.listingPriceZat !== null ? <span>· listed for sale</span> : null}
      <InfoTip
        label="Zcash name"
        text="A Zcash name is chosen by whoever registers it. It shows where they pointed it, not who holds this address."
      />
    </p>
  );
}
