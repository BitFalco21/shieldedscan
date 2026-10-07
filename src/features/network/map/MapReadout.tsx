import type { ReactNode } from "react";
import type { NetMap, NetMapCell, NetSummary } from "@/domain";
import { uptimeTier } from "@/domain";
import { ClientMark } from "@/components/ClientMark";
import { netPct, shortAsnOrg } from "../net-format";
import { NET_ASN_SLOTS, asnSlotClass, tierToneClass } from "../net-palette";
import { asnRankOf, cellPlace, type AsnTotal, type MapLens } from "./lenses";
import { formatCount } from "@/lib/format";

export interface MapReadoutProps {
  map: NetMap;
  summary: NetSummary;
  lens: MapLens;
  ranking: AsnTotal[];
  /** The cell under the pointer or pinned by a click, or null for the lens legend. */
  focused: NetMapCell | null;
  pinned: boolean;
}

/**
 * The fixed panel beside the map: the lens's legend, or the facts of one cell. Fixed rather
 * than a pointer-following tooltip — a tooltip needs a runtime `left`/`top`, which is an
 * inline style, and a fixed panel is the better reading on a phone anyway. `role="status"`
 * so a screen reader hears the cell a keyboard focus landed on.
 *
 * A cell is a 1° square of the Earth, ~110 km, never an address, and the panel says so.
 */
export function MapReadout({ map, summary, lens, ranking, focused, pinned }: MapReadoutProps) {
  return (
    <aside className="net-readout text-sm" role="status" aria-live="polite">
      {focused ? (
        <CellFacts cell={focused} ranking={ranking} pinned={pinned} />
      ) : (
        <Legend map={map} summary={summary} lens={lens} ranking={ranking} />
      )}
    </aside>
  );
}

function CellFacts({
  cell,
  ranking,
  pinned,
}: {
  cell: NetMapCell;
  ranking: AsnTotal[];
  pinned: boolean;
}) {
  const up = cell.uptime;
  return (
    <>
      <div>
        <div className="microlabel">near</div>
        <h3 className="mt-0.5 text-[15px] font-normal text-ink-bright">{cellPlace(cell)}</h3>
      </div>
      <dl className="net-kv">
        <dt>nodes here</dt>
        <dd>{cell.nodes}</dd>
        <dt>answered our crawls</dt>
        <dd>{up === null ? "—" : netPct(up.numerator, up.denominator)}</dd>
      </dl>
      <div>
        <div className="microlabel mb-2">software</div>
        <ul className="grid gap-1.5 text-xs text-ink-dim">
          {cell.clients.map((c) => (
            <li key={c.client} className="flex items-center gap-2.5">
              <ClientMark client={c.client} size={14} />
              <span className="min-w-0 flex-1 truncate">{c.client}</span>
              <span className="tabular-nums">{c.count}</span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <div className="microlabel mb-2">hosted on</div>
        <ul className="grid gap-1.5 text-xs text-ink-dim">
          {cell.asns.map((a) => {
            const rank = asnRankOf(ranking, a.asn, a.org);
            return (
              <li key={`${a.asn}|${a.org}`} className="flex items-center gap-2.5">
                <span className={`net-sw ${asnSlotClass(rank)}`} />
                <span className="min-w-0 flex-1 truncate" title={a.org ?? undefined}>
                  {shortAsnOrg(a.org)}
                </span>
                <span className="tabular-nums">{a.count}</span>
              </li>
            );
          })}
        </ul>
      </div>
      <p className="mt-auto text-[11.5px] text-ink-faint">
        A 1° cell, not an address. Nothing on this page names a node.
        {pinned ? " Esc or click again to release." : ""}
      </p>
    </>
  );
}

function Legend({
  map,
  summary,
  lens,
  ranking,
}: {
  map: NetMap;
  summary: NetSummary;
  lens: MapLens;
  ranking: AsnTotal[];
}) {
  const total = summary.reachable;
  let title: string;
  let rows: Array<{ key: string; swatch: ReactNode; label: string; count: number; of?: number }>;
  if (lens === "client") {
    title = "software";
    rows = summary.clients.map((c) => ({
      key: c.client,
      swatch: <ClientMark client={c.client} size={12} />,
      label: c.client,
      count: c.numerator,
      of: total,
    }));
  } else if (lens === "asn") {
    title = "hosting network";
    const top = ranking.slice(0, NET_ASN_SLOTS);
    const rest = ranking.slice(NET_ASN_SLOTS);
    rows = top.map((a, i) => ({
      key: `${a.asn}|${a.org}`,
      swatch: <span className={`net-sw ${asnSlotClass(i)}`} />,
      label: shortAsnOrg(a.org),
      count: a.count,
      of: total,
    }));
    if (rest.length > 0) {
      rows.push({
        key: "other",
        swatch: <span className="net-sw net-asn-other" />,
        label: `${rest.length} other ${rest.length === 1 ? "network" : "networks"}`,
        count: rest.reduce((s, a) => s + a.count, 0),
        of: total,
      });
    }
  } else {
    title = "crawls answered · since first seen";
    const tiers: Array<{ tier: 1 | 2 | 3; label: string }> = [
      { tier: 1, label: "answered ≥ 90% of crawls" },
      { tier: 2, label: "50 – 90%" },
      { tier: 3, label: "under 50%" },
    ];
    rows = tiers.map((t) => ({
      key: String(t.tier),
      swatch: <span className={`net-sw ${tierToneClass(t.tier)}`} />,
      label: t.label,
      count: map.cells
        .filter((c) => uptimeTier(c.uptime) === t.tier)
        .reduce((s, c) => s + c.nodes, 0),
      of: total,
    }));
  }
  return (
    <>
      <div>
        <div className="microlabel mb-2">{title}</div>
        <ul className="grid gap-1.5 text-xs text-ink-dim">
          {rows.map((r) => (
            <li key={r.key} className="flex items-center gap-2.5">
              <span className="flex w-3 shrink-0 justify-center">{r.swatch}</span>
              <span className="min-w-0 flex-1 truncate">{r.label}</span>
              <span className="whitespace-nowrap tabular-nums">
                {r.count}
                {r.of !== undefined ? (
                  <span className="text-ink-faint"> · {netPct(r.count, r.of)}</span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <ul className="grid gap-1.5 text-xs text-ink-faint">
        <li className="flex items-center gap-2.5">
          <span className="flex w-3 shrink-0 justify-center">
            <span className="net-sw net-sw-hollow" />
          </span>
          <span className="min-w-0 flex-1">advertised to us, not answering</span>
          <span className="tabular-nums">{formatCount(map.ghostTotal)}</span>
        </li>
        {map.unplaced > 0 ? (
          <li className="flex items-center gap-2.5">
            <span className="w-3 shrink-0" />
            <span className="min-w-0 flex-1">answering, GeoIP could not place</span>
            <span className="tabular-nums">{map.unplaced}</span>
          </li>
        ) : null}
      </ul>
      <p className="mt-auto text-[11.5px] text-ink-faint">
        Hover or focus a lit cell; click to pin. Scroll to zoom, drag to pan.
      </p>
    </>
  );
}
