import { describe, expect, it } from "vitest";
import { retryOnDeadlock } from "../p2p/net-store";

const deadlock = () => Object.assign(new Error("deadlock detected"), { code: "40P01" });

describe("retryOnDeadlock", () => {
  it("retries a write Postgres chose as a deadlock victim", async () => {
    let calls = 0;
    const result = await retryOnDeadlock(async () => {
      calls += 1;
      if (calls === 1) throw deadlock();
      return "written";
    });
    expect(result).toBe("written");
    expect(calls).toBe(2);
  });

  it("passes any other error straight through, without retrying", async () => {
    let calls = 0;
    const failure = Object.assign(new Error("unique violation"), { code: "23505" });
    await expect(
      retryOnDeadlock(async () => {
        calls += 1;
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(calls).toBe(1);
  });

  it("gives up after two retries", async () => {
    let calls = 0;
    await expect(
      retryOnDeadlock(async () => {
        calls += 1;
        throw deadlock();
      }),
    ).rejects.toThrow("deadlock detected");
    expect(calls).toBe(3);
  });
});
