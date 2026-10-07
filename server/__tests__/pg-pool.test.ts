import { describe, expect, it, vi } from "vitest";

const ctor = vi.fn();
vi.mock("pg", () => ({
  Pool: class {
    constructor(config: unknown) {
      ctor(config);
    }
  },
}));

const { createPool, rollbackQuietly } = await import("../pg-pool");

describe("createPool", () => {
  it("passes the connection string beside the options when one is given", () => {
    createPool("postgres://x", { max: 2, statement_timeout: 5_000 });
    expect(ctor).toHaveBeenLastCalledWith({
      connectionString: "postgres://x",
      max: 2,
      statement_timeout: 5_000,
    });
  });
  it("omits the key entirely when there is none, so pg falls back to PG* variables", () => {
    createPool(undefined, { max: 4 });
    const config = ctor.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect("connectionString" in config).toBe(false);
    expect(config).toEqual({ max: 4 });
  });
  it("never shares the options object with the caller", () => {
    const opts = { max: 1 };
    createPool(undefined, opts);
    expect(ctor.mock.calls.at(-1)?.[0]).not.toBe(opts);
  });
});

describe("rollbackQuietly", () => {
  it("sends ROLLBACK", async () => {
    const query = vi.fn(() => Promise.resolve());
    await rollbackQuietly({ query } as never);
    expect(query).toHaveBeenCalledWith("ROLLBACK");
  });
  it("swallows a failed ROLLBACK, so the caller's own error is the one that propagates", async () => {
    const query = vi.fn(() => Promise.reject(new Error("connection terminated")));
    await expect(rollbackQuietly({ query } as never)).resolves.toBeUndefined();
  });
});
