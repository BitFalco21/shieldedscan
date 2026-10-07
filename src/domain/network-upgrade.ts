import {
  compareVersionsDesc,
  share,
  type NetReleaseDay,
  type NetReleaseGroup,
  type NetShare,
} from "./netmap";

/**
 * Whether the nodes the crawler can reach run software that can follow a network upgrade.
 *
 * Two facts decide it, and only together:
 * - The declared protocol version. The deployment ZIP sets a minimum a compatible node must
 *   announce. Necessary, never sufficient: a node can announce the protocol version of an
 *   upgrade whose mainnet height its release does not carry (Zakura v1.5.0 declares NU7's
 *   170190 while NU7 is unscheduled on mainnet).
 * - The release. A committed table of releases whose own notes set the activation height on
 *   the network in question, each with its source and the day it was read. Empty until a
 *   release ships one, and the page says why it is empty.
 *
 * The table lives here rather than on the wire so that adding a release is a frontend change:
 * the API sends raw (client, release, protocol) counts and every verdict is drawn page-side.
 */

export type UpgradeNetwork = "mainnet" | "testnet";

export interface NetworkUpgrade {
  id: string;
  name: string;
  /** The deployment ZIP that defines the constants below. */
  zip: number;
  branchId: string;
  minProtocolVersion: Record<UpgradeNetwork, number>;
  /** Null until the deployment ZIP assigns it. */
  activationHeight: Record<UpgradeNetwork, number | null>;
  /** What the ZIP said about an unassigned height, verbatim enough to quote. */
  heightPending: string;
  source: { title: string; href: string; verifiedOn: string };
}

/** NU7, from ZIP 259 (Draft). Re-read when the mainnet height is assigned. */
export const NU7: NetworkUpgrade = {
  id: "nu7",
  name: "NU7",
  zip: 259,
  branchId: "0x77190AD9",
  minProtocolVersion: { mainnet: 170_190, testnet: 170_180 },
  activationHeight: { mainnet: null, testnet: 4_465_026 },
  heightPending: "to be set on October 20",
  source: {
    title: "ZIP 259: Deployment of the NU7 Network Upgrade",
    href: "https://zips.z.cash/zip-0259",
    verifiedOn: "2026-10-03",
  },
};

/** A release line whose own notes set the upgrade's activation height on a network. */
export interface UpgradeRelease {
  client: string;
  /** The first release that carries it; later releases of the same client are assumed to. */
  firstVersion: string;
  network: UpgradeNetwork;
  /** The release notes that say so. */
  source: string;
  verifiedOn: string;
}

/**
 * Releases that can activate NU7. Mainnet has none: the height is assigned on October 20 and no
 * release can carry it before then. Zebra 7.0.0-rc.0 activates it on Testnet only, and says so;
 * it is listed because the rule is per network, and a testnet-only release must not count on
 * mainnet. Add a mainnet entry only from the release's own notes, never from an announcement.
 */
export const NU7_RELEASES: readonly UpgradeRelease[] = [
  {
    client: "Zebra",
    firstVersion: "7.0.0-rc.0",
    network: "testnet",
    source: "https://github.com/ZcashFoundation/zebra/releases/tag/v7.0.0-rc.0",
    verifiedOn: "2026-10-03",
  },
];

/**
 * - `ready`: a release that carries the height AND the minimum protocol version declared.
 * - `declares`: the minimum protocol version declared by a release not known to carry the height.
 * - `older`: a lower protocol version declared.
 * - `undeclared`: no protocol version at all.
 */
export type UpgradeReadiness = "ready" | "declares" | "older" | "undeclared";

/** `a` is the same release as `b` or newer, by the release ladder's own ordering. */
export function versionAtLeast(a: string, b: string): boolean {
  return compareVersionsDesc(a, b) <= 0;
}

/** The release-table half of the rule: does this client's release carry the height here? */
export function releaseCarriesUpgrade(
  client: string,
  version: string | null,
  network: UpgradeNetwork,
  releases: readonly UpgradeRelease[],
): boolean {
  if (version === null) return false;
  return releases.some(
    (r) => r.network === network && r.client === client && versionAtLeast(version, r.firstVersion),
  );
}

