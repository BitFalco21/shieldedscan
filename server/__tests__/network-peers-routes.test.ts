import { describe, expect, it } from "vitest";
import { networkPeersRoutes, summarisePeers } from "../network-peers-routes";
import type { RpcPeerInfo } from "../node-rpc";

/**
 * The peers route reduces `getpeerinfo` to counts. What it must never do is let a peer address
 * (or anything else from the node's table) reach the wire, and what it must never do on a cold
 * or unreachable node is answer with zero, which is a claim.
 */
const PEERS: RpcPeerInfo[] = [
  { addr: "203.0.113.9:8233", inbound: true, pingtime: 0.12 },
  { addr: "[2001:db8::7]:8233", inbound: true, pingtime: 0.3 },
  { addr: "198.51.100.4:41022", inbound: false },
  { addr: "192.0.2.77:8233", inbound: false, pingtime: 0.05 },
];

describe("summarisePeers", () => {
  it("counts inbound and outbound and takes the median ping in milliseconds", () => {
    const s = summarisePeers(PEERS, 1_000);
    expect(s).toEqual({
      basis: "ours",
      count: 4,
      inbound: 2,
      outbound: 2,
      medianPingMs: 120,
      asOf: 1_000,
    });
  });
  it("a peer table with no ping figures yields null, never 0", () => {
    expect(summarisePeers([{ addr: "x", inbound: true }], 1).medianPingMs).toBeNull();
  });
});

describe("network peers route", () => {
  it("serialises only the four numbers: no address, no subver, no per-peer row", async () => {
    const app = networkPeersRoutes({ rpc: { getPeerInfo: async () => PEERS } });
    const res = await app.request("/chain/network/peers");
    expect(res.status).toBe(200);
    const parsed = JSON.parse(await res.text()) as Record<string, unknown>;
    // Without `asOf`: it is the current time, and a timestamp like 1791200115 contains "2001",
    // the IPv6 peer's prefix, so checking the raw body failed on whatever second it ran.
    const rest = { ...parsed };
    delete rest.asOf;
    const body = JSON.stringify(rest);
    for (const p of PEERS) expect(body).not.toContain(p.addr.split(":")[0]!.replace("[", ""));
    expect(body).not.toContain("subver");
    expect(body).not.toContain("addr");
    expect(parsed).toMatchObject({ basis: "ours", count: 4, inbound: 2, outbound: 2 });
    expect(Object.keys(rest).sort()).toEqual(
      ["basis", "count", "inbound", "medianPingMs", "outbound"].sort(),
    );
  });
  it("an unreachable node is a 503, never a count of zero", async () => {
    const app = networkPeersRoutes({
      rpc: {
        getPeerInfo: async () => {
          throw new Error("node RPC getpeerinfo failed: ECONNREFUSED");
        },
      },
    });
    const res = await app.request("/chain/network/peers");
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain('"count":0');
  });
});
