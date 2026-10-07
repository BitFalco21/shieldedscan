import { describe, expect, it } from "vitest";
import { getZnsName } from "@/fixtures/zns";
import { nameCardFacts } from "../name-card-facts";

describe("nameCardFacts", () => {
  it("states the name and its address", () => {
    const facts = nameCardFacts(getZnsName("zenith"))!;
    expect(facts.name).toBe("zenith.zcash");
    expect(facts.addressShort).toMatch(/^u175lny2ww…/);
    expect(facts.stamp).toBe("ZCASH NAME");
  });

  it("dates the last action by its day, never as a relative age that goes stale", () => {
    const facts = nameCardFacts(getZnsName("abraham"))!;
    expect(facts.since).toMatch(/^UPDATED \d{1,2} [A-Z]+ \d{4}$/);
    expect(facts.since).not.toMatch(/AGO/);
    expect(facts.stamp).toBe("ZCASH NAME · FOR SALE");
  });

  it("has nothing to state for a released name or a withheld registry", () => {
    expect(nameCardFacts(getZnsName("kazecstan"))).toBeNull();
    expect(nameCardFacts(getZnsName("stalename"))).toBeNull();
  });

  it("sizes a long name down so it still fits one line", () => {
    const short = nameCardFacts(getZnsName("zenith"))!.nameSize;
    const long = nameCardFacts({
      ...getZnsName("zenith"),
      registrations: [{ ...getZnsName("zenith").registrations[0]!, name: "a".repeat(60) }],
    })!.nameSize;
    expect(long).toBeLessThan(short);
  });
});
