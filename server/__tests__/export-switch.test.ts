import { describe, expect, it, vi } from "vitest";
import { MemoryStorePort } from "../crosschain-store";
import { v1Routes } from "../v1/routes";

/**
 * The cross-chain refusal is one constant: flipped, the layer as `/v1` mounts it stops refusing
 * by name and the descriptor stops listing the refusal. (A route still needs its table spec
 * before it exports; until then it is an ordinary "no file here" 400.)
 */
vi.mock("../v1/export/policy", async (original) => ({
  ...(await original<typeof import("../v1/export/policy")>()),
  CROSSCHAIN_EXPORT_ENABLED: true,
}));

describe("the cross-chain switch", () => {
  it("is read by the mounted layer and the descriptor alike", async () => {
    const v1 = v1Routes({ store: new MemoryStorePort(), enabledProtocols: {} });
    const res = await v1.request("/v1/crosschain/flows?format=csv");
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("invalid_parameter");
    const descriptor = await (await v1.request("/v1")).json();
    expect(descriptor.exports.refused).toEqual([]);
  });
});
