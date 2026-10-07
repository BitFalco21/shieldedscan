import type { NetMap, NetMapCell } from "@/domain";
import { NET_UNIDENTIFIED_CLIENT, uptimeTier } from "@/domain";
import { asnSlotClass, clientToneClass } from "../net-palette";

/** What colours the map. Client state: one payload carries every lens. */
export type MapLens = "client" | "asn" | "uptime";

export const MAP_LENSES: ReadonlyArray<{ lens: MapLens; label: string }> = [
  { lens: "client", label: "software" },
  { lens: "asn", label: "hosting network" },
  { lens: "uptime", label: "crawls answered" },
];

export interface AsnTotal {
  asn: number | null;
  org: string | null;
  count: number;
}

/**
 * Hosting networks ranked by answering nodes, summed over the cells. The five largest take a
 * colour slot each; the map paints a cell by its modal network's slot, and the legend lists
 * the same five, so the two cannot disagree about who is orange.
 */
export function asnRanking(map: NetMap): AsnTotal[] {
  const totals = new Map<string, AsnTotal>();
  for (const cell of map.cells) {
    for (const a of cell.asns) {
      const key = `${a.asn ?? "null"}|${a.org ?? ""}`;
      const entry = totals.get(key) ?? { asn: a.asn, org: a.org, count: 0 };
      entry.count += a.count;
      totals.set(key, entry);
    }
  }
  return [...totals.values()].sort(
    (a, b) => b.count - a.count || (a.org ?? "").localeCompare(b.org ?? ""),
  );
}

export function asnRankOf(
  ranking: AsnTotal[],
  asn: number | null,
  org: string | null,
): number | null {
  const i = ranking.findIndex((r) => r.asn === asn && r.org === org);
  return i < 0 ? null : i;
}

/** The modal client of a cell — the first entry, since the domain sorts them by count. */
export function cellClient(cell: NetMapCell): string {
  return cell.clients[0]?.client ?? NET_UNIDENTIFIED_CLIENT;
}

/**
 * The three classes a cell carries, one per family. Which one paints is the `<svg>`'s
 * `data-lens`, so switching lens is an attribute change and no cell re-renders. Under the
 * software lens the rect is transparent and the client's mark paints instead (`CellMark`); the
 * class still travels so the readout and legend agree with the map. Latency is not a lens: a
 * round trip from one vantage point says more about the path than about the node.
 */
export function cellClasses(cell: NetMapCell, ranking: AsnTotal[]): string {
  const modalAsn = cell.asns[0];
  const rank = modalAsn ? asnRankOf(ranking, modalAsn.asn, modalAsn.org) : null;
  const up = uptimeTier(cell.uptime);
  return [
    clientToneClass(cellClient(cell)),
    asnSlotClass(rank),
    up === null ? "net-up-none" : `net-up-${up}`,
  ].join(" ");
}

/** A cell's side in viewBox units: grows with the square root of its node count. */
export function cellSize(nodes: number): number {
  return 4 + Math.sqrt(nodes) * 2.6;
}

/**
 * A cell's mark is drawn larger than its square: a logo has to be read where a colour only has
 * to be seen, and at the default zoom a one-node square is ~5 px on a laptop.
 */
export function markSize(nodes: number): number {
  return cellSize(nodes) * 1.8;
}

/** A never-answered cell's side: a hollow square, smaller than a lit one at the same count. */
export function ghostSize(count: number): number {
  return 2.2 + Math.sqrt(count) * 0.9;
}

/** One line naming a cell: "Frankfurt am Main, Germany" or the country alone or "unplaced". */
export function cellPlace(cell: { city: string | null; country: string | null }): string {
  if (cell.city && cell.country) return `${cell.city}, ${cell.country}`;
  return cell.city ?? cell.country ?? "an unnamed place";
}
