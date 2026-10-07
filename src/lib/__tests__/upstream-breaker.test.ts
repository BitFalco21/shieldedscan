import { describe, expect, it } from "vitest";
import { UpstreamBreaker, UpstreamOpenError } from "../upstream-breaker";
import { isTransientUpstream } from "../transient-upstream";

describe("UpstreamBreaker", () => {
  it("stays closed below the threshold, so a blip is still retried normally", () => {
    const b = new UpstreamBreaker({ threshold: 3 });
    b.recordFailure();
    b.recordFailure();
    expect(() => b.assertClosed("/x")).not.toThrow();
    expect(b.isOpen).toBe(false);
  });

  it("opens after `threshold` consecutive failures and refuses at once", () => {
    let t = 0;
    const b = new UpstreamBreaker({ threshold: 3, openMs: 30_000, now: () => t });
    for (let i = 0; i < 3; i += 1) b.recordFailure();
    expect(b.isOpen).toBe(true);
    expect(() => b.assertClosed("/chain/blocks")).toThrow(UpstreamOpenError);
    t = 29_999;
    expect(() => b.assertClosed("/chain/blocks")).toThrow(UpstreamOpenError);
  });

  it("a success resets the count, so failures must be CONSECUTIVE", () => {
    const b = new UpstreamBreaker({ threshold: 3 });
    b.recordFailure();
    b.recordFailure();
    b.recordSuccess();
    b.recordFailure();
    b.recordFailure();
    expect(b.isOpen).toBe(false);
  });

  it("lets exactly ONE probe through after openMs, and keeps refusing until it reports", () => {
    let t = 0;
    const b = new UpstreamBreaker({ threshold: 1, openMs: 1_000, now: () => t });
    b.recordFailure();
    t = 1_000;
    expect(() => b.assertClosed("/a")).not.toThrow(); // the probe
    expect(() => b.assertClosed("/b")).toThrow(UpstreamOpenError); // not a second one
    b.recordSuccess();
    expect(b.isOpen).toBe(false);
    expect(() => b.assertClosed("/c")).not.toThrow();
  });

  it("a failed probe re-opens the circuit for another full window", () => {
    let t = 0;
    const b = new UpstreamBreaker({ threshold: 1, openMs: 1_000, now: () => t });
    b.recordFailure();
    t = 1_000;
    b.assertClosed("/probe");
    b.recordFailure();
    t = 1_500;
    expect(() => b.assertClosed("/x")).toThrow(UpstreamOpenError);
    t = 2_000;
    expect(() => b.assertClosed("/x")).not.toThrow();
  });

  it("its error is TRANSIENT, so pages render DataUnavailable rather than a skew failure", () => {
    expect(isTransientUpstream(new UpstreamOpenError("/chain/info", 12_000))).toBe(true);
  });
});
