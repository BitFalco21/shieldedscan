import type { ElectricityTariffs, MiningTerms, TariffValidation } from "@/domain";
import {
  DEFAULT_MINING_HARDWARE,
  breakEvenTariffUsdPerKwh,
  joulesPerKsol,
  kwhPerZec,
  rankCountryCosts,
} from "@/domain";
import { FactGrid } from "@/components/FactGrid";
import { Unmeasured } from "@/components/Unmeasured";
import { formatCount, formatUtc, formatZecAmount } from "@/lib/format";
import { MiningCostExplorer } from "./MiningCostExplorer";
import { formatBreakEven, formatCost, formatKwh, formatSolRate, formatUsdExact } from "./format";
import { PageHeader } from "@/components/PageHeader";

export interface MiningCostPageProps {
  terms: MiningTerms;
  tariffs: ElectricityTariffs;
  /** The last run of `tariffs:validate`, quoted on the provenance line with its day. */
  validation: TariffValidation;
}

/**
 * `/mining-cost` — what it costs, in electricity alone, to mine one ZEC in each country.
 *
 * Every figure is a FLOOR, and the page says so before it says anything else: electricity
 * only, at one named machine, at each country's published tariff. Hardware, hosting, cooling,
 * pool fees and orphans are not counted. No country is called profitable or unprofitable —
 * the break-even tariff and the margin are shown and the reader decides.
 *
 * The terms are read at one height and that height is printed, the solution rate carries its
 * basis (the node's own measurement, or a labelled estimate), and the tariffs carry the venue's
 * quarter and the day they were read. Nothing on this page is a claim without its date.
 */
