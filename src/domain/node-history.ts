import type { NetClient, NetReleaseDay } from "./netmap";

/**
 * The answering nodes over time: which software they ran, by release line, and which networks
 * hosted them. Both come from the crawler's daily record, each day as it stood at its last crawl,
 * over the same 24-hour answering window every other node figure uses.
 *
 * Hosting is by autonomous system, GeoIP's claim about an address, never clustered into
 * companies. A network hosting fewer than `HOSTING_MIN_NODES` nodes on a day is folded into
 * `other` that day, so no published row points at one or two machines.
 */

/** Below this many nodes on a day, a hosting network is folded into `other`, never named. */
export const HOSTING_MIN_NODES = 3;

/** A node's software release line: `major.minor`, or null when no version was declared. */
export function releaseLine(version: string | null): string | null {
  if (version === null) return null;
  const m = /^(\d+)\.(\d+)/.exec(version);
  return m ? `${m[1]}.${m[2]}` : null;
}

export interface NodeSoftwareGroup {
  client: NetClient;
  /** `major.minor`; null when the node declared no parseable version. */
  line: string | null;
  nodes: number;
}

export interface NodeSoftwareDay {
  /** `YYYY-MM-DD`, UTC. */
  day: string;
  answering: number;
  /** Largest first, then client and line; they sum to `answering`. */
  groups: NodeSoftwareGroup[];
}

/** The release record by client and release line: protocol versions and patch releases merged. */
export function softwareHistory(history: readonly NetReleaseDay[]): NodeSoftwareDay[] {
  return history.map((d) => {
    const merged = new Map<string, NodeSoftwareGroup>();
    for (const g of d.groups) {
      const line = releaseLine(g.version);
      const key = JSON.stringify([g.client, line]);
      const m = merged.get(key) ?? { client: g.client, line, nodes: 0 };
      m.nodes += g.nodes;
      merged.set(key, m);
    }
    const groups = [...merged.values()].sort(
      (a, b) =>
        b.nodes - a.nodes ||
        a.client.localeCompare(b.client) ||
        (a.line ?? "").localeCompare(b.line ?? ""),
    );
    return { day: d.day, answering: groups.reduce((s, g) => s + g.nodes, 0), groups };
  });
}

/** The label a software group is drawn and published under: "Zebra 6.4", "zcashd". */
export function softwareLabel(g: Pick<NodeSoftwareGroup, "client" | "line">): string {
  return g.line === null ? g.client : `${g.client} ${g.line}`;
}

/** One hosting network that day: an autonomous system and GeoIP's name for it. */
export interface NodeHostingNetwork {
  asn: number;
  org: string;
  nodes: number;
}

export interface NodeHostingDay {
  day: string;
  answering: number;
  /** Networks with at least `HOSTING_MIN_NODES` nodes that day, largest first. */
  networks: NodeHostingNetwork[];
  /** Nodes on networks folded for having fewer than `HOSTING_MIN_NODES` that day. */
  other: number;
  /** How many networks `other` folds. */
  otherNetworks: number;
  /** Nodes with no network found: a Tor node, or an address not yet enriched. */
  unknown: number;
}

export interface NodeHosting {
  basis: "floor";
  windowSeconds: number;
  minNodes: number;
  /** The first recorded day; null until the crawler has written one. */
  recordingSince: string | null;
  /** Oldest first. */
  days: NodeHostingDay[];
  asOf: number;
}

/** One stored row of the crawler's hosting record; asn 0 and org '' mean no network found. */
export interface HostingRecordRow {
  day: string;
  asn: number;
  org: string;
  nodes: number;
}

/** The hosting record, folded day by day so no network under the minimum is ever named. */
export function foldHosting(rows: readonly HostingRecordRow[]): NodeHostingDay[] {
  const byDay = new Map<string, HostingRecordRow[]>();
  for (const r of rows) byDay.set(r.day, [...(byDay.get(r.day) ?? []), r]);
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, list]) => {
      const unknown = list.filter((r) => r.asn === 0).reduce((s, r) => s + r.nodes, 0);
      const known = list.filter((r) => r.asn !== 0);
      const named = known
        .filter((r) => r.nodes >= HOSTING_MIN_NODES)
        .map((r) => ({ asn: r.asn, org: r.org === "" ? `AS${r.asn}` : r.org, nodes: r.nodes }))
        .sort((a, b) => b.nodes - a.nodes || a.org.localeCompare(b.org) || a.asn - b.asn);
      const small = known.filter((r) => r.nodes < HOSTING_MIN_NODES);
      return {
        day,
        answering: list.reduce((s, r) => s + r.nodes, 0),
        networks: named,
        other: small.reduce((s, r) => s + r.nodes, 0),
        otherNetworks: small.length,
        unknown,
      };
    });
}