export function classifyUpgradeReadiness(
  group: Pick<NetReleaseGroup, "client" | "version" | "protocolVersion">,
  upgrade: NetworkUpgrade,
  network: UpgradeNetwork,
  releases: readonly UpgradeRelease[],
): UpgradeReadiness {
  if (group.protocolVersion === null) return "undeclared";
  if (group.protocolVersion < upgrade.minProtocolVersion[network]) return "older";
  return releaseCarriesUpgrade(group.client, group.version, network, releases)
    ? "ready"
    : "declares";
}

export interface ReadinessCounts {
  ready: number;
  declares: number;
  older: number;
  undeclared: number;
}

export interface ClassifiedRelease extends NetReleaseGroup {
  state: UpgradeReadiness;
}

export interface UpgradeReadinessSummary {
  answering: number;
  ready: NetShare;
  declares: NetShare;
  older: NetShare;
  undeclared: NetShare;
  behindTip: NetShare;
  /** Nodes whose lag could be stated — the denominator a "behind" share is honest over. */
  tipKnown: number;
  clients: Array<ReadinessCounts & { client: string; nodes: number }>;
  releases: ClassifiedRelease[];
}

function emptyCounts(): ReadinessCounts {
  return { ready: 0, declares: 0, older: 0, undeclared: 0 };
}

/**
 * The page's whole verdict, from the groups the API sent. One implementation serves today's row
 * and every history day, so the trend line and the headline cannot disagree.
 */
export function summarizeUpgradeReadiness(
  groups: readonly NetReleaseGroup[],
  upgrade: NetworkUpgrade,
  network: UpgradeNetwork,
  releases: readonly UpgradeRelease[],
): UpgradeReadinessSummary {
  const totals = emptyCounts();
  const byClient = new Map<string, ReadinessCounts & { client: string; nodes: number }>();
  let answering = 0;
  let behind = 0;
  let unknown = 0;
  const classified: ClassifiedRelease[] = groups.map((g) => {
    const state = classifyUpgradeReadiness(g, upgrade, network, releases);
    answering += g.nodes;
    behind += g.behindTip;
    unknown += g.tipUnknown;
    totals[state] += g.nodes;
    const c = byClient.get(g.client) ?? { client: g.client, nodes: 0, ...emptyCounts() };
    c.nodes += g.nodes;
    c[state] += g.nodes;
    byClient.set(g.client, c);
    return { ...g, state };
  });
  const tipKnown = answering - unknown;
  return {
    answering,
    ready: share(totals.ready, answering),
    declares: share(totals.declares, answering),
    older: share(totals.older, answering),
    undeclared: share(totals.undeclared, answering),
    behindTip: share(behind, tipKnown),
    tipKnown,
    clients: [...byClient.values()].sort(
      (a, b) => b.nodes - a.nodes || a.client.localeCompare(b.client),
    ),
    releases: classified.sort(
      (a, b) =>
        a.client.localeCompare(b.client) ||
        compareVersionsDesc(a.version ?? "", b.version ?? "") ||
        b.nodes - a.nodes,
    ),
  };
}

export interface ReadinessDay extends ReadinessCounts {
  day: string;
  answering: number;
  behindTip: number;
  tipKnown: number;
}

/** The trend line: one summary per recorded day, oldest first. */
export function readinessHistory(
  days: readonly NetReleaseDay[],
  upgrade: NetworkUpgrade,
  network: UpgradeNetwork,
  releases: readonly UpgradeRelease[],
): ReadinessDay[] {
  return days.map((d) => {
    const s = summarizeUpgradeReadiness(d.groups, upgrade, network, releases);
    return {
      day: d.day,
      answering: s.answering,
      ready: s.ready.numerator,
      declares: s.declares.numerator,
      older: s.older.numerator,
      undeclared: s.undeclared.numerator,
      behindTip: s.behindTip.numerator,
      tipKnown: s.tipKnown,
    };
  });
}
