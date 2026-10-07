import { describe, expect, it } from "vitest";
import { project, unproject } from "../projection";

describe("project", () => {
  it("is the identity in 2D, so the flat view draws the layout itself", () => {
    const p = project(123, -45, { yaw: 0, pitch: 0 });
    expect(p.x).toBeCloseTo(123);
    expect(p.y).toBeCloseTo(-45);
    expect(p.scale).toBe(1);
    expect(p.depth).toBeCloseTo(0);
  });

  it("tilts the top away: a point above the centre recedes and shrinks, one below comes near", () => {
    const top = project(0, -300, { yaw: 0, pitch: 0.9 });
    const bottom = project(0, 300, { yaw: 0, pitch: 0.9 });
    expect(top.depth).toBeGreaterThan(0);
    expect(top.scale).toBeLessThan(1);
    expect(bottom.scale).toBeGreaterThan(1);
    expect(Math.abs(top.y)).toBeLessThan(300);
  });

  it("turns the map about its own centre", () => {
    const p = project(100, 0, { yaw: Math.PI / 2, pitch: 0 });
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(100);
  });

  it("never produces a non-finite coordinate across the tilt range", () => {
    for (let pitch = 0; pitch <= 1.25; pitch += 0.05) {
      const p = project(1400, 900, { yaw: 2.3, pitch });
      for (const v of Object.values(p)) expect(Number.isFinite(v)).toBe(true);
    }
  });
});

describe("unproject", () => {
  it("finds the map point that projects to a screen point, at any orientation and target", () => {
    for (const o of [
      { yaw: 0, pitch: 0 },
      { yaw: 1.1, pitch: 0.9 },
      { yaw: -2.4, pitch: 1.4 },
      // Past edge-on, the map seen from below.
      { yaw: 0.6, pitch: 2.5 },
      { yaw: -1.3, pitch: -2.9 },
      { yaw: 2.0, pitch: -0.8 },
    ]) {
      const p = project(320, -150, o, 40, 60);
      const w = unproject(p.x, p.y, o, 40, 60)!;
      expect(w.x).toBeCloseTo(320, 6);
      expect(w.y).toBeCloseTo(-150, 6);
    }
  });

  it("answers null above the horizon, where no point of the map can appear", () => {
    expect(unproject(0, -1e6, { yaw: 0, pitch: 1.2 })).toBeNull();
    // From below, the horizon is on the other side of the screen.
    expect(unproject(0, 1e6, { yaw: 0, pitch: 2.0 })).toBeNull();
    expect(unproject(0, -1e6, { yaw: 0, pitch: 2.0 })).not.toBeNull();
  });
});
