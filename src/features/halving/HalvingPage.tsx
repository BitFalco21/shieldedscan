import type { HalvingSchedule } from "@/domain";
import {
  BLOCK_TARGET_SECONDS,
  BLOSSOM_HEIGHT,
  FUNDING_EXPIRY_BEFORE_NU61,
  HALVING_INTERVAL,
  issuancePerDayZat,
  subsidyDelta,
  subsidyTail,
} from "@/domain";
import { FlushEnd } from "@/components/FlushEnd";
import { PageHeader } from "@/components/PageHeader";
import { Panel } from "@/components/Panel";
import {
  formatCount,
  formatDeltaPct,
  formatSharePct,
  formatZecAmount,
  formatZecWhole,
} from "@/lib/format";
import { HalvingHero } from "./HalvingHero";
import { HalvingHistoryTable } from "./HalvingHistoryTable";
import { Height } from "./Height";
import { SubsidyChange } from "./SubsidyChange";

export interface HalvingPageProps {
  schedule: HalvingSchedule;
  /** Daily ZEC closes, for the price a past halving landed at. Empty is fine — no column. */
  dailyUsd: Record<string, number>;
  /** Wall clock at render, so the estimate is anchored once and the countdown agrees with it. */
  now: number;
}

export function HalvingPage({ schedule, dailyUsd, now }: HalvingPageProps) {
  const next = schedule.events[schedule.events.length - 1]!;
  const past = schedule.events.slice(0, -1);
  const delta = subsidyDelta(next.before, next.after);
  const interval =
    schedule.observedIntervalSeconds > 0 ? schedule.observedIntervalSeconds : BLOCK_TARGET_SECONDS;
  const measured = schedule.observedIntervalSeconds > 0;
  const perDayNow = issuancePerDayZat(next.before.totalZat, interval);
  const perDayAfter = issuancePerDayZat(next.after.totalZat, interval);
  // The whole tail, for the "last ZEC" figure — the endpoint only confirms the first few.
  const tail = subsidyTail(next.height, next.after.totalZat);
  const finalHeight = tail.zeroHeight;
  // Derived from the per-recipient split, so a literal "80%" cannot outlive its regime.
  const minerSharePct = (next.before.minerZat / next.before.totalZat) * 100;
  const finalYear = new Date((now + (finalHeight - schedule.height) * interval) * 1000)
    .getUTCFullYear()
    .toString();

  return (
    <>
      <PageHeader
        eyebrow="NETWORK"
        title="Zcash halving countdown"
        lede={`Every ${formatCount(HALVING_INTERVAL)} blocks the Zcash block subsidy halves. Heights on this page are consensus and exact; every date is an estimate derived from how fast the chain is currently running, and is labelled as one.`}
      />

      <div className="flex flex-col gap-3">
        <HalvingHero
          schedule={schedule}
          next={next}
          now={now}
          interval={interval}
          measured={measured}
        />

        {/* Derived, never a literal, so the heading cannot name a past halving over a table
            describing the next one. */}
        <Panel title={`WHAT CHANGES AT BLOCK ${formatCount(next.height)}`}>
          <SubsidyChange next={next} />
          <dl className="hairline-b mt-4 grid gap-x-8 gap-y-3 border-t border-edge-faint pt-4 text-sm sm:grid-cols-2">
            {/* Whole coins, not eight decimals: a per-block subsidy times an observed block rate
                has no precision past the unit. */}
            <div>
              <dt className="text-ink-faint">Issued per day now</dt>
              <dd className="font-mono text-ink-bright">≈ {formatZecWhole(perDayNow)}</dd>
            </div>
            <div>
              <dt className="text-ink-faint">Issued per day after</dt>
              <dd className="font-mono text-ink-bright">≈ {formatZecWhole(perDayAfter)}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs leading-relaxed text-ink-faint">
            Daily figures are estimates: they multiply the exact per-block subsidy by the observed
            block rate, which is not a consensus guarantee.
          </p>
        </Panel>

        {/*
         * The page's central finding, and the reason the subsidy is carried per recipient.
         *
         * Rendered only while both streams and lockbox expire at the next halving: every
         * sentence below is about that one event. Past it, the miner's cut does halve, and a
         * panel that goes quiet is the safe failure. If consensus ever ends one and keeps the
         * other, write the other copy rather than render this one.
         */}
        {delta.fundingStreamsEnd && delta.lockboxEnds ? (
          <Panel title="WHY THE MINER'S CUT DOES NOT HALVE">
            <p className="text-sm leading-relaxed text-ink-dim">
              The total block subsidy halves — that part is the schedule. What a miner receives does
              not, because the two other claims on the subsidy end at the same height: the ZIP 214
              funding stream and the NU6 lockbox both expire at block {formatCount(next.height)}.
              The miner goes from {formatZecAmount(next.before.minerZat)} —{" "}
              {formatSharePct(minerSharePct, 0)} of a larger subsidy — to{" "}
              {formatZecAmount(next.after.minerZat)}, which is all of a smaller one.
            </p>
            <p className="mt-3 text-sm leading-relaxed text-ink-dim">
              So the miner&apos;s share falls by {formatDeltaPct(delta.minerPct * 100)} where the
              total falls by {formatDeltaPct(delta.totalPct * 100)}. Any statement that &ldquo;miner
              revenue halves&rdquo; at this event is wrong, and it is wrong in the direction that
              matters for the security budget.
            </p>
            {/*
             * The page's one conditional claim. "The miner takes 100%" is true of the rules in
             * force, and those rules were rewritten once already at this boundary, so the
             * precedent is named. The in-flight proposals are not listed; see
             * FUNDING_EXPIRY_BEFORE_NU61's doc.
             */}
            <p className="mt-3 text-xs leading-relaxed text-ink-faint">
              That is today&apos;s consensus rather than a promise: both were scheduled to end at
              block {formatCount(FUNDING_EXPIRY_BEFORE_NU61)} until NU6.1 moved them here, and a
              later upgrade could move them again.
            </p>
          </Panel>
        ) : null}

        <Panel title="EVERY HALVING SO FAR">
          <HalvingHistoryTable events={past} next={next} dailyUsd={dailyUsd} />
        </Panel>

        {/* The correction a generic countdown clock cannot make. */}
        <Panel title="BLOSSOM WAS NOT A HALVING">
          <p className="text-sm leading-relaxed text-ink-dim">
            At block {formatCount(BLOSSOM_HEIGHT)} the per-block subsidy fell from 12.5 to 6.25 ZEC,
            which is why a chart of block subsidy over time shows a step there. It was not a
            halving: the block target fell with it, from 150 seconds to 75, so the amount of ZEC
            issued per day did not change at all.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-ink-dim">
            The arithmetic is exact either side. Before Blossom, 840,000 blocks of 150 seconds;
            after it, {formatCount(HALVING_INTERVAL)} blocks of {BLOCK_TARGET_SECONDS}. Both are
            126,000,000 seconds — the same four years between halvings.
          </p>
        </Panel>

        <Panel title="THE REST OF THE SCHEDULE">
          {/*
           * Counts steps rather than "halvings": the floor discards a zatoshi long before the
           * end (9,765,625 -> 4,882,812) and the terminal step takes 1 zatoshi to 0, a
           * truncation. No claim about total issuance: it misses the 21,000,000 MAX_MONEY
           * constant by ~0.1848 ZEC, and the true figure is not derivable from anything this
           * page holds. The height is node-verified: getblocksubsidy(49,766,399) = 1 zatoshi,
           * (49,766,400) = 0.
           */}
          <p className="text-sm leading-relaxed text-ink-dim">
            After block {formatCount(next.height)} the subsidy steps down{" "}
            {formatCount(tail.steps.length)} more times, each an integer halving rounded down to the
            zatoshi — the last taking {formatCount(tail.lastPayingZat)} zatoshi to nothing. From
            block {formatCount(finalHeight)} the subsidy is zero.
          </p>
          <p className="mt-3 text-xs leading-relaxed text-ink-faint">
            That height is consensus and exact. The year it falls in is not — dating it means
            extrapolating block times over a century, which is why this page gives it as roughly{" "}
            {finalYear} and nothing more precise.
          </p>
          <table className="data-table data-table-compact mt-4 w-full text-sm">
            <caption className="sr-only">Halvings after the next one</caption>
            <thead>
              <tr className="microlabel text-left">
                <th className="border-b border-edge-faint pb-2 font-normal">HEIGHT</th>
                <th className="border-b border-edge-faint pb-2 text-right font-normal">
                  <FlushEnd>SUBSIDY (ZEC)</FlushEnd>
                </th>
              </tr>
            </thead>
            <tbody>
              {schedule.upcoming.map((u) => (
                <tr key={u.height} className="hairline-b last:border-0">
                  <td>
                    <Height value={u.height} />
                  </td>
                  <td className="text-right font-mono text-ink-dim">
                    {formatZecAmount(u.totalZat)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>
    </>
  );
}
