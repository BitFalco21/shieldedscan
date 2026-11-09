import { describe, expect, it } from "vitest";
import {
  HOSTING_MIN_NODES,
  NODE_OTHER_KEY,
  foldHosting,
  hostingBands,
  releaseLine,
  softwareBands,
  softwareHistory,
  type NetReleaseDay,
} from "@/domain";

const group = (client: string, version: string | null, nodes: number, pv = 170_190) => ({
  client,
  version,
  protocolVersion: pv,
  nodes,
  behindTip: 0,
  tipUnknown: 0,
});

describe("releaseLine", () => {
  it("is major.minor, or null with no parseable version", () => {
    expect(releaseLine("6.4.2")).toBe("6.4");
    expect(releaseLine("1.7.0-rc1")).toBe("1.7");
    expect(releaseLine(null)).toBeNull();
    expect(releaseLine("garbage")).toBeNull();
  });
});

describe("softwareHistory and its bands", () => {
  const history: NetReleaseDay[] = [
    {
      day: "2026-10-03",
      groups: [
        group("Zebra", "6.4.2", 30),
        group("Zebra", "6.4.1", 5, 170_160),
        group("Zakura", "1.6.0", 20),
      ],
    },
    {
      day: "2026-10-04",
      groups: [group("Zebra", "7.0.0", 12), group("Zebra", "6.4.2", 20), group("zcashd", null, 2)],
    },
  ];

  it("merges patch releases and protocol versions into one release line", () => {
    const days = softwareHistory(history);
    expect(days[0]!.groups).toEqual([
      { client: "Zebra", line: "6.4", nodes: 35 },
      { client: "Zakura", line: "1.6", nodes: 20 },
    ]);
    expect(days[1]!.answering).toBe(34);
  });

  it("names the top lines by node-days and folds the rest, every day summing to its nodes", () => {
    const bands = softwareBands(softwareHistory(history), 2);
    expect(bands.labels).toEqual(["Zebra 6.4", "Zakura 1.6", "other releases"]);
    expect(bands.keys.at(-1)).toBe(NODE_OTHER_KEY);
    bands.days.forEach((_, j) => {
      expect(bands.nodes.reduce((s, n) => s + n[j]!, 0)).toBe(bands.answering[j]);
    });
    expect(bands.nodes[2]).toEqual([0, 14]);
  });
});

describe("foldHosting and its bands", () => {
  const rows = [
    { day: "2026-11-01", asn: 24940, org: "Hetzner Online GmbH", nodes: 9 },
    { day: "2026-11-01", asn: 16276, org: "OVH SAS", nodes: HOSTING_MIN_NODES },
    { day: "2026-11-01", asn: 7018, org: "AT&T", nodes: HOSTING_MIN_NODES - 1 },
    { day: "2026-11-01", asn: 0, org: "", nodes: 4 },
    { day: "2026-11-02", asn: 24940, org: "Hetzner Online GmbH", nodes: 8 },
    { day: "2026-11-02", asn: 16276, org: "OVH SAS", nodes: 1 },
  ];

  it("never names a network under the minimum that day", () => {
    const days = foldHosting(rows);
    expect(days[0]!.networks.map((n) => n.org)).toEqual(["Hetzner Online GmbH", "OVH SAS"]);
    expect(days[0]).toMatchObject({ answering: 18, other: 2, otherNetworks: 1, unknown: 4 });
    // OVH falls to one node: folded that day, never published as a one-node row.
    expect(days[1]!.networks.map((n) => n.org)).toEqual(["Hetzner Online GmbH"]);
    expect(days[1]).toMatchObject({ other: 1, otherNetworks: 1 });
    for (const d of days) for (const n of d.networks) expect(n.nodes).toBeGreaterThanOrEqual(3);
  });

  it("draws a stable set of networks, the rest and the unknown folded, summing every day", () => {
    const bands = hostingBands(foldHosting(rows), 1);
    expect(bands.labels).toEqual(["Hetzner Online GmbH", "other networks", "no network found"]);
    expect(bands.nodes).toEqual([
      [9, 8],
      [5, 1],
      [4, 0],
    ]);
    bands.days.forEach((_, j) => {
      expect(bands.nodes.reduce((s, n) => s + n[j]!, 0)).toBe(bands.answering[j]);
    });
  });
});
