import { afterEach, describe, expect, it, vi } from "vitest";
import { UPSTREAM_UNAVAILABLE_DIGEST } from "@/lib/transient-upstream";
import { fixtureDataSource } from "../fixture-source";
import { injectFaults, tagTransientFailures } from "../source-wrappers";
import type { ExplorerDataSource } from "../source";

const timeout = () =>
  Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });

function failingWith(error: Error): ExplorerDataSource {
  return { ...fixtureDataSource, getChainInfo: () => Promise.reject(error) };
}

describe("tagTransientFailures", () => {
  it("stamps a transient failure with the digest the error boundary reads", async () => {
    const source = tagTransientFailures(failingWith(timeout()));
    await expect(source.getChainInfo()).rejects.toMatchObject({
      digest: UPSTREAM_UNAVAILABLE_DIGEST,
    });
  });

  it("leaves a shape error alone, so the boundary still calls it a bug", async () => {
    const source = tagTransientFailures(failingWith(new Error("unrecognised shape")));
    const error = await source.getChainInfo().catch((e: unknown) => e);
    expect(error).not.toHaveProperty("digest");
  });

  it("passes answers through untouched", async () => {
    const source = tagTransientFailures(fixtureDataSource);
    expect(await source.getChainInfo()).toEqual(await fixtureDataSource.getChainInfo());
  });
});

describe("injectFaults", () => {
  it("fails exactly the named methods, as a timeout", async () => {
    const source = injectFaults(fixtureDataSource, async () => ["getPools"]);
    await expect(source.getPools()).rejects.toMatchObject({ name: "TimeoutError" });
    await expect(source.getChainInfo()).resolves.toBeDefined();
  });
});

/** The seam must be unreachable outside the fixture build the e2e suites start. */
describe("the fault seam's gates", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
    vi.doUnmock("next/headers");
  });

  async function sourceWith(env: Record<string, string>) {
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    vi.doMock("next/headers", () => ({
      headers: async () => new Headers({ "x-e2e-fault": "getChainInfo" }),
    }));
    const { getDataSource } = await import("../index");
    return getDataSource();
  }

  it("fails a named method on the fixture source with E2E_FAULTS=1", async () => {
    const source = await sourceWith({
      E2E_FAULTS: "1",
      CROSSCHAIN_API_URL: "",
      EXPLORER_API_TOKEN: "",
    });
    await expect(source.getChainInfo()).rejects.toMatchObject({
      name: "TimeoutError",
      digest: UPSTREAM_UNAVAILABLE_DIGEST,
    });
  });

  it("ignores the header without E2E_FAULTS", async () => {
    const source = await sourceWith({
      E2E_FAULTS: "",
      CROSSCHAIN_API_URL: "",
      EXPLORER_API_TOKEN: "",
    });
    await expect(source.getChainInfo()).resolves.toBeDefined();
  });

  it("ignores the header on the live API source, whatever the environment says", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })),
    );
    const source = await sourceWith({
      E2E_FAULTS: "1",
      CROSSCHAIN_API_URL: "https://api.example",
      EXPLORER_API_TOKEN: "t",
    });
    // The stub answers `{}`, which the adapter rejects as a shape: proof the request went to
    // the API rather than being failed by the seam.
    await expect(source.getChainInfo()).rejects.not.toMatchObject({ name: "TimeoutError" });
  });
});
