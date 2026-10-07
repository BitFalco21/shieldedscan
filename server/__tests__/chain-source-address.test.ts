import { describe, expect, it } from "vitest";
import type { HttpNodeRpc } from "../node-rpc";
import { NodeChainSource } from "../chain-source";

/**
 * `getAddress`'s malformed-vs-outage split, against the node's real error wordings. The catch may
 * absorb only a genuinely malformed identifier (503 is never 404), and it decides by matching the
 * error message. The node's parse errors do not share one wording:
 *
 *   zs1… (valid sapling)   → "-5 parse error: invalid Bech32 encoding"
 *   u1…  (valid unified)   → "-5 parse error: unexpected payload length"
 *
 * Route-level classification keeps shielded addresses away from the node entirely; this pins the
 * remaining layer: a shape-valid but undecodable identifier is a quiet not-found, while a
 * transport failure still rejects.
 */

function rpcThrowing(message: string): HttpNodeRpc {
  const boom = async () => {
    throw new Error(message);
  };
  return { getAddressBalance: boom, getAddressTxids: boom } as unknown as HttpNodeRpc;
}

describe("NodeChainSource.getAddress error split", () => {
  it.each([
    "node RPC getaddressbalance failed: -5 parse error: invalid Bech32 encoding",
    "node RPC getaddressbalance failed: -5 parse error: unexpected payload length",
    "node RPC getaddressbalance failed: -5 parse error: invalid base58",
  ])("absorbs a parse error as not-found: %s", async (message) => {
    const source = new NodeChainSource(rpcThrowing(message));
    await expect(source.getAddress("t1WrongLengthButValidChars")).resolves.toBeUndefined();
  });

  it.each([
    "node RPC getaddressbalance failed: HTTP 503",
    "node RPC getaddressbalance failed: fetch failed",
    "node RPC getaddressbalance failed: The operation was aborted due to timeout",
  ])("propagates an outage rather than dressing it as not-found: %s", async (message) => {
    const source = new NodeChainSource(rpcThrowing(message));
    await expect(source.getAddress("t1JP7PHu72TLi3vhckDkTRbXnRgTRQiz6mA")).rejects.toThrow();
  });
});

describe("NodeChainSource.getAddress load bounds", () => {
  const ADDR = "t1JP7PHu72TLi3vhckDkTRbXnRgTRQiz6mA";

  it("shares one node call between concurrent lookups of the same address", async () => {
    let txidCalls = 0;
    const rpc = {
      getAddressBalance: async () => ({ balance: 5, received: 10 }),
      getAddressTxids: async () => {
        txidCalls += 1;
        await new Promise((r) => setTimeout(r, 20));
        return ["a", "b"];
      },
    } as unknown as HttpNodeRpc;
    const source = new NodeChainSource(rpc);
    await Promise.all(Array.from({ length: 10 }, () => source.getAddress(ADDR)));
    expect(txidCalls).toBe(1);
  });

  it("does not retry a failed history on the node straight away", async () => {
    let txidCalls = 0;
    const rpc = {
      getAddressBalance: async () => ({ balance: 5, received: 10 }),
      getAddressTxids: async () => {
        txidCalls += 1;
        throw new Error(
          "node RPC getaddresstxids failed: The operation was aborted due to timeout",
        );
      },
    } as unknown as HttpNodeRpc;
    const source = new NodeChainSource(rpc);
    await expect(source.getAddress(ADDR)).rejects.toThrow();
    await expect(source.getAddress(ADDR)).rejects.toThrow();
    expect(txidCalls).toBe(1);
  });
});
