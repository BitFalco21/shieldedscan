import type { FeeDistribution, FeeKindMonthPoint, FeeKindStats } from "@/domain";
import { shieldedVsTransparentPct } from "@/domain";
import { Panel } from "@/components/Panel";
import { ChartFigure } from "@/features/charts/ChartFigure";
import { chartData } from "@/features/charts/chart-data";
import { PrivacyShield, type PrivacyVariant } from "@/components/PrivacyShield";
import { Unmeasured } from "@/components/Unmeasured";
import { formatCount, formatZatUsd, formatZec } from "@/lib/format";

/** Display order and labels: strongest cryptography first, matching the pool cards. */
const KIND_ROWS: { kind: FeeKindStats["kind"]; variant: PrivacyVariant; label: string }[] = [
  { kind: "shielded", variant: "shielded", label: "Fully shielded" },
  { kind: "mixed", variant: "mixed", label: "Mixed" },
  { kind: "transparent", variant: "transparent", label: "Transparent" },
];

export interface FeeCostPanelProps {
  /** `null` when the series could not be read — the panel then says so, once. */
  distribution: FeeDistribution | null;
  /** Daily medians for the chart's sub-ALL ranges; `null` degrades only those ranges. */
  feesDaily: FeeKindMonthPoint[] | null;
  /** Current ZEC price; a null drops every dollar figure silently, per the house rule. */
  priceUsd: number | null;
}

/**
 * Does privacy cost more? Measured from the chain, the answer is no — it costs less.
 *
 * That inversion must carry its evidence: each kind shows the median with its quartile spread
 * and sample size, since a median over an unstated sample is a claim, not a measurement.
 * Medians and quartiles, never means: the distribution is heavy-tailed, and the chain's
 * largest single fee is a genuine 987 ZEC fat-finger that would drag any average.
 *
 * The mechanism gets a sentence: ZIP-317 prices logical actions, and a transparent sweep of
 * many UTXOs carries more of them than a two-action Orchard spend.
 */
export function FeeCostPanel({ distribution, feesDaily, priceUsd }: FeeCostPanelProps) {
  if (distribution === null) {
    return (
      <Panel title="WHAT A TRANSACTION COSTS" className="mt-3">
        <div className="py-4">
          <Unmeasured />
          <p className="mt-2 text-sm leading-relaxed text-ink-dim">
            The fee series could not be read just now. Nothing is estimated in its place.
          </p>
        </div>
      </Panel>
    );
  }

  const pct = shieldedVsTransparentPct(distribution);
  const byKind = new Map(distribution.recent.map((s) => [s.kind, s]));

  return (
    <Panel title="WHAT A TRANSACTION COSTS" className="mt-3">
      <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-dim">
        Median fee over the last {distribution.windowDays} days, by privacy kind.
        {pct !== null && pct < 100 ? (
          <>
            {" "}
            A fully shielded transaction&rsquo;s median fee is{" "}
            <span className="text-green">{pct}%</span> of a transparent one&rsquo;s — privacy is not
            the expensive option here. ZIP-317 prices logical actions, and a transparent transaction
            sweeping many coins carries more of them than a two-action shielded spend.
          </>
        ) : null}
      </p>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div>
          {KIND_ROWS.map(({ kind, variant, label }) => {
            const stats = byKind.get(kind);
            return (
              <div key={kind} className="hairline-b py-2.5 last:border-0">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="inline-flex items-center gap-2 text-sm text-ink">
                    <PrivacyShield variant={variant} />
                    {label}
                  </span>
                  <span className="text-sm whitespace-nowrap text-ink-bright tabular-nums">
                    {stats ? (
                      <>
                        {formatZec(stats.medianZat)}
                        {priceUsd !== null ? (
                          <span className="ml-1.5 text-xs font-normal text-ink-dim">
                            {formatZatUsd(stats.medianZat, priceUsd)}
                          </span>
                        ) : null}
                      </>
                    ) : (
                      <Unmeasured />
                    )}
                  </span>
                </div>
                {stats ? (
                  <p className="mt-0.5 text-xs leading-relaxed text-ink-faint">
                    {/* The quartiles in plain words. The average is second and labelled: a
                        heavy-tailed mean is context, not the headline. */}
                    half of these fees fall between {formatZec(stats.p25Zat)} and{" "}
                    {formatZec(stats.p75Zat)} · average {formatZec(stats.avgZat)}
                    {priceUsd !== null ? (
                      <> ({formatZatUsd(stats.avgZat, priceUsd)})</>
                    ) : null} · {formatCount(stats.txs)} transactions
                  </p>
                ) : (
                  <p className="mt-0.5 text-xs text-ink-faint">
                    no transactions of this kind in the window
                  </p>
                )}
              </div>
            );
          })}
        </div>

        <div>
          <div className="microlabel">MEDIAN FEE OVER TIME</div>
          <div className="mt-2">
            <ChartFigure slug="median-fee" data={chartData({ fees: distribution, feesDaily })} />
          </div>
          <p className="mt-2 text-xs leading-relaxed text-ink-faint">
            {/* The gap rule, stated where a reader wonders about it. */}A month where a kind has no
            median is drawn as a gap, never as zero. Medians, not averages — one fat-fingered 987
            ZEC fee would otherwise bend an entire year.
          </p>
        </div>
      </div>
    </Panel>
  );
}
