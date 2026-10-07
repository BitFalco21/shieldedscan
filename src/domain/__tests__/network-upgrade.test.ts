import { describe, expect, it } from "vitest";
import {
  NU7,
  NU7_RELEASES,
  classifyUpgradeReadiness,
  readinessHistory,
  releaseCarriesUpgrade,
  summarizeUpgradeReadiness,
  versionAtLeast,
  type NetReleaseGroup,
  type UpgradeRelease,
} from "@/domain";

const group = (over: Partial<NetReleaseGroup>): NetReleaseGroup => ({
  client: "Zebra",
  version: "6.4.2",
  protocolVersion: 170_160,
  nodes: 1,
  behindTip: 0,
  tipUnknown: 0,
  ...over,
});

const MAINNET_ZEBRA: UpgradeRelease = {
  client: "Zebra",
  firstVersion: "7.0.0",
  network: "mainnet",
  source: "https://example.invalid/notes",
  verifiedOn: "2026-10-21",
};

describe("NU7 constants", () => {
  it("carry ZIP 259's values and no mainnet height yet", () => {
    expect(NU7.minProtocolVersion).toEqual({ mainnet: 170_190, testnet: 170_180 });
    expect(NU7.activationHeight).toEqual({ mainnet: null, testnet: 4_465_026 });
    expect(NU7.branchId).toBe("0x77190AD9");
  });

  it("list no release that can activate NU7 on mainnet", () => {
    // Remove this when a release's own notes carry the mainnet height — and not before.
    expect(NU7_RELEASES.filter((r) => r.network === "mainnet")).toEqual([]);
  });
});

describe("versionAtLeast", () => {
  it("orders releases, pre-releases below the release they precede", () => {
    expect(versionAtLeast("7.0.0", "7.0.0")).toBe(true);
    expect(versionAtLeast("7.0.1", "7.0.0")).toBe(true);
    expect(versionAtLeast("7.0.0", "7.0.0-rc.0")).toBe(true);
    expect(versionAtLeast("7.0.0-rc.0", "7.0.0")).toBe(false);
    expect(versionAtLeast("6.9.9", "7.0.0")).toBe(false);
  });
});

describe("classifyUpgradeReadiness", () => {
  it("draws the protocol-version line exactly at ZIP 259's minimum", () => {
    expect(classifyUpgradeReadiness(group({ protocolVersion: 170_189 }), NU7, "mainnet", [])).toBe(
      "older",
    );
    expect(classifyUpgradeReadiness(group({ protocolVersion: 170_190 }), NU7, "mainnet", [])).toBe(
      "declares",
    );
    expect(classifyUpgradeReadiness(group({ protocolVersion: null }), NU7, "mainnet", [])).toBe(
      "undeclared",
    );
  });

  it("never calls the protocol version alone ready — Zakura 1.5.0 declares 170190 with NU7 unscheduled", () => {
    const zakura = group({ client: "Zakura", version: "1.6.0", protocolVersion: 170_190 });
    expect(classifyUpgradeReadiness(zakura, NU7, "mainnet", NU7_RELEASES)).toBe("declares");
  });

  it("is ready only with a release that carries the height on THIS network", () => {
    const zebra = group({ version: "7.0.0", protocolVersion: 170_190 });
    expect(classifyUpgradeReadiness(zebra, NU7, "mainnet", [MAINNET_ZEBRA])).toBe("ready");
    // Zebra 7.0.0-rc.0 activates NU7 on testnet only; it must not count on mainnet.
    const rc = group({ version: "7.0.0-rc.0", protocolVersion: 170_190 });
    expect(classifyUpgradeReadiness(rc, NU7, "mainnet", NU7_RELEASES)).toBe("declares");
    expect(releaseCarriesUpgrade("Zebra", "7.0.0-rc.0", "testnet", NU7_RELEASES)).toBe(true);
  });

  it("needs the protocol version too: a carrying release that declares less is not ready", () => {
    const odd = group({ version: "7.0.0", protocolVersion: 170_180 });
    expect(classifyUpgradeReadiness(odd, NU7, "mainnet", [MAINNET_ZEBRA])).toBe("older");
  });

  it("a release with no version cannot match the table", () => {
    expect(releaseCarriesUpgrade("Zebra", null, "mainnet", [MAINNET_ZEBRA])).toBe(false);
  });
});

describe("summarizeUpgradeReadiness", () => {
  const groups = [
    group({ client: "Zakura", version: "1.6.0", protocolVersion: 170_190, nodes: 30 }),
    group({ version: "6.4.2", protocolVersion: 170_160, nodes: 37, behindTip: 2 }),
    group({ version: "7.0.0", protocolVersion: 170_190, nodes: 5, tipUnknown: 1 }),
    group({ client: "zcashd", version: "6.12.1", protocolVersion: 170_140, nodes: 2 }),
    group({
      client: "Unidentified",
      version: null,
      protocolVersion: null,
      nodes: 1,
      tipUnknown: 1,
    }),
  ];

  it("partitions every answering node into exactly one state", () => {
    const s = summarizeUpgradeReadiness(groups, NU7, "mainnet", [MAINNET_ZEBRA]);
    expect(s.answering).toBe(75);
    expect(s.ready.numerator).toBe(5);
    expect(s.declares.numerator).toBe(30);
    expect(s.older.numerator).toBe(39);
    expect(s.undeclared.numerator).toBe(1);
    expect(
      s.ready.numerator + s.declares.numerator + s.older.numerator + s.undeclared.numerator,
    ).toBe(s.answering);
    expect(s.ready.denominator).toBe(75);
  });

  it("states the behind share over the nodes whose lag is known, never over all", () => {
    const s = summarizeUpgradeReadiness(groups, NU7, "mainnet", []);
    expect(s.tipKnown).toBe(73);
    expect(s.behindTip).toEqual({ pct: (2 / 73) * 100, numerator: 2, denominator: 73 });
  });

  it("splits per client and keeps each client's states summing to its nodes", () => {
    const s = summarizeUpgradeReadiness(groups, NU7, "mainnet", [MAINNET_ZEBRA]);
    const zebra = s.clients.find((c) => c.client === "Zebra")!;
    expect(zebra).toMatchObject({ nodes: 42, ready: 5, declares: 0, older: 37, undeclared: 0 });
    for (const c of s.clients) {
      expect(c.ready + c.declares + c.older + c.undeclared).toBe(c.nodes);
    }
  });

  it("reads every history day by the same rule as today", () => {
    const days = readinessHistory(
      [
        { day: "2026-10-03", groups },
        { day: "2026-10-04", groups: groups.slice(0, 2) },
      ],
      NU7,
      "mainnet",
      [MAINNET_ZEBRA],
    );
    expect(days.map((d) => [d.day, d.answering, d.ready, d.declares])).toEqual([
      ["2026-10-03", 75, 5, 30],
      ["2026-10-04", 67, 0, 30],
    ]);
  });
});
