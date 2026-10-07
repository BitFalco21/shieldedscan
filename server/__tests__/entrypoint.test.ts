import { afterEach, describe, expect, it, vi } from "vitest";
import { envNumber, parseNetworkEnv, requirePostgres } from "../entrypoint";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("envNumber", () => {
  it("is undefined when the variable is unset or empty", () => {
    vi.stubEnv("ENTRYPOINT_TEST_NUM", "");
    expect(envNumber("ENTRYPOINT_TEST_NUM")).toBeUndefined();
    expect(envNumber("ENTRYPOINT_TEST_UNSET")).toBeUndefined();
  });

  it("parses a number", () => {
    vi.stubEnv("ENTRYPOINT_TEST_NUM", "0.25");
    expect(envNumber("ENTRYPOINT_TEST_NUM")).toBe(0.25);
  });

  it("throws on a value that is not a finite number, naming the variable", () => {
    vi.stubEnv("ENTRYPOINT_TEST_NUM", "fast");
    expect(() => envNumber("ENTRYPOINT_TEST_NUM")).toThrow(/ENTRYPOINT_TEST_NUM/);
  });
});

describe("requirePostgres", () => {
  it("returns when either form of configuration is present", () => {
    const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("PGHOST", "db");
    requirePostgres();
    expect(exit).not.toHaveBeenCalled();
  });

  it("exits with the reason appended when neither is set", () => {
    const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("PGHOST", "");
    requirePostgres("no in-memory mode");
    expect(error).toHaveBeenCalledWith("PGHOST or DATABASE_URL is required — no in-memory mode");
    expect(exit).toHaveBeenCalledWith(1);
  });
});

describe("parseNetworkEnv", () => {
  it("is mainnet when unset or empty", () => {
    expect(parseNetworkEnv(undefined)).toBe("mainnet");
    expect(parseNetworkEnv("")).toBe("mainnet");
  });

  it("accepts the two networks by name", () => {
    expect(parseNetworkEnv("mainnet")).toBe("mainnet");
    expect(parseNetworkEnv("testnet")).toBe("testnet");
  });

  it("refuses anything else rather than guessing mainnet", () => {
    expect(() => parseNetworkEnv("Testnet")).toThrow(/ZCASH_NETWORK/);
  });
});
