import type { NetTopology } from "@/domain";
import { SkyCanvas } from "./SkyCanvas";

export interface TopologyPageProps {
  /** The hubs-only graph; the sky fetches the never-answered addresses after mount. */
  hubs: NetTopology;
}

/**
 * The topology tab: the gossip graph as a sky. One sentence of framing above it, because the
 * picture invites the wrong reading — a line here is an advertisement ("this node told us
 * about that address"), never a connection, and the crawl cannot see connections at all.
 */
export function TopologyPage({ hubs }: TopologyPageProps) {
  return (
    <div className="grid min-w-0 gap-3.5">
      <p className="text-sm text-ink-dim">
        Who told us about whom. Hubs are the nodes that answered our handshake; the dim points are
        addresses they advertised that are not answering. Every line is an advertisement, never a
        live connection.
      </p>
      <SkyCanvas hubs={hubs} />
    </div>
  );
}
