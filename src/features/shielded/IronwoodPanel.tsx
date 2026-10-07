import type { IronwoodInflow } from "@/domain";
import { freshShieldingPct, ironwoodResidualZat, migratedZat, utcDayFromSeconds } from "@/domain";
import { MultiLineChart } from "@/components/MultiLineChart";
import { Panel } from "@/components/Panel";
import { formatCount, formatSharePct, formatZec, formatZecWhole } from "@/lib/format";

/**
 * One source of Ironwood value.
 *
 * `accent` carries the privacy ink grammar rather than decoration: value arriving from
 * another shielded pool was already private and takes the recessive `green-dim`, while value
 * shielded from transparent is a change in privacy state and takes the full accent. A reader
 * scanning the column sees which rows represent something new happening.
 */
function SourceRow({
  label,
  zat,
  total,
  note,
  accent = "text-green-dim",
}: {
  label: string;
  zat: number;
  total: number;
  note: string;
  accent?: string;
}) {
  /*
   * `null` when there is no denominator, never 0: "0.0%" beside a real amount would be a
   * fabricated share of a pool that holds nothing (the rule `freshShieldingPct` follows).
   */
  const pct = total > 0 ? (zat / total) * 100 : null;
  // A net term can be negative, so the bar draws its magnitude and takes the palette's `red`,
  // which is reserved for negative deltas, exactly what an outflow is.
  const outflow = pct !== null && pct < 0;
  return (
    <div className="hairline-b py-2.5 last:border-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-ink">{label}</span>
        <span className="text-sm whitespace-nowrap text-ink-bright tabular-nums">
          {formatZecWhole(zat)}
        </span>
      </div>
      {pct !== null ? (
        <div className="mt-1 flex items-center gap-2">
          {/*
            An SVG `width` attribute, not an inline style. The 0.6 floor keeps a small-but-real
            share visible: a source that contributed something must not render identically to
            one that did not.
          */}
          <svg viewBox="0 0 100 6" preserveAspectRatio="none" className="h-1.5 flex-1" aria-hidden>
            <rect width="100" height="6" rx="2" className="text-edge-faint" fill="currentColor" />
            <rect
              width={Math.max(Math.abs(pct), pct === 0 ? 0 : 0.6)}
              height="6"
              rx="2"
              className={outflow ? "text-red" : accent}
              fill="currentColor"
            />
          </svg>
          {/*
            `formatSharePct`, not `toFixed(1)`: a real but tiny share (the mined-coinbase term)
            must not print as "0.0%" beside a visible amount and the bar's 0.6 floor. `w-14` fits
            "<0.1%" and ">-0.1%"; this span is `shrink-0`, so a narrower box would spill.
          */}
          <span className="w-14 shrink-0 text-right text-xs text-ink-dim tabular-nums">
            {formatSharePct(pct)}
          </span>
        </div>
      ) : null}
      <p className="mt-1 text-xs leading-relaxed text-ink-faint">{note}</p>
    </div>
  );
}

export interface IronwoodPanelProps {
  /** `null` before NU6.3 activation, or where the pool has received nothing. */
  inflow: IronwoodInflow | null;
  /** Whether NU7 is active at the tip — it changes where those fees went (ZIP 235). */
  nu7Active?: boolean;
}

/**
 * What is filling Ironwood — deliberately not titled "the turnstile".
 *
 * "Turnstile" is the obvious heading and the one this panel must not use: a meaningful share of
 * the pool arrived from transparent, people choosing to shield public value into the new pool,
 * and a turnstile heading would bury the part that is about users rather than the protocol.
 *
 * It breaks down the pool's current balance, not its gross deposits: every term is a net, so
 * the sources sum to the balance and the headline is the same number as the card above it.
 *
 *  - Every figure is measured from activation and never backdated. The panel states the
 *    window's start, because a chart with no stated start reads as all of history.
 *  - Fees are a term and they are not burned: a transaction spending from Ironwood pays its fee
 *    out of the shielded side. It is shown rather than absorbed, because a breakdown whose parts
 *    do not add up is worse than one with an extra line.
 */
