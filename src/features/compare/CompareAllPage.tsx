import Link from "@/components/Link";
import type { MarketComparison, MarketSnapshot } from "@/domain";
import { compareToZecAll } from "@/domain";
import { ChainLogo } from "@/components/ChainLogo";
import { DataTable } from "@/components/DataTable";
import { DataUnavailable } from "@/components/DataUnavailable";
import { Panel } from "@/components/Panel";
import { formatMultiple, formatUsdCompact, formatUsdExact, formatUtc } from "@/lib/format";
import { CompareHeader } from "./CompareHeader";
import { CompareTabs } from "./CompareTabs";
import { compareHref } from "./compareHref";

export interface CompareAllPageProps {
  /** Null when the upstream snapshot is missing or too old to be honest. */
  snapshot: MarketSnapshot | null;
}

/**
 * One asset's row: what it is, what it is worth, and what one ZEC would be worth at that
 * market cap.
 *
 * The whole row links to that asset's own comparison, so the table doubles as the menu into
 * the detail view — the picker on the other tab, unfolded. `title` carries the exact market
 * cap for the same reason `CoinCard` does: `e2e/compare.spec.ts` reads it back and recomputes
 * the multiple, which is this page's central honesty check.
 */
function AssetRow({ comparison }: { comparison: MarketComparison }) {
  const { counterpart: asset, multiple, impliedPriceUsd } = comparison;
  return (
    <tr className="row-hover hairline-b align-middle last:border-0">
      <td>
        <Link href={compareHref(asset.id)} className="flex items-center gap-3">
          <ChainLogo chain={asset.symbol} fallbackChain={asset.id} />
          <span className="min-w-0">
            <span className="block truncate text-ink-bright">{asset.name}</span>
            <span className="block text-[11px] tracking-[0.12em] text-ink-faint">
              {asset.rank === null ? asset.symbol : `${asset.symbol} · #${asset.rank}`}
            </span>
          </span>
        </Link>
      </td>
      <td
        className="hidden text-right font-mono text-ink tabular-nums sm:table-cell"
        title={formatUsdExact(asset.marketCapUsd)}
      >
        {formatUsdCompact(asset.marketCapUsd)}
      </td>
      <td className="text-right font-mono text-green tabular-nums">{formatMultiple(multiple)}</td>
      <td className="text-right font-mono font-medium text-ink-bright tabular-nums">
        {formatUsdExact(impliedPriceUsd)}
      </td>
    </tr>
  );
}

/**
 * `/compare/all` — every asset larger than Zcash, and what one ZEC would be worth at each
 * one's market capitalisation.
 *
 * The same question the sibling tab asks of one asset, asked of all of them at once. Rows
 * come from `compareToZecAll`, which maps `eligibleAssets` through the same `compareToZec`
 * the detail view uses, so a row and the page it links to cannot state different figures.
 *
 * A column of ascending dollar figures reads more easily as a price-target list than one
 * comparison does. So the column uses the detail view's own words (`ONE ZEC WOULD BE`, never
 * "target" or "potential"), the assumption behind the arithmetic is stated once above the rows,
 * and the attribution line says this is arithmetic, not a forecast.
 */
export function CompareAllPage({ snapshot }: CompareAllPageProps) {
  const rows = snapshot === null ? [] : compareToZecAll(snapshot);

  return (
    <>
      <CompareHeader />

      <CompareTabs active="all" />

      {snapshot === null ? (
        <DataUnavailable what="Market capitalisations" refreshesWithin="a few minutes" />
      ) : rows.length === 0 ? (
        /*
         * Reachable two ways, and neither is an outage: no asset in the snapshot is larger
         * than Zcash, or Zcash's own market cap is a figure the arithmetic cannot use. Stated
         * as the measurement it is rather than rendered as a failed read.
         */
        <div className="panel px-6 py-8 text-center">
          <div className="microlabel text-warn">NOTHING TO COMPARE</div>
          <p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-ink-dim">
            No asset in this snapshot has a larger market capitalisation than Zcash.
          </p>
        </div>
      ) : (
        <section aria-label="One ZEC at the market capitalisation of every larger asset">
          {/*
           * One template string, not prose interleaved with `{…}`: a literal space after an
           * expression container is dropped when the line is rewrapped.
           */}
          <p className="mb-3 text-sm text-ink-dim">
            {`${rows.length} assets are worth more than Zcash's ${formatUsdCompact(
              snapshot.zec.marketCapUsd,
            )} today. At each one's market capitalisation, with Zcash's circulating supply held fixed, one ZEC — ${formatUsdExact(
              snapshot.zec.priceUsd,
            )} today — would be worth:`}
          </p>

          <Panel>
            <DataTable
              caption="Every asset larger than Zcash, and what one ZEC would be worth at its market capitalisation"
              columns={[
                { label: "ASSET" },
                { label: "MARKET CAP", align: "right", className: "hidden sm:table-cell" },
                { label: "×ZEC", align: "right" },
                { label: "ONE ZEC WOULD BE", align: "right" },
              ]}
            >
              {rows.map((comparison) => (
                <AssetRow key={comparison.counterpart.id} comparison={comparison} />
              ))}
            </DataTable>
          </Panel>

          <p className="mt-3 text-[11px] tracking-[0.06em] text-ink-faint">
            {`CoinGecko · read ${formatUtc(snapshot.asOf)} · refreshed every few minutes · both sides, one source · arithmetic, not a forecast`}
          </p>
        </section>
      )}
    </>
  );
}
