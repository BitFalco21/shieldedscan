import type { MinerGroup, MiningOverview, MiningWindowKey } from "@/domain";
import { utcDayFromSeconds } from "@/domain";
import {
  attributedSharePct,
  avgBlockSeconds,
  foldMinerGroups,
  minerSharePct,
  MINING_WINDOWS,
  shieldedCoinbaseSharePct,
  topMinerSharePct,
  windowSolutionRate,
} from "@/domain";
import { DataTable, type TableColumn } from "@/components/DataTable";
import { DifficultyChart } from "@/components/DifficultyChart";
import { FilterChips } from "@/components/FilterChips";
import { Panel } from "@/components/Panel";
import { StatCard } from "@/components/StatCard";
import { StatGrid } from "@/components/StatGrid";
import { Unmeasured } from "@/components/Unmeasured";
import { flowPaletteClass } from "@/lib/flow-palette";
import { formatCount, formatZecCompact } from "@/lib/format";
import { formatDifficulty, formatInterval, formatPct, formatSolRate } from "./format";
import { MinerName } from "./MinerName";
import { PageHeader } from "@/components/PageHeader";
import { Redacted } from "@/components/Redacted";

const WINDOW_LABELS: Record<MiningWindowKey, string> = {
  "24h": "24H",
  "3d": "3D",
  "7d": "7D",
  "30d": "30D",
  "90d": "90D",
  "1y": "1Y",
};

const COLUMNS: TableColumn[] = [
  { label: "#" },
  { label: "MINER" },
  { label: "BLOCKS", align: "right" },
  { label: "SHARE", align: "right" },
  { label: "AVG INTERVAL", align: "right" },
  { label: "REWARD", align: "right" },
];

/**
 * A stable colour per miner, so one miner keeps its colour between windows and between
 * visits.
 *
 * The `.flow-*` classes set `color`, which both the SVG rects (`fill="currentColor"`) and the
 * legend swatches inherit — so colour stays in the class, never on the element, as the brand
 * rule requires. A shielded coinbase takes the accent green instead of a palette slot,
 * because green already means privacy here and spending a neutral hue on it would break the
 * one colour convention the site does enforce.
 */
function minerColourClass(group: MinerGroup): string {
  if (group.address === null) return "text-green";
  return flowPaletteClass(group.name ?? group.address);
}

interface DistributionProps {
  shown: MinerGroup[];
  foldedBlocks: number;
  total: number;
}

/**
 * The window's block share as one contiguous bar.
 *
 * Contiguous on purpose, the same argument as the cross-chain Sankey's boundary edge: the
 * segments sum to the whole window, so the picture is a budget rather than a bundle of bars,
 * and a reader can see the dominant miner's share against everyone else's without reading a
 * number. The folded tail is drawn in neutral slate because it is not one miner.
 */
