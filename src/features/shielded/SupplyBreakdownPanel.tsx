import type { SupplyBreakdown, ValuePoolName } from "@/domain";
import { MAX_SUPPLY_ZAT, POOL_NAMES, minedZat, shieldedZat, unminedZat } from "@/domain";
import { Panel } from "@/components/Panel";
import { formatCount, formatZec, formatZecWhole } from "@/lib/format";
import { ShareBar } from "@/components/ShareBar";

export interface SupplyBreakdownPanelProps {
  supply: SupplyBreakdown;
}

/**
 * Where every ZEC in existence sits.
 *
 * The six value pools partition the supply exactly — that is a consensus property, not an
 * approximation — so this table adds up by construction and any reader can check it against
 * the height it names.
 *
 * The lockbox is its own row, not folded into "transparent": it holds the NU6 deferred block
 * subsidy, no transaction spends into it, and it is not transparent-addressable.
 *
 * There is deliberately no "no inflation" badge. Verifying supply against the issuance
 * schedule means recomputing the subsidy through two halvings and Blossom's block-time change,
 * and a subtly wrong version would be a confident false claim. The numbers below are exact;
 * the audit is a separate job.
 */

const ORDER: ValuePoolName[] = [
  "transparent",
  "orchard",
  "sapling",
  "ironwood",
  "lockbox",
  "sprout",
];

const DESCRIPTION: Record<ValuePoolName, string> = {
  transparent: "public — visible like Bitcoin",
  orchard: "shielded · NU5, current standard",
  sapling: "shielded · 2018",
  ironwood: "shielded · NU6.3, turnstile-guarded",
  lockbox: "NU6 deferred subsidy — unspendable so far",
  sprout: "shielded · 2016, legacy",
};

const SHIELDED_POOLS = new Set<ValuePoolName>(POOL_NAMES);

export function SupplyBreakdownPanel({ supply }: SupplyBreakdownPanelProps) {
  const mined = minedZat(supply);
  const shielded = shieldedZat(supply);
  const byPool = new Map(supply.pools.map((p) => [p.pool, p.balanceZat]));
  const share = (zat: number) => (mined === 0 ? 0 : (zat / mined) * 100);

  return (
    <Panel title="WHERE EVERY ZEC IS" className="mt-3">
      <table className="data-table w-full text-sm">
        <caption className="sr-only">
          Zcash supply by value pool, at block {formatCount(supply.height)}
        </caption>
        <tbody>
          {ORDER.filter((pool) => byPool.has(pool)).map((pool) => {
            const zat = byPool.get(pool) ?? 0;
            const pct = share(zat);
            return (
              <tr key={pool} className="hairline-b">
                <td className="align-top max-sm:pe-0">
                  <div
                    className={
                      SHIELDED_POOLS.has(pool) ? "text-green capitalize" : "text-ink capitalize"
                    }
                  >
                    {pool}
                  </div>
                  <div className="text-xs text-ink-faint">{DESCRIPTION[pool]}</div>
                </td>
                {/* The gutter is `.data-table`'s, so the longest name never runs into the
                    amount on a phone. Below `sm` each gap is one side's 0.75rem
                    (`max-sm:pe-0`), keeping the table narrow. */}
                <td
                  className="text-right align-top whitespace-nowrap tabular-nums max-sm:pe-0"
                  title={formatZec(zat)}
                >
                  {formatZecWhole(zat)}
                </td>
                {/* The share and its bar are one top-aligned cell, so the bars line up across
                    rows whatever the descriptions wrap to, with the percentage directly above. */}
                <td className="w-24 align-top">
                  <div className="text-right text-xs text-ink-dim tabular-nums">
                    {pct.toFixed(1)}%
                  </div>
                  {/*
                    A bar, not a chart: the same number as the column beside it, drawn so the
                    eye can rank six rows without reading six figures.
                  */}
                  <ShareBar
                    pct={pct}
                    height={6}
                    rx={2}
                    className="mt-1.5 h-1.5 w-full"
                    fillClassName={SHIELDED_POOLS.has(pool) ? "text-green" : "text-ink-faint"}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
        <div>
          <dt className="microlabel">SHIELDED</dt>
          <dd className="mt-1 text-green tabular-nums" title={formatZec(shielded)}>
            {formatZecWhole(shielded)}
          </dd>
          <dd className="text-xs text-ink-faint">{share(shielded).toFixed(1)}% of mined</dd>
        </div>
        <div>
          <dt className="microlabel">MINED</dt>
          <dd className="mt-1 text-ink-bright tabular-nums" title={formatZec(mined)}>
            {formatZecWhole(mined)}
          </dd>
          <dd className="text-xs text-ink-faint">
            {((mined / MAX_SUPPLY_ZAT) * 100).toFixed(1)}% of the cap
          </dd>
        </div>
        {/*
          Both carry their exact amount in a `title`, like SHIELDED and MINED above, as the
          paragraph below promises. UNMINED (`MAX_SUPPLY_ZAT − minedZat`) has a real sub-ZEC
          remainder that `formatZecWhole` rounds away.
        */}
        <div>
          <dt className="microlabel">UNMINED</dt>
          <dd className="mt-1 text-ink-dim tabular-nums" title={formatZec(unminedZat(supply))}>
            {formatZecWhole(unminedZat(supply))}
          </dd>
          <dd className="text-xs text-ink-faint">still to be issued</dd>
        </div>
        <div>
          <dt className="microlabel">MAX SUPPLY</dt>
          <dd className="mt-1 text-ink-dim tabular-nums" title={formatZec(MAX_SUPPLY_ZAT)}>
            {formatZecWhole(MAX_SUPPLY_ZAT)}
          </dd>
          <dd className="text-xs text-ink-faint">fixed by consensus</dd>
        </div>
      </dl>

      <p className="mt-4 text-sm leading-relaxed text-ink-dim">
        Every ZEC that exists sits in exactly one of these pools, so the rows sum to the mined
        supply by construction — read at block{" "}
        <span className="text-ink">{formatCount(supply.height)}</span>, and checkable against it.
        What the pool totals do <em className="not-italic">not</em> reveal is who holds any of it: a
        shielded pool publishes its balance and nothing about the notes inside it. Figures are
        rounded to whole ZEC for reading; hover any of them for the exact amount.
      </p>
    </Panel>
  );
}