/**
 * The networks a chart draws over `days`: the `top` with the most node-days, a stable set so a
 * network keeps its band from day to day. On a day it fell under the minimum it is in `other`.
 */
export function topHostingNetworks(
  days: readonly NodeHostingDay[],
  top: number,
): { asn: number; org: string }[] {
  const total = new Map<number, { asn: number; org: string; nodes: number }>();
  for (const d of days) {
    for (const n of d.networks) {
      const t = total.get(n.asn) ?? { asn: n.asn, org: n.org, nodes: 0 };
      t.nodes += n.nodes;
      t.org = n.org;
      total.set(n.asn, t);
    }
  }
  return [...total.values()]
    .sort((a, b) => b.nodes - a.nodes || a.asn - b.asn)
    .slice(0, top)
    .map(({ asn, org }) => ({ asn, org }));
}

/** The fold key for groups outside a chart's named bands. */
export const NODE_OTHER_KEY = "other";
/** Hosting's band for nodes with no network found. */
export const NODE_UNKNOWN_NETWORK_KEY = "unknown";

/** Days as stacked bands of node counts: named bands first, largest first, then the folds. */
export interface NodeBands {
  keys: string[];
  labels: string[];
  days: string[];
  answering: number[];
  /** `nodes[k][d]`: band `k` on day `d`. Every day's bands sum to its `answering`. */
  nodes: number[][];
}

/** The software record as bands: the `top` client release lines by node-days, the rest folded. */
export function softwareBands(days: readonly NodeSoftwareDay[], top: number): NodeBands {
  const keyOf = (g: NodeSoftwareGroup) => JSON.stringify([g.client, g.line]);
  const total = new Map<string, { label: string; nodes: number }>();
  for (const d of days) {
    for (const g of d.groups) {
      const t = total.get(keyOf(g)) ?? { label: softwareLabel(g), nodes: 0 };
      t.nodes += g.nodes;
      total.set(keyOf(g), t);
    }
  }
  const named = [...total.entries()]
    .sort(([ka, a], [kb, b]) => b.nodes - a.nodes || ka.localeCompare(kb))
    .slice(0, top);
  const index = new Map(named.map(([k], i) => [k, i]));
  const nodes = [...named.map(() => days.map(() => 0)), days.map(() => 0)];
  days.forEach((d, j) => {
    for (const g of d.groups) nodes[index.get(keyOf(g)) ?? named.length]![j]! += g.nodes;
  });
  const folded = nodes[named.length]!.some((n) => n > 0);
  return {
    keys: [...named.map(([k]) => k), ...(folded ? [NODE_OTHER_KEY] : [])],
    labels: [...named.map(([, t]) => t.label), ...(folded ? ["other releases"] : [])],
    days: days.map((d) => d.day),
    answering: days.map((d) => d.answering),
    nodes: folded ? nodes : nodes.slice(0, named.length),
  };
}

/**
 * The hosting record as bands: the `top` networks by node-days, then every other node (networks
 * outside the top, and networks folded that day for being under the minimum), then no network.
 */
export function hostingBands(days: readonly NodeHostingDay[], top: number): NodeBands {
  const named = topHostingNetworks(days, top);
  const index = new Map(named.map((n, i) => [n.asn, i]));
  const nodes = named.map(() => days.map(() => 0));
  const other = days.map(() => 0);
  const unknown = days.map(() => 0);
  days.forEach((d, j) => {
    other[j] = d.other;
    unknown[j] = d.unknown;
    for (const n of d.networks) {
      const i = index.get(n.asn);
      if (i === undefined) other[j]! += n.nodes;
      else nodes[i]![j] = n.nodes;
    }
  });
  const keep = (series: number[]) => series.some((n) => n > 0);
  return {
    keys: [
      ...named.map((n) => `as${n.asn}`),
      ...(keep(other) ? [NODE_OTHER_KEY] : []),
      ...(keep(unknown) ? [NODE_UNKNOWN_NETWORK_KEY] : []),
    ],
    labels: [
      ...named.map((n) => n.org),
      ...(keep(other) ? ["other networks"] : []),
      ...(keep(unknown) ? ["no network found"] : []),
    ],
    days: days.map((d) => d.day),
    answering: days.map((d) => d.answering),
    nodes: [...nodes, ...(keep(other) ? [other] : []), ...(keep(unknown) ? [unknown] : [])],
  };
}