function Distribution({ shown, foldedBlocks, total }: DistributionProps) {
  const pct = (blocks: number) => (total === 0 ? 0 : (blocks / total) * 100);
  // A prefix scan rather than a running accumulator: each segment's offset is a function of
  // the input alone, and the React compiler rejects reassigning a captured local in render.
  const segments = shown.map((group, index) => ({
    key: group.address ?? "shielded",
    group,
    x: pct(shown.slice(0, index).reduce((sum, g) => sum + g.blocks, 0)),
    width: pct(group.blocks),
  }));
  const shownWidth = pct(shown.reduce((sum, g) => sum + g.blocks, 0));
  const foldedWidth = pct(foldedBlocks);

  return (
    <>
      <svg
        viewBox="0 0 100 6"
        preserveAspectRatio="none"
        className="h-6 w-full"
        role="img"
        aria-label={`Block share across ${shown.length} miners in this window`}
      >
        {segments.map((seg) => (
          <rect
            key={seg.key}
            x={seg.x}
            y={0}
            width={Math.max(0, seg.width - 0.15)}
            height={6}
            className={minerColourClass(seg.group)}
            fill="currentColor"
          />
        ))}
        {foldedWidth > 0 && (
          <rect
            x={shownWidth}
            y={0}
            width={Math.max(0, foldedWidth - 0.15)}
            height={6}
            className="flow-rest"
            fill="currentColor"
          />
        )}
      </svg>

      <ul className="mt-4 grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {shown.map((group) => (
          <li
            key={group.address ?? "shielded"}
            className="flex items-baseline justify-between gap-3 text-sm"
          >
            <span className="flex min-w-0 items-baseline gap-2">
              <span aria-hidden className={`${minerColourClass(group)} text-xs`}>
                ▉
              </span>
              <span className="truncate text-ink">
                {group.name ?? (group.address === null ? "shielded coinbase" : "unattributed")}
              </span>
            </span>
            <span className="shrink-0 text-ink-dim tabular-nums">
              {formatPct(minerSharePct(group.blocks, total))}{" "}
              <span className="text-ink-faint">({formatCount(group.blocks)})</span>
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

export interface MiningPageProps {
  overview: MiningOverview;
  /** Href per window, so every control is a shareable URL and the page needs no JS. */
  windowHref: (key: MiningWindowKey) => string;
}

export function MiningPage({ overview, windowHref }: MiningPageProps) {
  const { window: stats, groups, trend, software } = overview;
  const total = stats.blocks;
  const { shown, folded } = foldMinerGroups(groups, 10);
  const blockSeconds = avgBlockSeconds(stats);
  const rate = windowSolutionRate(stats);
  const attributed = attributedSharePct(groups, total);
  const shieldedShare = shieldedCoinbaseSharePct(groups, total);

  return (
    <>
      <PageHeader
        eyebrow="NETWORK"
        title="Mining"
        lede="Solution rate, difficulty, block economics and who the rewards were paid to — grouped by payout address, because Zcash publishes no miner identity."
      />

      <FilterChips
        ariaLabel="Filter by window"
        activeValue={stats.key}
        options={MINING_WINDOWS.map((key) => ({
          value: key,
          label: WINDOW_LABELS[key],
          href: windowHref(key),
        }))}
      />

      <StatGrid columns={5} className="mt-3">
        <StatCard
          label="SOLRATE"
          value={rate === null ? <Unmeasured /> : formatSolRate(rate.solps)}
          sub={
            rate === null
              ? "no interval in window"
              : rate.basis === "node"
                ? "from the node"
                : "estimated"
          }
        />
        <StatCard
          label="DIFFICULTY"
          value={formatDifficulty(stats.avgDifficulty)}
          sub={`mean over ${formatCount(total)} blocks`}
        />
        <StatCard
          label="BLOCK TIME"
          value={blockSeconds === null ? <Unmeasured /> : formatInterval(blockSeconds)}
          sub="75s target"
        />
        <StatCard
          label="TX PER BLOCK"
          value={stats.avgTxCount.toLocaleString("en-US", { maximumFractionDigits: 1 })}
          sub="excluding coinbase"
        />
        <StatCard
          label="FEES PER BLOCK"
          value={stats.avgFeeZat === null ? <Unmeasured /> : formatZecCompact(stats.avgFeeZat)}
          sub={stats.avgFeeZat === null ? "not yet indexed" : "mean paid to the miner"}
        />
      </StatGrid>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <Panel title="DIFFICULTY TREND" className="lg:col-span-2">
          <DifficultyChart
            points={trend}
            formatValue={formatDifficulty}
            // The height rides in the label beside the date, because it is the identifier a
            // reader can actually check the figure against — a date names roughly 1,150
            // blocks, a height names one.
            labels={trend.map(
              (point) => `${utcDayFromSeconds(point.timestamp)} · #${formatCount(point.height)}`,
            )}
          />
          <p className="mt-3 text-xs text-ink-faint">
            Difficulty is read from each block header, so this line is exact. Hover or use the arrow
            keys for the value at any point. The solution rate above is derived from it and is an
            estimate — see below.
          </p>
        </Panel>

        <Panel title="CONCENTRATION">
          <dl className="space-y-4">
            <div>
              <dt className="microlabel">
                {groups.length > 5 ? "TOP 5 ADDRESSES" : "LARGEST ADDRESS"}
              </dt>
              <dd className="mt-1 text-2xl font-bold text-ink-bright tabular-nums">
                {formatPct(topMinerSharePct(groups, total, groups.length > 5 ? 5 : 1))}
              </dd>
              {/*
                The denominator is named because "top 5" is vacuous when the window holds five
                miners or fewer — it reports 100% and reads as an alarm rather than as an
                artefact of a thin window. Below six groups the card states the largest single
                address instead, which is meaningful at any diversity.
              */}
              <dd className="mt-0.5 text-xs text-ink-faint">
                of {formatCount(groups.length)} distinct payout{" "}
                {groups.length === 1 ? "address" : "addresses"} — the real share can only be higher,
                since one operator may hold several
              </dd>
            </div>
            <div>
              <dt className="microlabel">NAMED AT ALL</dt>
              <dd className="mt-1 text-lg font-semibold text-ink tabular-nums">
                {formatPct(attributed)}
              </dd>
              <dd className="mt-0.5 text-xs text-ink-faint">the rest name themselves nowhere</dd>
            </div>
            <div>
              <dt className="microlabel">SHIELDED COINBASE</dt>
              <dd className="mt-1 text-lg font-semibold text-green tabular-nums">
                {formatPct(shieldedShare)}
              </dd>
              <dd className="mt-0.5 text-xs text-ink-faint">
                rewards paid straight into a pool (ZIP 213)
              </dd>
            </div>
          </dl>
        </Panel>
      </div>

      <Panel title="BLOCK SHARE" className="mt-3">
        <Distribution shown={shown} foldedBlocks={folded?.blocks ?? 0} total={total} />
      </Panel>

      <Panel title="RANKING" className="mt-3">
        <DataTable
          caption={`Miners by blocks produced in the last ${WINDOW_LABELS[stats.key]}`}
          columns={COLUMNS}
        >
          {shown.map((group, index) => (
            <tr key={group.address ?? "shielded"} className="row-hover hairline-b last:border-0">
              <td className="text-ink-faint tabular-nums">{index + 1}</td>
              <td>
                <MinerName group={group} />
              </td>
              <td className="text-right tabular-nums">{formatCount(group.blocks)}</td>
              <td className="text-right text-ink-dim tabular-nums">
                {formatPct(minerSharePct(group.blocks, total))}
              </td>
              <td className="text-right text-ink-dim tabular-nums">
                {group.avgIntervalSeconds === null ? (
                  <Unmeasured />
                ) : (
                  formatInterval(group.avgIntervalSeconds)
                )}
              </td>
              <td className="text-right tabular-nums">
                {group.address === null ? (
                  <Redacted className="text-xs" />
                ) : (
                  formatZecCompact(group.rewardZat)
                )}
              </td>
            </tr>
          ))}
          {folded !== null && (
            <tr className="hairline-b last:border-0">
              <td className="text-ink-faint">—</td>
              <td className="text-ink-dim">
                {formatCount(folded.groups)} smaller payout addresses
              </td>
              <td className="text-right tabular-nums">{formatCount(folded.blocks)}</td>
              <td className="text-right text-ink-dim tabular-nums">
                {formatPct(minerSharePct(folded.blocks, total))}
              </td>
              <td className="text-right text-ink-faint">—</td>
              <td className="text-right tabular-nums">{formatZecCompact(folded.rewardZat)}</td>
            </tr>
          )}
        </DataTable>
        <p className="mt-3 text-xs text-ink-faint">
          {formatCount(total)} blocks, heights {formatCount(stats.fromHeight)}–
          {formatCount(stats.toHeight)}. Every share on this page is over that denominator.
        </p>
      </Panel>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <Panel title="NODE SOFTWARE">
          <p className="text-sm text-ink-dim">
            <span className="font-semibold text-ink-bright tabular-nums">
              {formatPct(minerSharePct(software.zebra, total))}
            </span>{" "}
            of blocks were built by a Zebra-family node, which stamps a zebra into its coinbase. The
            remaining {formatCount(software.unidentified)} name no implementation — which is not
            evidence they ran something else.
          </p>
          <p className="mt-3 text-xs text-ink-faint">
            This is the only thing that mark measures. It is emphatically not a mining pool.
          </p>
        </Panel>

        <Panel title="READING THIS PAGE" className="lg:col-span-2">
          <div className="max-w-3xl space-y-3 text-sm leading-relaxed text-ink-dim">
            <p>
              <span className="text-ink">Zcash records no miner.</span> It records a coinbase, and
              the miner is the largest transparent output of it — a consequence of consensus, since
              the miner&apos;s 80% share exceeds any single funding stream in every era. Where the
              reward was paid into a shielded pool instead, there is no address to group by and the
              amount is encrypted; those blocks are counted and their value is left redacted rather
              than guessed at.
            </p>
            <p>
              Names come from one of two places and the table always says which.{" "}
              <span className="text-ink">Self-declared</span> means the operator wrote that name
              into its own coinbase, which anyone can verify against the chain. Anything else is
              repeated from an off-chain list and marked as such. An address that names itself
              nowhere is shown as an address — we do not guess, and we do not merge two addresses
              into one operator, because deciding they are the same party is the clustering this
              explorer refuses to do.
            </p>
            <p>
              That refusal is why the real concentration can only be{" "}
              <span className="text-ink">higher</span> than shown. One operator running several
              payout addresses appears here as several miners and understates it; the reverse cannot
              happen.
            </p>
            <p>
              The solution rate is an estimate. Equihash produces <em>solutions</em>, not hashes — a
              figure quoted in H/s against this quantity is measuring the wrong thing — and any rate
              read off a finite window is a sample of a random process, so it is stated to three
              significant figures with the window beside it and no more.
            </p>
          </div>
        </Panel>
      </div>
    </>
  );
}
