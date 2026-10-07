import { describe, expect, it } from "vitest";
import { isTransientUpstream, nullIfTransient } from "../transient-upstream";

describe("transient upstream failures", () => {
  it("treats a timeout as transient — the case that took a deploy down", () => {
    const timeout = new Error("The operation was aborted due to timeout");
    timeout.name = "TimeoutError";
    expect(isTransientUpstream(timeout)).toBe(true);
  });

  it("treats an unreachable host and a 5xx as transient", () => {
    const netFail = new Error("fetch failed");
    netFail.name = "TypeError";
    expect(isTransientUpstream(netFail)).toBe(true);
    expect(isTransientUpstream(new Error("chain API returned 503 for months"))).toBe(true);
  });

  it("does NOT swallow version skew — the build tripwire must still fire", () => {
    // A commit adding a required field must fail the frontend build until the API serving it
    // is live. If these were caught, a skew would render "temporarily unavailable" forever and
    // look like an outage instead of a missing deploy.
    expect(isTransientUpstream(new Error("unrecognised transactions shape"))).toBe(false);
    expect(isTransientUpstream(new Error("chain API returned 404 for months"))).toBe(false);
    expect(isTransientUpstream(new Error("chain API returned 401 for months"))).toBe(false);
    expect(isTransientUpstream(new TypeError("x.map is not a function"))).toBe(false);
    expect(isTransientUpstream("not an error")).toBe(false);
  });
});

describe("nullIfTransient", () => {
  it("resolves the read's value", async () => {
    expect(await nullIfTransient(async () => 7)).toBe(7);
  });
  it("turns a transient failure into null", async () => {
    expect(
      await nullIfTransient(async () => Promise.reject(new Error("chain API returned 503 for x"))),
    ).toBeNull();
  });
  it("lets a shape error through — the version-skew tripwire stays loud", async () => {
    await expect(
      nullIfTransient(async () => Promise.reject(new Error("unrecognised months shape"))),
    ).rejects.toThrow(/shape/);
  });
});
