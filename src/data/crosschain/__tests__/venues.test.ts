import { describe, expect, it } from "vitest";
import { midgardVenuesFromEnv, normaliseMidgardBase } from "../venues";

describe("normaliseMidgardBase", () => {
  it("accepts a bare host", () => {
    expect(normaliseMidgardBase("https://midgard.mayachain.info")).toBe(
      "https://midgard.mayachain.info",
    );
  });

  it("strips a trailing /v2 so callers can always append it", () => {
    // Liquify publishes `…/chain/thorchain_midgard/v2/`; appending `/v2/actions` to that
    // verbatim gives `/v2/v2/actions` and a 404.
    expect(normaliseMidgardBase("https://gateway.liquify.com/chain/thorchain_midgard/v2/")).toBe(
      "https://gateway.liquify.com/chain/thorchain_midgard",
    );
    expect(normaliseMidgardBase("https://host/v2")).toBe("https://host");
  });

  it("strips trailing slashes and surrounding whitespace", () => {
    expect(normaliseMidgardBase("  https://host///  ")).toBe("https://host");
  });
});

describe("midgardVenuesFromEnv", () => {
  it("enables Maya by default", () => {
    const venues = midgardVenuesFromEnv({});
    expect(venues.maya?.base).toBe("https://midgard.mayachain.info");
    expect(venues.maya?.explorerTx).toBe("https://www.mayascan.org/tx/");
  });

  it("polls THORChain by default since its ZEC pool went live", () => {
    // Liquify's gateway is the default THORChain Midgard.
    const venues = midgardVenuesFromEnv({});
    expect(venues.thorchain?.base).toBe("https://gateway.liquify.com/chain/thorchain_midgard");
    // The explorer prefix is per venue and must not be shared with Maya's.
    expect(venues.thorchain?.explorerTx).toBe("https://thorchain.net/tx/");
  });

  it("lets THORChain's host be overridden, and switched off with an empty value", () => {
    const mirrored = midgardVenuesFromEnv({ MIDGARD_THORCHAIN_URL: "https://mirror.example/v2/" });
    expect(mirrored.thorchain?.base).toBe("https://mirror.example");
    // The kill switch: an empty base is "not polled", never "failing".
    expect(midgardVenuesFromEnv({ MIDGARD_THORCHAIN_URL: "" }).thorchain).toBeUndefined();
  });

  it("lets Maya's host be overridden — a hardcoded provider is a single point of failure", () => {
    // Third-party hosts disappear, so the base is configurable.
    const venues = midgardVenuesFromEnv({ MIDGARD_MAYA_URL: "https://mirror.example/v2" });
    expect(venues.maya?.base).toBe("https://mirror.example");
  });
});