export function MiningCostPage({ terms, tariffs, validation }: MiningCostPageProps) {
  const hardware = DEFAULT_MINING_HARDWARE;
  const kwh = kwhPerZec(terms, hardware);
  const breakEven = breakEvenTariffUsdPerKwh(terms.priceUsd, kwh);
  const ranked = kwh === null ? [] : rankCountryCosts(tariffs, "business", kwh);
  const lo = ranked[0];
  const hi = ranked[ranked.length - 1];
  const solps = terms.networkSolps;

  return (
    <>
      <PageHeader
        eyebrow={<>NETWORK · ELECTRICITY · {tariffs.rows.length} COUNTRIES</>}
        title="What it costs to mine one ZEC"
        lede={
          <>
            Electricity only, at the newest Equihash ASIC, at each country&apos;s business tariff.
            Hardware, hosting, cooling and pool fees are not counted, so the real cost is higher.
            {lo && hi ? (
              <>
                {" "}
                Today that floor runs from{" "}
                <b className="font-medium text-ink">{formatCost(lo.costUsd)}</b> in {lo.name} to{" "}
                <b className="font-medium text-ink">{formatCost(hi.costUsd)}</b> in {hi.name}.
              </>
            ) : null}
          </>
        }
      />

      <section className="panel mb-3 grid gap-4 p-5 sm:grid-cols-[auto_1fr] sm:items-end sm:gap-8">
        <div>
          <div className="microlabel">break-even electricity price</div>
          <p className="cost-figure mt-1">
            {breakEven === null ? <Unmeasured /> : formatBreakEven(breakEven)}
            <span className="cost-figure-unit"> / kWh</span>
          </p>
        </div>
        <p className="text-sm leading-relaxed text-ink-dim">
          {breakEven === null ? (
            <>
              Without a ZEC price there is no break-even to state; the kilowatt-hours per ZEC below
              still hold.
            </>
          ) : (
            <>
              Above this tariff, the electricity for one ZEC costs more than one ZEC sells for.{" "}
              {hi && hi.tariffUsdPerKwh < breakEven
                ? "No country's business tariff is there today."
                : "Some business tariffs are above it today."}
            </>
          )}{" "}
          Read at block <span className="text-ink">{formatCount(terms.height)}</span>
          {terms.priceUsd === null ? null : (
            <>
              , ZEC at <span className="text-ink">{formatUsdExact(terms.priceUsd)}</span>
            </>
          )}
          , {formatUtc(terms.asOf)}.
        </p>
      </section>

      <FactGrid
        className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
        facts={[
          {
            label: solps.basis === "node" ? "network · node-measured" : "network · estimated",
            value: (
              <>
                {formatSolRate(solps.value)}
                <span className="block text-xs text-ink-faint">
                  difficulty{" "}
                  {terms.difficulty.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                </span>
              </>
            ),
            hint:
              solps.basis === "node"
                ? "The node's own getnetworksolps, a trailing 120-block measurement. Equihash yields solutions, not hashes."
                : "Estimated from the tip's difficulty and the block interval, because the node did not answer getnetworksolps.",
          },
          {
            label: "hardware assumed",
            value: (
              <>
                {hardware.name}
                <span className="block text-xs text-ink-faint">
                  {joulesPerKsol(hardware).toFixed(2)} J/kSol · {formatCount(hardware.wallWatts)} W
                </span>
              </>
            ),
            hint: `Bitmain's published specification, read ${hardware.verifiedOn}. Every cost on this page is for this machine; an older one costs more per ZEC.`,
          },
          {
            label: "energy per ZEC",
            value: kwh === null ? <Unmeasured /> : formatKwh(kwh),
            hint: "The machine's daily electricity divided by its expected daily ZEC. It does not depend on what the rest of the network runs.",
          },
          {
            label: "miner subsidy",
            value: (
              <>
                {formatZecAmount(terms.minerSubsidyZat)} ZEC
                <span className="block text-xs text-ink-faint">
                  until block {formatCount(terms.subsidyChangesAtHeight)}
                </span>
              </>
            ),
            hint: "The miner's share of each block, from the node's own getblocksubsidy. Fees are excluded, which slightly overstates the cost.",
          },
          {
            label: "tariffs",
            value: (
              <>
                {tariffs.quarter}
                <span className="block text-xs text-ink-faint">read {tariffs.readOn}</span>
              </>
            ),
            hint: `${tariffs.source}: ${tariffs.bands.business}. Household: ${tariffs.bands.household}.`,
          },
        ]}
      />

      {kwh === null ? (
        <p className="text-sm text-ink-dim">
          The network terms did not yield an energy figure, so no country can be priced.
        </p>
      ) : (
        <MiningCostExplorer tariffs={tariffs} terms={terms} hardware={hardware} kwhPerZec={kwh} />
      )}

      <p className="mt-8 max-w-4xl text-xs leading-relaxed text-ink-faint">
        <b className="font-medium text-ink-dim">Where the numbers come from.</b> Electricity tariffs
        are{" "}
        <a
          href={tariffs.sourceUrls[0]}
          rel="noreferrer"
          target="_blank"
          className="text-ink-dim underline decoration-edge-faint underline-offset-2 hover:text-ink"
        >
          {tariffs.source}
        </a>
        &apos;s published averages for {tariffs.quarter} — household, and business at 1,000,000 kWh
        a year, all taxes included — reproduced with attribution under their {tariffs.licence}{" "}
        licence and re-read monthly; last read {tariffs.readOn}. The network solution rate is{" "}
        {solps.basis === "node"
          ? "the node's own measurement at the height shown"
          : "estimated from the difficulty at the height shown"}
        ; the subsidy is the node&apos;s own schedule; the ZEC price is the one on this site&apos;s
        homepage; the efficiency is the manufacturer&apos;s published figure. The cost is arithmetic
        over those five terms and nothing else. {validationSentence(validation)}
      </p>
    </>
  );
}

/** A deviation is a percentage of the official figure; one decimal is its display grain. */
const formatPct = (pct: number): string => `${pct.toFixed(1)}%`;

/**
 * One template string, not JSX text around expressions: Next's compiler can drop the space
 * between `{value}` and a word that ends its line, which only the built page shows.
 */
function validationSentence(v: TariffValidation): string {
  const { business, household, period } = v.eurostat;
  return (
    `Checked ${v.checkedOn} against Eurostat's ${period} series: the business tariffs sit a ` +
    `median ${formatPct(business.medianPct)} from the official figure across ` +
    `${business.countries} European countries, the household tariffs ` +
    `${formatPct(household.medianPct)} across ${household.countries}; the two series cover ` +
    `different periods, so part of that gap is time.`
  );
}
