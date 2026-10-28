import type { HalvingSchedule } from "@/domain";
import {
  BLOSSOM_HEIGHT,
  FUNDING_EXPIRY_BEFORE_NU61,
  HALVING_INTERVAL,
  NU7_HEIGHT,
  POST_NU7_HALVING_INTERVAL,
  REISSUANCE_START_HEIGHT,
  estimateSecondsBetween,
  issuancePerDayZat,
  scheduledSubsidyZat,
  subsidyDelta,
  subsidyTail,
  targetSpacingAt,
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
    schedule.observedIntervalSeconds > 0
      ? schedule.observedIntervalSeconds
      : targetSpacingAt(schedule.height);
  const measured = schedule.observedIntervalSeconds > 0;
  // "Now" is what blocks pay at the tip, the last change that has happened; "after" is at the
  // next halving's own block target, which is NU7's 25 seconds rather than today's pace.
  const subsidyNow = past[past.length - 1]!.after.totalZat;
  const perDayNow = issuancePerDayZat(subsidyNow, interval);
  const perDayAfter = issuancePerDayZat(next.after.totalZat, targetSpacingAt(next.height));
  const beforeNu7 = schedule.height < NU7_HEIGHT;
  // The whole tail, for the "last ZEC" figure — the endpoint lists only the first few.
  const tail = subsidyTail(next.height);
  const finalHeight = tail.zeroHeight;
  // Derived from the per-recipient split, so a literal "80%" cannot outlive its regime.
  const minerSharePct = (next.before.minerZat / next.before.totalZat) * 100;
  const finalYear = new Date(
    (now + estimateSecondsBetween(schedule.height, finalHeight, schedule.observedIntervalSeconds)) *
      1000,
  )
    .getUTCFullYear()
    .toString();

  return (
    <>
      <PageHeader
        eyebrow="NETWORK"
        title="Zcash halving countdown"
        lede="Every four years of block time the Zcash block subsidy halves. Heights on this page are consensus and exact; every date is an estimate, and is labelled as one."
      />

      <div className="flex flex-col gap-3">
        <HalvingHero
          schedule={schedule}
          next={next}
          now={now}
          interval={interval}
          measured={measured}
        />

        {/*
         * NU7 comes first and is not a halving, which a countdown to the halving alone would hide:
         * the subsidy drops to a third before then, and the next halving starts from there.
         * Rendered only while NU7 is ahead; afterwards it is a row in the history table.
         */}
        {beforeNu7 ? (
          <Panel title={`BEFORE THAT: NU7 AT BLOCK ${formatCount(NU7_HEIGHT)}`}>
            <p className="text-sm leading-relaxed text-ink-dim">
              Blocks come every 25 seconds instead of 75, and each pays a third as much:{" "}
              {formatZecAmount(subsidyNow)} becomes {formatZecAmount(next.before.totalZat)} ZEC.
              Three times the blocks at a third of the subsidy: the ZEC issued per day does not
              change, so this is not a halving.
            </p>
          </Panel>
        ) : null}

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
              block {formatCount(FUNDING_EXPIRY_BEFORE_NU61)} until NU6.1 moved them to the next
              halving, and NU7&apos;s faster blocks moved that halving here. A later upgrade could
              move them again.
            </p>
          </Panel>
        ) : null}

        <Panel title="EVERY HALVING SO FAR">
          <HalvingHistoryTable events={past} next={next} dailyUsd={dailyUsd} />
        </Panel>

        {/* The correction a generic countdown clock cannot make. */}
        <Panel title="BLOSSOM AND NU7 ARE NOT HALVINGS">
          <p className="text-sm leading-relaxed text-ink-dim">
            The per-block subsidy fell from{" "}
            {formatZecAmount(scheduledSubsidyZat(BLOSSOM_HEIGHT - 1))} to{" "}
            {formatZecAmount(scheduledSubsidyZat(BLOSSOM_HEIGHT))} ZEC at Blossom (block{" "}
            {formatCount(BLOSSOM_HEIGHT)}), and falls from{" "}
            {formatZecAmount(scheduledSubsidyZat(NU7_HEIGHT - 1))} to{" "}
            {formatZecAmount(scheduledSubsidyZat(NU7_HEIGHT))} at NU7 (block{" "}
            {formatCount(NU7_HEIGHT)}). Neither is a halving: the block target fell with it, from
            150 seconds to 75 and then to 25, so the ZEC issued per day did not change.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-ink-dim">
            A halving is the same 126,000,000 seconds in every era: 840,000 blocks of 150 seconds,{" "}
            {formatCount(HALVING_INTERVAL)} of 75, or {formatCount(POST_NU7_HALVING_INTERVAL)} of
            25.
          </p>
        </Panel>

        <Panel title="THE REST OF THE SCHEDULE">
          {/*
           * Counts steps rather than "halvings" of an amount: each is rounded down to the zatoshi
           * and the terminal step takes 1 zatoshi to 0, a truncation. No claim about total
           * issuance, which reissuance makes depend on how much ZEC is removed from circulation.
           * The node cannot confirm these heights: from the start of reissuance it needs the
           * parent block, so they are `scheduledSubsidyZat`, pinned in tests to the node.
           */}
          <p className="text-sm leading-relaxed text-ink-dim">
            After block {formatCount(next.height)} the scheduled subsidy steps down{" "}
            {formatCount(tail.steps.length)} more times, every{" "}
            {formatCount(POST_NU7_HALVING_INTERVAL)} blocks, each rounded down to the zatoshi — the
            last taking {formatCount(tail.lastPayingZat)} zatoshi to nothing at block{" "}
            {formatCount(finalHeight)}.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-ink-dim">
            From block {formatCount(REISSUANCE_START_HEIGHT)} every block also pays a reissuance
            bonus: a small share of the ZEC removed from circulation since NU7 (ZIP 237). It cannot
            be known in advance, so the figures below are the scheduled part only, a floor.
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
                  <FlushEnd>SCHEDULED SUBSIDY (ZEC)</FlushEnd>
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
