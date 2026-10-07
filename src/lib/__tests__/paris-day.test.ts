import { describe, expect, it } from "vitest";
import { dueForDailyPost, parisDay, parisHour } from "../paris-day";

// Europe/Paris is UTC+2 in summer (CEST) and UTC+1 in winter (CET). A fixed UTC hour
// would drift by an hour twice a year; the key is the Paris calendar day so the DST
// changeover cannot produce two posts for one day or none for another.
const at = (iso: string) => Date.parse(iso);

describe("parisDay", () => {
  it("is the Paris calendar date, not the UTC one", () => {
    // 22:30 UTC on the 29th is 00:30 on the 30th in Paris (CEST).
    expect(parisDay(at("2026-08-29T22:30:00Z"))).toBe("2026-08-30");
  });

  it("handles winter time", () => {
    // 23:30 UTC on 1 Dec is 00:30 on 2 Dec in Paris (CET).
    expect(parisDay(at("2026-12-01T23:30:00Z"))).toBe("2026-12-02");
  });
});

describe("parisHour", () => {
  it("reads 18:00 CEST from 16:00 UTC in summer", () => {
    expect(parisHour(at("2026-08-29T16:05:00Z"))).toBe(18);
  });

  it("reads 18:00 CET from 17:00 UTC in winter", () => {
    expect(parisHour(at("2026-12-01T17:05:00Z"))).toBe(18);
  });

  // Some ICU builds render local midnight as "24" under `hour12: false`. A stray 24 would
  // make `dueForDailyPost`'s `>=` comparison true for the rest of the night against the
  // wrong Paris day, since `parisDay` has already rolled over.
  it("reads midnight as 0, never 24", () => {
    // 22:05 UTC on the 29th is 00:05 on the 30th in Paris (CEST).
    expect(parisHour(at("2026-08-29T22:05:00Z"))).toBe(0);
  });
});

describe("dueForDailyPost", () => {
  it("is due at the post hour", () => {
    expect(dueForDailyPost(at("2026-08-29T16:05:00Z"), 18)).toBe(true);
  });

  it("is not due before it", () => {
    expect(dueForDailyPost(at("2026-08-29T15:55:00Z"), 18)).toBe(false);
  });

  // The window stays open for the rest of the day so one failed poll does not lose the
  // post; the ledger, not the clock, is what stops it going out twice.
  it("stays due later the same day", () => {
    expect(dueForDailyPost(at("2026-08-29T20:00:00Z"), 18)).toBe(true);
  });

  it("is not due in the small hours of the next Paris day", () => {
    expect(dueForDailyPost(at("2026-08-29T23:00:00Z"), 18)).toBe(false);
  });
});
