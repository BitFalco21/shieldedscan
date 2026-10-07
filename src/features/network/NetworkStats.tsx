import type { NetPeers, NetSummary } from "@/domain";
import { formatWindow } from "./net-format";
import { formatCount } from "@/lib/format";

export interface NetworkStatsProps {
  summary: NetSummary;
  /** Our own node's peer table, or null when it could not be read. */
  peers: NetPeers | null;
}

interface Tile {
  key: string;
  label: string;
  value: string;
  tag?: string;
  sub: string;
  ours?: boolean;
  /** A value that is not a figure ("not read"), drawn faint. */
  muted?: boolean;
}

/**
 * The five headline figures. Four are the crawl's and one is ours — our own node's peer table,
 * from `getpeerinfo` — and that tile is marked so it is never read as a crawl figure: a crawler
 * counts the network's listening nodes, a node counts who is connected to it, and the second is
 * larger where many nodes sit behind a router.
 *
 * No "answered every crawl" tile: nodes already connected to our own node turn the crawler away
 * (one shared address), so it would measure our setup rather than the network. An unread node
 * prints "not read", never 0 — zero peers is a claim about us.
 */
export function NetworkStats({ summary, peers }: NetworkStatsProps) {
  const tiles: Tile[] = [
    {
      key: "answered",
      label: "answered",
      value: formatCount(summary.reachable),
      tag: "reachable",
      sub: `handshake within ${formatWindow(summary.windowSeconds)}`,
    },
    {
      key: "known",
      label: "addresses known",
      value: formatCount(summary.known),
      sub: `${formatCount(summary.everReachable)} ever answered`,
    },
    {
      key: "countries",
      label: "countries",
      value: formatCount(summary.countries),
      sub: "located by GeoIP",
    },
    {
      key: "asns",
      label: "hosting networks",
      value: formatCount(summary.asns),
      sub: "by autonomous system",
    },
    peers === null
      ? {
          key: "peers",
          label: "peers on our node",
          value: "not read",
          tag: "ours",
          sub: "our own node could not be read just now",
          ours: true,
          muted: true,
        }
      : {
          key: "peers",
          label: "peers on our node",
          value: formatCount(peers.count),
          tag: "ours",
          sub: `${formatCount(peers.inbound)} inbound · from our own node, not the crawl`,
          ours: true,
        },
  ];
  return (
    <section className="net-stats" aria-label="Headline figures">
      {tiles.map((t) => (
        <div
          key={t.key}
          className={`net-stat ${t.ours ? "net-stat-ours" : ""}`.trim()}
          data-basis={t.ours ? "ours" : "floor"}
        >
          <div className="microlabel">{t.label}</div>
          <div className={`net-figure mt-1.5 ${t.muted ? "text-ink-faint" : ""}`.trim()}>
            {t.value}
            {t.tag ? (
              <small className="ml-1.5 text-[13px] font-normal text-ink-faint">{t.tag}</small>
            ) : null}
          </div>
          <div className="mt-1 text-xs text-ink-faint">{t.sub}</div>
        </div>
      ))}
    </section>
  );
}
