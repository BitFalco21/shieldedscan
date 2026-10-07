import { createHash } from "node:crypto";

/**
 * A stable, non-reversible id for a node, so the topology is drawable and a list row is
 * addressable without publishing an address. Salted with the graph's own subject so it
 * cannot be joined against anything else, and truncated — a graph needs only that two ids
 * differ. Twelve hex characters over ~2,000 nodes leaves collisions at ~1e-8.
 */
export function anonId(host: string, port: number): string {
  return createHash("sha256").update(`netmap:${host}:${port}`).digest("hex").slice(0, 12);
}

/** A public /24 cluster label — the derived form of an IPv4 (`192.42.116.x`). Never the host. */
export function subnet24(host: string): string | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  return `${parts[0]}.${parts[1]}.${parts[2]}.x`;
}
