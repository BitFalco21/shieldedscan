"use client";

import type { PriceSeries, ShieldedSupplyPoint, Stats, StatsRange } from "@/domain";
import { Panel } from "@/components/Panel";
import { Tabs, type TabItem } from "@/components/Tabs";
import { PriceFace } from "./PriceFace";
import { useLiveStats } from "./useLiveStats";
import { StatsStamp } from "./StatsStamp";
import { PoolStrip } from "./PoolStrip";
import { ShieldedFace } from "./ShieldedFace";

export type StatsFace = "price" | "shielded";

const FACE_TABS: readonly TabItem<StatsFace>[] = [
  { key: "price", href: "/stats", label: "price" },
  { key: "shielded", href: "/stats/shielded", label: "shielded" },
];

export interface StatsPageProps {
  face: StatsFace;
  stats: Stats;
  series: Partial<Record<StatsRange, PriceSeries>>;
  /** Empty on the price face, which draws no shielded chart. */
  supply: ShieldedSupplyPoint[];
}

/**
 * `/stats` — one number per screen, the two figures this site most wants shared.
 *
 * The face is a route, not a tab parameter: `/stats` and `/stats/shielded` are two prerendered
 * pages, each with its own URL, card and OG image, and neither reads `searchParams`, which
 * would make it dynamic and lose the CDN copy. The range inside the price face is client
 * state, because it only windows data already on the page.
 */
export function StatsPage({ face, stats, series, supply }: StatsPageProps) {
  const { current, unavailable } = useLiveStats(stats);
  return (
    // `pt-8`: the top spacing every other page gets from `PageHeader`.
    <div className="grid gap-6 pt-8">
      <StatsStamp height={current.height} asOf={current.asOf} />

      <Panel className="stats-panel">
        {/* The site's one tab row (`Tabs`), as on cross-chain, compare and /network. */}
        <Tabs label="Stats" tabs={FACE_TABS} active={face} className="mb-6 sm:mb-8" />

        {face === "price" ? (
          <PriceFace stats={current} series={series} />
        ) : (
          <ShieldedFace stats={current} supply={supply} />
        )}
      </Panel>

      {/*
       * Below the panel, not inside it: both faces hold the same five blocks, so the box is the
       * same height on each and switching tabs cannot resize it.
       */}
      {face === "shielded" ? <PoolStrip stats={current} /> : null}

      {/*
       * Silent while working; it speaks only to say the figures stopped updating. A moving
       * number is itself the signal that the feed is alive. It never borrows the Veil, which
       * means encrypted on-chain, not an outage of ours.
       */}
      {unavailable ? (
        <p className="microlabel text-warn" role="status">
          not updating — the figures above are from{" "}
          {new Date(current.asOf * 1000).toISOString().slice(11, 19)} utc
        </p>
      ) : null}
    </div>
  );
}