export function IronwoodPanel({ inflow, nu7Active = false }: IronwoodPanelProps) {
  if (inflow === null) return null;

  const fresh = freshShieldingPct(inflow);
  const migrated = migratedZat(inflow);
  const since = inflow.balance[0];
  // Zero by construction. Rendered only if it is not, so a future change that breaks the
  // identity shows up as a line on the page rather than silently landing in one of the
  // sources — the same reason `blockTotalFeeZat` is shared rather than recomputed.
  const residual = ironwoodResidualZat(inflow);

  return (
    <Panel title="WHAT IS FILLING IRONWOOD" className="mt-3">
      <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-dim">
        Ironwood is Zcash&rsquo;s fourth shielded pool, live since block{" "}
        <span className="text-ink">{formatCount(inflow.activationHeight)}</span>. It exists so
        Orchard value can cross a turnstile — but that is not all it has received.
      </p>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <div className="microlabel">IN THE POOL NOW</div>
          <div className="mt-1 text-2xl font-bold tracking-tight text-ink-bright">
            {formatZecWhole(inflow.balanceZat)}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-ink-faint">
            The same figure as the Ironwood card above, accounted for by where it came from. Each
            source is a net — what it sent in, less anything Ironwood sent back — so the parts add
            up to the whole.
          </p>

          <div className="mt-3">
            <SourceRow
              label="From Orchard"
              zat={inflow.netFromOrchardZat}
              total={inflow.balanceZat}
              note="The turnstile the pool was built for. Value that was already shielded, relocated by the protocol."
            />
            <SourceRow
              label="From Sapling"
              zat={inflow.netFromSaplingZat}
              total={inflow.balanceZat}
              note="Also already shielded, and not what the upgrade was announced for."
            />
            {/*
              `!== 0`, not `> 0`: this is a net term (what Sprout sent in, less anything Ironwood
              sent back), so a negative value is a real direction. `migratedZat` and the residual
              include it either way, so hiding it would leave the visible rows not summing to the
              balance. Zero is hidden: a row for a pool that moved nothing is noise.
            */}
            {inflow.netFromSproutZat !== 0 ? (
              <SourceRow
                label="From Sprout"
                zat={inflow.netFromSproutZat}
                total={inflow.balanceZat}
                note="The 2016 pool, still draining."
              />
            ) : null}
            <SourceRow
              label="Shielded from transparent"
              zat={inflow.netFromTransparentZat}
              total={inflow.balanceZat}
              note={`New shielding, not a migration: value that was public and now is not, across ${formatCount(inflow.fromTransparentTxCount)} transactions.`}
              accent="text-green"
            />
            {/* Newly issued ZEC, mined straight into the pool by a ZIP-213 shielded coinbase.
                Small, and shown anyway: it is neither a migration nor a shielding, and without it
                the reconciliation does not close. */}
            {inflow.minedZat > 0 ? (
              <SourceRow
                label="Mined into the pool"
                zat={inflow.minedZat}
                total={inflow.balanceZat}
                note="Newly issued ZEC: a miner taking the block reward straight into Ironwood rather than to a transparent address."
                accent="text-green"
              />
            ) : null}
            {/* Not a source: the one term that leaves, stated so the column adds up. Before NU7
                every fee reaches the miner; from it 40% does and ZIP 235 removes 60% to be
                reissued later (removed, never destroyed). */}
            <p className="mt-2.5 text-xs leading-relaxed text-ink-faint">
              {/* Explicit {" "} rather than JSX line joining, which can drop the space. "Minus",
                  not "Less": this is a subtraction from the terms above, not a bound on them. */}
              Minus <span className="text-ink">{formatZec(inflow.feesPaidZat)}</span> paid in fees
              by transactions spending from the pool. That value left the shielded side as fees,
              {nu7Active
                ? " which go to the miner — since NU7, 40% of them, with the rest held back for later block rewards."
                : " which go to the miner's coinbase — Zcash burns nothing."}
              {residual !== 0 ? (
                <>
                  {" "}
                  <span className="text-warn">
                    {formatZec(Math.abs(residual))} is unaccounted for.
                  </span>
                </>
              ) : null}
            </p>
          </div>
        </div>

        <div>
          <div className="microlabel">POOL BALANCE, HOURLY</div>
          <div className="mt-2">
            {/* MultiLineChart for the ChartHover readout: a chart you cannot interrogate is a
                picture. */}
            <MultiLineChart
              labels={inflow.balance.map((p) =>
                new Date(p.timestamp * 1000).toISOString().slice(5, 16).replace("T", " "),
              )}
              series={[
                {
                  name: "Pool balance",
                  values: inflow.balance.map((p) => p.ironwoodZat),
                  className: "text-green",
                },
              ]}
              formatValue={(v) => formatZecWhole(v)}
              ariaLabel="Ironwood pool balance since activation, hourly"
            />
          </div>
          <p className="mt-2 text-xs leading-relaxed text-ink-faint">
            {/* Hourly, because the window is days. A daily series would be four points, and
                four points drawn as a line implies a trend nobody measured. */}
            Hourly closing balances
            {since ? (
              <>
                {" "}
                from {utcDayFromSeconds(since.timestamp)} — the pool did not exist before that, so
                there is nothing earlier to show.
              </>
            ) : null}
          </p>
          {fresh !== null ? (
            <p className="mt-3 text-sm leading-relaxed text-ink-dim">
              <span className="text-green">{fresh}%</span> of what Ironwood holds was shielded
              straight from transparent. The other {formatZecWhole(migrated)} moved in from another
              shielded pool and was private already.
            </p>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}
