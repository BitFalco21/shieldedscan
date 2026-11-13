import { describe, expect, it } from "vitest";
import { deriveSummary, fullNodes } from "../netmap/derive";
import {
  FULL_PROOF_WINDOW_SEC,
  REACHABLE_WINDOW_SEC,
  type GhostNodeRow,
  type NetmapSnapshot,
} from "../netmap/snapshot";
import { v1NodesRoutes } from "../v1/network-nodes";

const NOW = 1_791_100_000;
const DAY = 86_400;

const ghost = (host: string, over: Partial<GhostNodeRow>): GhostNodeRow => ({
  host,
  port: 8233,
  network: "ipv4",
  tor_exit: false,
  country: null,
  lat: null,
  lon: null,
  last_error: null,
  last_attempt: NOW - 300,
  last_reachable: null,
  last_full: null,
  ...over,
});

function snapshotOf(ghosts: GhostNodeRow[]): NetmapSnapshot {
  return {
    at: NOW,
    live: [],
    ghosts,
    links: [],
    crawls: [],
    crawlsTotal: 0,
    firstCrawlStartedAt: null,
    recentBlocks: [],
    releaseDays: [],
    hostingDays: [],
  };
}

const counted = (g: GhostNodeRow) => fullNodes(snapshotOf([g])).length === 1;

describe("full nodes", () => {
  it("counts a node full within the day and proven by a handshake within the week", () => {
    expect(counted(ghost("a", { last_full: NOW - 600, last_reachable: NOW - 3 * DAY }))).toBe(true);
  });

  it("does not count a full refusal from a node that never completed a handshake", () => {
    // A full refusal sends no bytes; without a past handshake nothing shows it is a Zcash node.
    expect(counted(ghost("b", { last_full: NOW - 600, last_reachable: null }))).toBe(false);
  });

  it("does not count a node whose last handshake is older than the proof window", () => {
    const stale = NOW - FULL_PROOF_WINDOW_SEC - 1;
    expect(counted(ghost("c", { last_full: NOW - 600, last_reachable: stale }))).toBe(false);
    const edge = NOW - FULL_PROOF_WINDOW_SEC;
    expect(counted(ghost("c2", { last_full: NOW - 600, last_reachable: edge }))).toBe(true);
  });

  it("does not count a node last found full outside the answering window", () => {
    const old = NOW - REACHABLE_WINDOW_SEC - 1;
    expect(counted(ghost("d", { last_full: old, last_reachable: NOW - 2 * DAY }))).toBe(false);
  });

  it("does not count a node that was never found full", () => {
    expect(counted(ghost("e", { last_full: null, last_reachable: NOW - 2 * DAY }))).toBe(false);
  });

  it("adds full nodes to the answering count as active, and publishes both on /v1/nodes", async () => {
    const snap = snapshotOf([
      ghost("f1", { last_full: NOW - 60, last_reachable: NOW - DAY - 60 }),
      ghost("f2", { last_full: NOW - 60, last_reachable: null }),
    ]);
    const s = deriveSummary(snap);
    expect(s.full).toBe(1);
    expect(s.active).toBe(s.reachable + 1);
    const reader = { read: async () => snap, close: async () => {} };
    const body = await (await v1NodesRoutes(reader).request("/v1/nodes")).json();
    expect(body.data.full).toBe(1);
    expect(body.data.active).toBe(body.data.answering + 1);
  });
});
