import type { NetTopology } from "@/domain";

/**
 * The sky's geometry: the whole known network in three dimensions.
 *
 * Answering nodes are hubs, settled by a force layout over the advertisements between them.
 * Every address that never answered hangs off the hubs that advertised it, pushed outward —
 * so one hub's advertisements read as rays from it, and an address many hubs know sits near
 * the middle. Nothing here is a connection: every line the sky draws means "told us about".
 *
 * Pure and deterministic: the same payload yields the same picture on every screen and every
 * visit, so a reader can point at a hub and find it again. Randomness comes from a hash of each
 * id, never from `Math.random`, and the layout settles once — nothing animates on its own.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface SkyLayout {
  /** One per `topology.hubs`, inside a sphere of radius `HUB_RADIUS`. */
  hubs: Vec3[];
  /** One per `topology.ghosts` (empty when the payload carries none). */
  ghosts: Vec3[];
}

/** The hubs' sphere; ghosts reach past it, out to about 1.5. */
export const HUB_RADIUS = 0.42;
const ITERATIONS = 700;
const LINK_LENGTH = 120;

/** FNV-1a of `str` salted, folded to [0, 1). The sky's only source of variation. */
export function hash01(str: string, salt: number): number {
  let h = (2166136261 ^ salt) >>> 0;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h % 10000) / 10000;
}

export function layoutSky(topology: NetTopology): SkyLayout {
  const n = topology.hubs.length;
  const P = topology.hubs.map((h, i) => {
    const t = 2.4 * i;
    const u = hash01(h.id, 7) * 2 - 1;
    const r = 60 + 4 * i;
    return { x: Math.cos(t) * r, y: Math.sin(t) * r, z: u * r * 0.7, vx: 0, vy: 0, vz: 0 };
  });
  const edges = topology.hubEdges.filter(([a, b]) => a < n && b < n && a !== b);
  for (let it = 0; it < ITERATIONS; it += 1) {
    const T = 1 - it / ITERATIONS;
    const step = 0.9 * T * T + 0.02;
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        let dx = P[j]!.x - P[i]!.x;
        let dy = P[j]!.y - P[i]!.y;
        let dz = P[j]!.z - P[i]!.z;
        const d = Math.hypot(dx, dy, dz) || 0.1;
        const f = (LINK_LENGTH * LINK_LENGTH * 1.4) / (d * d);
        dx /= d;
        dy /= d;
        dz /= d;
        P[i]!.vx -= dx * f;
        P[i]!.vy -= dy * f;
        P[i]!.vz -= dz * f;
        P[j]!.vx += dx * f;
        P[j]!.vy += dy * f;
        P[j]!.vz += dz * f;
        if (d < 40) {
          const push = (40 - d) * 0.5;
          P[i]!.vx -= dx * push;
          P[i]!.vy -= dy * push;
          P[i]!.vz -= dz * push;
          P[j]!.vx += dx * push;
          P[j]!.vy += dy * push;
          P[j]!.vz += dz * push;
        }
      }
    }
    for (const [a, b] of edges) {
      const dx = P[b]!.x - P[a]!.x;
      const dy = P[b]!.y - P[a]!.y;
      const dz = P[b]!.z - P[a]!.z;
      const d = Math.hypot(dx, dy, dz) || 0.1;
      const f = (d - LINK_LENGTH) * 0.0025;
      P[a]!.vx += dx * f;
      P[a]!.vy += dy * f;
      P[a]!.vz += dz * f;
      P[b]!.vx -= dx * f;
      P[b]!.vy -= dy * f;
      P[b]!.vz -= dz * f;
    }
    for (const p of P) {
      p.vx -= p.x * 0.004;
      p.vy -= p.y * 0.004;
      p.vz -= p.z * 0.004;
      p.x += clamp25(p.vx * step);
      p.y += clamp25(p.vy * step);
      p.z += clamp25(p.vz * step);
      p.vx *= 0.35;
      p.vy *= 0.35;
      p.vz *= 0.35;
    }
  }
  const m = Math.max(1e-9, ...P.map((p) => Math.hypot(p.x, p.y, p.z)));
  const hubs: Vec3[] = P.map((p) => ({
    x: (p.x / m) * HUB_RADIUS,
    y: (p.y / m) * HUB_RADIUS,
    z: (p.z / m) * HUB_RADIUS,
  }));

  const ghosts: Vec3[] = (topology.ghosts ?? []).map((g) => {
    const advertisers = g.by.filter((i) => i < n);
    if (advertisers.length === 0) {
      // Advertised by nobody the payload carries: on the sphere, by its hash alone.
      const [dx, dy, dz] = hashedDirection(g.id);
      return { x: dx * 1.2, y: dy * 1.2, z: dz * 1.2 };
    }
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (const i of advertisers) {
      cx += hubs[i]!.x;
      cy += hubs[i]!.y;
      cz += hubs[i]!.z;
    }
    cx /= advertisers.length;
    cy /= advertisers.length;
    cz /= advertisers.length;
    const len = Math.hypot(cx, cy, cz) || 0.001;
    const dir = [cx / len, cy / len, cz / len];
    // 0 = one hub knows it (a ray from that hub), → 1 = everyone does (the middle).
    const known = 1 - Math.exp(-advertisers.length / 5);
    const reach = 0.36 + (1 - known) * (0.5 + hash01(g.id, 1) * 0.6);
    const rnd = hashedDirection(g.id);
    const cone = 0.25 * (1 - known);
    const d = [0, 1, 2].map((k) => dir[k]! * (1 - known) + rnd[k]! * (known + cone));
    const dl = Math.hypot(d[0]!, d[1]!, d[2]!) || 1;
    return {
      x: cx * 0.25 + (d[0]! / dl) * reach,
      y: cy * 0.25 + (d[1]! / dl) * reach,
      z: cz * 0.25 + (d[2]! / dl) * reach,
    };
  });

  return { hubs, ghosts };
}

function clamp25(v: number): number {
  return Math.max(-25, Math.min(25, v));
}

/** A unit vector on the sphere chosen by the id's hash — the same one every time. */
function hashedDirection(id: string): [number, number, number] {
  const th = hash01(id, 3) * Math.PI * 2;
  const ph = Math.acos(2 * hash01(id, 5) - 1);
  return [Math.sin(ph) * Math.cos(th), Math.sin(ph) * Math.sin(th), Math.cos(ph)];
}
