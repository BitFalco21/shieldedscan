import { describe, expect, it } from "vitest";
import { isBubbleRoute } from "../bubble-routes";

/**
 * Where the bubble shows. The exceptions are Zeno's own page, the page with its own Zeno, and the
 * screenshotted share cards; a near-miss on a prefix must not hide it.
 */
describe("isBubbleRoute", () => {
  it.each([
    "/",
    "/blocks",
    "/block/2481032",
    `/tx/${"a".repeat(64)}`,
    "/address/t1XWk29dAliceFixtureAddr000001",
    "/shielded",
    "/charts/shielded-supply",
    "/privacy",
    "/learning",
    "/ai-agents",
    "/socialite",
  ])("shows on %s", (path) => {
    expect(isBubbleRoute(path)).toBe(true);
  });

  it.each([
    "/ai-agent",
    "/ai-agent/",
    "/learn",
    "/learn/",
    "/social/card/daily/2026-11-01",
    "/social",
  ])("is absent on %s", (path) => {
    expect(isBubbleRoute(path)).toBe(false);
  });
});
