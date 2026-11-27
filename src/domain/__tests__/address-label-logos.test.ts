import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ECOSYSTEM_LOGOS } from "@/features/ecosystem/logos.generated";
import { ADDRESS_LABELS, EXCHANGES, LABEL_LOGOS, addressLabel, addressLabelLogo } from "@/domain";

describe("label logos", () => {
  it("decides a logo, or its absence, for every label name", () => {
    for (const label of Object.values(ADDRESS_LABELS)) {
      expect(Object.hasOwn(LABEL_LOGOS, label.name), label.name).toBe(true);
    }
  });

  it("points only at committed, reviewed logos", () => {
    const logos = [...Object.values(LABEL_LOGOS), ...EXCHANGES];
    for (const logo of logos) {
      if (logo === null) continue;
      expect(ECOSYSTEM_LOGOS.has(logo), logo).toBe(true);
      expect(existsSync(join(process.cwd(), "public/ecosystem/logos", `${logo}.png`)), logo).toBe(
        true,
      );
    }
  });

  it("gives an exchange's addresses its logo", () => {
    expect(addressLabelLogo(addressLabel("t1gsBrGZGMyDGZw2icGnMpVBuEGVWip5kH8")!)).toBe("binance");
    expect(addressLabelLogo(addressLabel("t3aPMe94jMKyrgkbH5SSukimvdMFJ59EFhP")!)).toBe("gemini");
  });

  it("never gives a theft-flagged address a logo", () => {
    for (const label of Object.values(ADDRESS_LABELS)) {
      if (label.flag !== undefined) expect(addressLabelLogo(label), label.name).toBeNull();
    }
    // Even if someone maps the name, the flag wins.
    expect(
      addressLabelLogo({
        name: "Binance",
        basis: "external",
        flag: { by: "test", href: "https://example.org", note: "test" },
      } as never),
    ).toBeNull();
  });
});
