import type { NetTopology } from "@/domain";
import { ClientMark } from "@/components/ClientMark";
import { netPct, shortAsnOrg } from "../net-format";
import type { SkyFocus } from "./sky-draw";
import { formatCount } from "@/lib/format";

export interface TopologyReadoutProps {
  topology: NetTopology;
  focus: SkyFocus;
  pinned: boolean;
  /** Pins a hub from the list — the keyboard's way into the sky. */
  onPinHub: (index: number) => void;
}

const MOST_ADVERTISED = 8;

/**
 * The fixed panel beside the sky, and the part of the tab that works with no canvas at all:
 * the counts, the most-advertised list as buttons that pin a hub, and the facts of whatever is
 * focused. Server-rendered with the hubs, so a reader without JavaScript still gets every
 * figure the sky is drawn from.
 */
export function TopologyReadout({ topology, focus, pinned, onPinHub }: TopologyReadoutProps) {
  return (
    <aside className="net-readout text-sm" role="status" aria-live="polite">
      {focus === null ? (
        <Overview topology={topology} onPinHub={onPinHub} />
      ) : focus.kind === "hub" ? (
        <HubFacts topology={topology} index={focus.index} pinned={pinned} />
      ) : (
        <GhostFacts topology={topology} index={focus.index} pinned={pinned} />
      )}
    </aside>
  );
}

function Overview({
  topology,
  onPinHub,
}: {
  topology: NetTopology;
  onPinHub: (i: number) => void;
}) {
  const top = topology.hubs
    .map((h, i) => ({ h, i }))
    .sort((a, b) => b.h.inDeg - a.h.inDeg || a.h.id.localeCompare(b.h.id))
    .slice(0, MOST_ADVERTISED);
  return (
    <>
      <div className="microlabel">gossip · who told us about whom</div>
      <dl className="net-kv">
        <dt>nodes drawn</dt>
        <dd>{topology.hubs.length}</dd>
        <dt>advertisements between them</dt>
        <dd>{formatCount(topology.hubEdges.length)}</dd>
        <dt>advertisements, all addresses</dt>
        <dd>{formatCount(topology.edgesTotal)}</dd>
      </dl>
      <div>
        <div className="microlabel mb-2">most advertised</div>
        <ol className="grid gap-1.5 text-xs">
          {top.map(({ h, i }) => (
            <li key={h.id}>
              <button
                type="button"
                onClick={() => onPinHub(i)}
                className="grid w-full cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5 text-left hover:text-ink"
                aria-label={`Pin ${h.client} node ${h.id}, advertised by ${h.inDeg} peers`}
              >
                <span className="font-mono text-ink-faint tabular-nums">{h.id}</span>
                <span className="flex min-w-0 items-center gap-1.5 text-ink-dim">
                  <ClientMark client={h.client} size={12} />
                  <span className="truncate">
                    {h.client}
                    {h.country ? ` · ${h.country}` : ""}
                  </span>
                </span>
                <span className="text-ink tabular-nums">{h.inDeg}</span>
              </button>
            </li>
          ))}
        </ol>
      </div>
      <p className="mt-auto text-[11.5px] text-ink-faint">
        Ids are one-way hashes; the shape is drawable, the addresses are not. An address many peers
        advertise is well known, not necessarily well connected.
      </p>
    </>
  );
}

function HubFacts({
  topology,
  index,
  pinned,
}: {
  topology: NetTopology;
  index: number;
  pinned: boolean;
}) {
  const hub = topology.hubs[index];
  if (!hub) return null;
  const ghosts = topology.ghosts;
  const shared = ghosts ? ghosts.filter((g) => g.by.includes(index)).length : null;
  const answeredOut = topology.hubEdges.filter(([a]) => a === index).length;
  return (
    <>
      <div>
        <div className="microlabel">node</div>
        <h3 className="mt-0.5 flex items-center gap-2 text-[15px] font-normal text-ink-bright">
          <ClientMark client={hub.client} size={16} />
          <span className="font-mono tabular-nums">{hub.id}</span>
        </h3>
      </div>
      <dl className="net-kv">
        <dt>software</dt>
        <dd>
          {hub.client}
          {hub.version ? ` ${hub.version}` : ""}
        </dd>
        <dt>placed in</dt>
        <dd>{hub.country ?? "—"}</dd>
        <dt>hosted on</dt>
        <dd className="whitespace-normal" title={hub.asnOrg ?? undefined}>
          {shortAsnOrg(hub.asnOrg)}
        </dd>
        <dt>
          <span className="net-sw mr-1.5 inline-block align-middle text-green" /> advertised
        </dt>
        <dd>{formatCount(hub.outDeg)} addresses</dd>
        <dt>
          <span className="net-sw net-asn-1 mr-1.5 inline-block align-middle" /> advertised by
        </dt>
        <dd>{hub.inDeg} peers</dd>
        {shared !== null ? (
          <>
            <dt>of which not answering</dt>
            <dd>{formatCount(shared)}</dd>
            <dt>of which answered</dt>
            <dd>
              {answeredOut} · {netPct(answeredOut, hub.outDeg)}
            </dd>
          </>
        ) : null}
      </dl>
      <p className="mt-auto text-[11.5px] text-ink-faint">
        A one-way hash, not an address.{pinned ? " Esc or click again to release." : ""}
      </p>
    </>
  );
}

function GhostFacts({
  topology,
  index,
  pinned,
}: {
  topology: NetTopology;
  index: number;
  pinned: boolean;
}) {
  const g = topology.ghosts?.[index];
  if (!g) return null;
  const failure: Record<string, string> = {
    timeout: "every attempt timed out",
    refused: "refused the connection",
    unreachable: "no route to it from our crawler",
    closed: "accepted, then closed before the handshake",
    reset: "dropped mid-handshake",
    other: "failed in another way",
  };
  return (
    <>
      <div>
        <div className="microlabel">advertised address</div>
        <h3 className="mt-0.5 font-mono text-[15px] font-normal text-ink-bright tabular-nums">
          {g.id}
        </h3>
      </div>
      <dl className="net-kv">
        <dt>network</dt>
        <dd>
          {g.torExit
            ? "Tor exit relay"
            : g.network === "ipv6"
              ? "IPv6 · not tried yet"
              : g.network === "torv3"
                ? "onion · not reachable from here"
                : "IPv4"}
        </dd>
        <dt>placed in</dt>
        <dd>{g.country ?? "—"}</dd>
        <dt>advertised by</dt>
        <dd>
          {g.by.length} {g.by.length === 1 ? "peer" : "peers"}
        </dd>
        <dt>last attempt</dt>
        <dd className="whitespace-normal">
          {g.failure === null ? "never dialled" : failure[g.failure]}
        </dd>
      </dl>
      <p className="mt-auto text-[11.5px] text-ink-faint">
        An address the network remembers. Behind a router, switched off, or a relay that forwards
        nothing inbound — the crawl cannot tell which.
        {pinned ? " Esc or click again to release." : ""}
      </p>
    </>
  );
}
