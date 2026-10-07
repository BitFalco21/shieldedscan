import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpNodeRpc, NodeRpcError } from "../node-rpc";

/**
 * The opt-in ceiling on concurrent node calls. Measured, not read off the constant: a stub `fetch`
 * holds every request open until released and records the peak number in flight.
 */

function heldFetch() {
  let inFlight = 0;
  let peak = 0;
  const pending: Array<() => void> = [];
  const fetchStub = vi.fn(async () => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise<void>((resolve) => pending.push(resolve));
    inFlight -= 1;
    return new Response(JSON.stringify({ result: { blocks: 1 } }), { status: 200 });
  });
  return {
    fetchStub,
    peak: () => peak,
    inFlight: () => inFlight,
    /** Let every request currently held finish. */
    releaseAll: () => pending.splice(0).forEach((r) => r()),
  };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("HttpNodeRpc concurrency ceiling", () => {
  it("never has more calls in flight than the ceiling, and completes every queued call", async () => {
    const f = heldFetch();
    vi.stubGlobal("fetch", f.fetchStub);
    const rpc = new HttpNodeRpc("http://node", {
      timeoutMs: 60_000,
      limits: { maxInFlight: 3, maxWaitMs: 60_000 },
    });
    const calls = Array.from({ length: 10 }, () => rpc.getTipHeight());
    await settle();
    expect(f.inFlight()).toBe(3);
    // Drain round by round: each release lets the queue move up to the ceiling again.
    for (let round = 0; round < 4; round += 1) {
      f.releaseAll();
      await settle();
    }
    await expect(Promise.all(calls)).resolves.toEqual(Array(10).fill(1));
    expect(f.peak()).toBe(3);
    expect(rpc.inFlight).toBe(0);
  });

  it("fails a call that waits past maxWaitMs as a transient node error, never hangs", async () => {
    vi.useFakeTimers();
    const f = heldFetch();
    vi.stubGlobal("fetch", f.fetchStub);
    const rpc = new HttpNodeRpc("http://node", {
      timeoutMs: 60_000,
      limits: { maxInFlight: 1, maxWaitMs: 5_000 },
    });
    const first = rpc.getTipHeight();
    const second = rpc.getTipHeight();
    const outcome = second.then(
      () => "resolved",
      (e: unknown) => e,
    );
    await vi.advanceTimersByTimeAsync(5_001);
    const err = await outcome;
    expect(err).toBeInstanceOf(NodeRpcError);
    expect(String(err)).toMatch(/node busy/);
    // The timed-out waiter must not take a slot when the first call finishes.
    f.releaseAll();
    await expect(first).resolves.toBe(1);
    expect(rpc.inFlight).toBe(0);
  });

  it("is unlimited when no ceiling is given — the follower's and the tools' behaviour", async () => {
    const f = heldFetch();
    vi.stubGlobal("fetch", f.fetchStub);
    const rpc = new HttpNodeRpc("http://node");
    const calls = Array.from({ length: 10 }, () => rpc.getTipHeight());
    await settle();
    expect(f.inFlight()).toBe(10);
    f.releaseAll();
    await Promise.all(calls);
  });
});

describe("a busy node reaches a /v1 caller as a 503", () => {
  it("maps the ceiling's refusal to upstream_unavailable, never a 500", async () => {
    const { v1Routes } = await import("../v1/routes");
    const { MemoryStorePort } = await import("../crosschain-store");
    const busy = new NodeRpcError("getblock", "node busy: no RPC slot within 5000 ms");
    const chain = {
      getChainFacts: async () => {
        throw busy;
      },
    } as unknown as Parameters<typeof v1Routes>[0]["chain"];
    const app = v1Routes({ store: new MemoryStorePort(), enabledProtocols: {}, chain });
    const res = await app.request("/v1/status");
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("upstream_unavailable");
  });
});
