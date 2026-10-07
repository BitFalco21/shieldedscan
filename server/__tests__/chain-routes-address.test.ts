import { describe, expect, it } from "vitest";
import type { NodeChainSource } from "../chain-source";
import { chainRoutes } from "../chain-routes";

/**
 * `/chain/addresses/:address` and the shielded families. The node's `getaddressbalance` is
 * transparent-only, and its parse error for a shielded address varies by family (`zs1…` says
 * "invalid Bech32 encoding", a valid `u1…` "unexpected payload length"), so the route must answer
 * from `classifyZcashAddress`, as `/v1/addresses/:addr` and `/chain/search` do, and never ask the
 * node.
 */

// The site's real donation address: a genuinely valid unified address, i.e. the exact
// input whose node error message did NOT match the malformed-address regex.
const UNIFIED =
  "u1a4w9rqrv2knrp58qa5cwak545ul30rq4txh0nfs7hytjxlpcpswhzpattjx9w7c6tcvdw4n5rk92qqln7wc7yfzsdf9g84wf4fr7dyd7p7hup0rc4rj5sxydj98wk750q97dymkgddqs3qlfw2pkrpunle725ldf8aznfmg98g88gu5n";
const SAPLING = "zs1z7rejlpsa98s2rrrfkwmaxu53e4ue0ulcrw0h4x5g8jl04tak0d3mm47vdtahatqrlkngh9sly";

function sourceStub(overrides: Partial<NodeChainSource> = {}): NodeChainSource {
  return {
    getAddress: async () => {
      throw new Error("getAddress must not be called for a shielded address");
    },
    ...overrides,
  } as unknown as NodeChainSource;
}

describe("/chain/addresses/:address", () => {
  it.each([
    ["unified", UNIFIED],
    ["sapling", SAPLING],
  ])("answers a %s address from the classifier without asking the node", async (kind, addr) => {
    const app = chainRoutes(sourceStub());
    const res = await app.request(`/chain/addresses/${encodeURIComponent(addr)}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ kind, address: addr });
  });

  it("still delegates a transparent address to the source", async () => {
    const info = {
      kind: "transparent",
      address: "t1JP7PHu72TLi3vhckDkTRbXnRgTRQiz6mA",
      balanceZat: 5,
      totalReceivedZat: 10,
      totalSentZat: 5,
      txids: [],
    };
    const app = chainRoutes(sourceStub({ getAddress: async () => info } as never));
    const res = await app.request(`/chain/addresses/${info.address}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(info);
  });

  it("answers 404 for a string that is no address family at all", async () => {
    const app = chainRoutes(sourceStub({ getAddress: async () => undefined } as never));
    const res = await app.request("/chain/addresses/zzzz-not-an-address");
    expect(res.status).toBe(404);
  });
});
