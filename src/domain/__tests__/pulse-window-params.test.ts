import { describe, expect, it } from "vitest";
import { parsePulseWindowParams, PULSE_REPLAY_SECONDS, PULSE_WINDOW_SECONDS } from "../pulse-wire";

/**
 * The replay window's parameters, shared by `/chain/pulse/window` and `/api/pulse/window` so
 * both refuse the same set.
 */

const NOW = 1_800_000_000;
/** `NOW` is not on an hour boundary; this is the last aligned hour that has fully begun. */
const ALIGNED = Math.floor(NOW / PULSE_WINDOW_SECONDS) * PULSE_WINDOW_SECONDS;

describe("parsePulseWindowParams", () => {
  it("accepts one aligned hour", () => {
    expect(parsePulseWindowParams(String(ALIGNED - 3_600), String(ALIGNED), NOW)).toEqual({
      fromSeconds: ALIGNED - 3_600,
      toSeconds: ALIGNED,
    });
  });

  it("refuses an empty parameter rather than reading it as the first hour of 1970", () => {
    // `Number("")` is 0, so a lenient parse would accept this as a real window.
    expect(parsePulseWindowParams("", "3600", NOW)).toBeNull();
  });

  it("refuses an unaligned hour, which would let two requests overlap", () => {
    expect(parsePulseWindowParams(String(ALIGNED + 60), String(ALIGNED + 3_660), NOW)).toBeNull();
  });

  it("refuses a span that is not exactly an hour", () => {
    expect(parsePulseWindowParams(String(ALIGNED - 7_200), String(ALIGNED), NOW)).toBeNull();
  });

  it("allows an hour of clock slack and refuses more", () => {
    // Measured from an exact hour boundary so the edge itself is what is asserted.
    const onTheHour = ALIGNED;
    expect(
      parsePulseWindowParams(String(onTheHour), String(onTheHour + 3_600), onTheHour),
    ).not.toBeNull();
    expect(
      parsePulseWindowParams(String(onTheHour + 3_600), String(onTheHour + 7_200), onTheHour),
    ).toBeNull();
  });

  it("refuses an hour older than the replay reaches", () => {
    // The floor is one hour below the horizon, because the oldest hour the transport offers
    // begins up to an hour before it.
    const horizon = ALIGNED - PULSE_REPLAY_SECONDS;
    expect(
      parsePulseWindowParams(String(horizon), String(horizon + 3_600), ALIGNED),
    ).not.toBeNull();
    expect(
      parsePulseWindowParams(String(horizon - 3_600), String(horizon), ALIGNED),
    ).not.toBeNull();
    expect(
      parsePulseWindowParams(String(horizon - 7_200), String(horizon - 3_600), ALIGNED),
    ).toBeNull();
  });
});
