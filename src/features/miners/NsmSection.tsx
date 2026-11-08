import type { ReactNode } from "react";
import { NSM_FEE_SHARE_PCT, nsmWindow, type NsmOverview } from "@/domain";
import { Panel } from "@/components/Panel";
import { StatCard } from "@/components/StatCard";
import { StatGrid } from "@/components/StatGrid";
import { Unmeasured } from "@/components/Unmeasured";
import { formatCount, formatUsd, formatZec, formatZecSupply } from "@/lib/format";
import { NsmFeesChart } from "./NsmFeesChart";
import { dayLabel, usdText } from "./miners-view";

export interface NsmSectionProps {
  nsm: NsmOverview;
  /** The page's window, whole UTC days inclusive. */
  fromDay: string;
  toDay: string;
  livePriceUsd: number | null;
}

const ZIP_235 = "https://zips.z.cash/zip-0235";

/** A ZEC figure with its USD beneath, the way the page's tiles pair them; exact in the title. */
function zecUsd(zat: number, usd: string | null): ReactNode {
  return (
    <span title={formatZec(zat)}>
      {formatZecSupply(zat)}
      <span className="block text-base text-ink-dim">{usd ?? "USD unavailable"}</span>
    </span>
  );
}

/**
 * The NSM since NU7: its balance now, as the node reports it, and the window's fees split the way
 * ZIP 235 splits them, over every block (a fee total is public, whatever the coinbase). The balance
 * is valued at the live price; the window's fees at each day's close, today at the live price. A
 * window that opens before NU7 is summed from activation and says so: earlier days had no NSM.
 * The balance is more than fees (ZIP 234 opened it with the subsidy never claimed), so its tile
 * always says so, with the figure when the API could account for it block by block.
 */
export function NsmSection({ nsm, fromDay, toDay, livePriceUsd }: NsmSectionProps) {
  const w = nsmWindow(nsm, fromDay, toDay);
  const balance = nsm.balance;
  const minerPct = 100 - NSM_FEE_SHARE_PCT;
  const since = w?.sinceActivation ? ` · since ${dayLabel(w.fromDay)}` : "";
  const fromActivation = nsm.days[0]?.day === nsm.activationDay;
  return (
    <section aria-labelledby="nsm-heading" className="mt-6">
      <h2 id="nsm-heading" className="microlabel text-ink-faint">
        NSM · SINCE NU7
      </h2>
      <p className="mt-1 text-xs text-ink-faint">
        Since NU7, {NSM_FEE_SHARE_PCT}% of each block&apos;s fees go to the Network Sustainability
        Mechanism (
        <a
          href={ZIP_235}
          rel="noreferrer"
          target="_blank"
          className="text-ink-dim hover:text-green"
        >
          ZIP 235 <span aria-hidden>↗</span>
          <span className="sr-only"> (opens a new tab on zips.z.cash)</span>
        </a>
        ).
      </p>
      <StatGrid columns={3} className="mt-2">
        <StatCard
          label="NSM BALANCE"
          value={
            balance === null || balance.zat === null ? (
              <Unmeasured />
            ) : (
              zecUsd(
                balance.zat,
                livePriceUsd === null ? null : formatUsd((balance.zat / 1e8) * livePriceUsd),
              )
            )
          }
          sub={
            balance === null
              ? "the node did not answer"
              : `at block ${formatCount(balance.height)} · ${
                  balance.carriedInZat === null
                    ? "includes more than fees"
                    : `${formatZecSupply(balance.carriedInZat)} unclaimed rewards carried in at NU7`
                }`
          }
        />
        <StatCard
          label="FEES TO THE NSM"
          value={
            w === null ? (
              "—"
            ) : w.nsmZat === null ? (
              <Unmeasured />
            ) : (
              zecUsd(w.nsmZat, usdText(w.nsmZat, w.nsmUsd, livePriceUsd))
            )
          }
          sub={
            w === null
              ? `starts at block ${formatCount(nsm.activationHeight)}`
              : w.feeZat === null
                ? `${NSM_FEE_SHARE_PCT}% of fees${since}`
                : `${NSM_FEE_SHARE_PCT}% of ${formatZecSupply(w.feeZat)} in fees${since}`
          }
        />
        <StatCard
          label="FEES KEPT BY MINERS"
          value={
            w === null ? (
              "—"
            ) : w.minerZat === null ? (
              <Unmeasured />
            ) : (
              zecUsd(w.minerZat, usdText(w.minerZat, w.minerUsd, livePriceUsd))
            )
          }
          sub={`the other ${minerPct}%, beside the subsidy`}
        />
      </StatGrid>
      {nsm.days.length === 0 ? null : (
        <Panel title={fromActivation ? "FEES PER DAY SINCE NU7" : "FEES PER DAY"} className="mt-3">
          <NsmFeesChart days={nsm.days} fromActivation={fromActivation} />
          <p className="mt-3 text-xs text-ink-faint">
            Every block from {formatCount(nsm.activationHeight)}, shielded coinbase included: fees
            are public.
          </p>
        </Panel>
      )}
    </section>
  );
}
