import type { NetHealth, NetHistogram, NetPeers } from "@/domain";
import { Panel } from "@/components/Panel";
import { netPct, shortAsnOrg } from "../net-format";
import { NetBar } from "../NetBar";
import { formatCount } from "@/lib/format";

export interface HealthPageProps {
  health: NetHealth;
  /** Our node's peers, for the sentence about nodes behind NAT; null when not read. */
  peers: NetPeers | null;
}

/**
 * The health tab. There is no health score, and the page says so: each figure carries its own
 * denominator, and one number over them would hide every one. Concentration comes first, as the
 * figure a decentralised network is judged on, and it is a floor — grouped by autonomous system,
 * never clustered into operators. Latency is not here: a handshake round trip from one vantage
 * point is a fact about the path from that box, not a judgement on the nodes.
 */
export function HealthPage({ health, peers }: HealthPageProps) {
  return (
    <div className="grid min-w-0 gap-4">
      <div className="grid min-w-0 gap-4 md:grid-cols-2">
        <Panel
          title="where the nodes are hosted"
          action={
            <span className="text-xs text-ink-faint">grouped by network, never by owner</span>
          }
        >
          <AsnConcentration health={health} />
        </Panel>
        <Panel
          title="what we cannot see"
          action={<span className="text-xs text-ink-faint">said plainly</span>}
        >
          <CannotSeeFacts health={health} peers={peers} />
        </Panel>
      </div>
      <div className="grid min-w-0 gap-4">
        <Panel
          title="answered our crawls"
          action={
            <span className="text-xs text-ink-faint">
              {health.uptime.denominator} nodes · {formatCount(health.facts.crawls)} crawls
            </span>
          }
        >
          <Histogram
            histogram={health.uptime}
            highlight={health.uptime.buckets.length - 1}
            label="Nodes by the share of our crawls they answered"
          />
          <p className="mt-3.5 text-xs text-ink-faint">
            Share of our crawls a node answered since we first saw it; the count above each bar is
            nodes. Nodes already connected to our own node turn our crawler away, because the two
            share an address, so most nodes score low here without being down.
          </p>
        </Panel>
      </div>
    </div>
  );
}

function AsnConcentration({ health }: { health: NetHealth }) {
  const rows = health.concentration.topAsns;
  const max = Math.max(1, ...rows.map((r) => r.numerator));
  const top3 = health.concentration.top3;
  return (
    <>
      <ol className="net-rows">
        {rows.map((r) => (
          <li key={`${r.asn}|${r.org}`} className="net-row net-row-wide">
            <span className="net-row-name" title={r.org}>
              <span className="truncate">{shortAsnOrg(r.org)}</span>
            </span>
            <NetBar share={r.numerator / max} toneClass="text-green-dim" />
            <span className="net-row-count">
              {r.numerator}
              <small> · {netPct(r.numerator, r.denominator)}</small>
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-3.5 text-xs text-ink-faint">
        {rows.length >= 3 ? (
          <>
            Three networks host {top3.numerator} of {top3.denominator} answering nodes (
            {netPct(top3.numerator, top3.denominator)}).{" "}
          </>
        ) : null}
        Grouped by autonomous system; two networks are never merged into one operator, so the real
        concentration can only be higher.
      </p>
    </>
  );
}

function CannotSeeFacts({ health, peers }: { health: NetHealth; peers: NetPeers | null }) {
  const f = health.facts;
  const timeouts = f.failures.find((x) => x.failure === "timeout")?.count ?? 0;
  const subnets = health.clusteredSubnets;
  return (
    <ul className="grid gap-2.5 text-[13px] text-ink-dim">
      <li>
        <b className="font-normal text-ink-bright">{formatCount(f.neverAnswered)}</b> advertised
        addresses have never answered a handshake
        {timeouts > 0 ? <>; {formatCount(timeouts)} timed out on the last attempt</> : null}
        {f.torKnown > 0 ? (
          <>
            , and {formatCount(f.torKnown)} are Tor exits or onion addresses, which forward no
            inbound connection
          </>
        ) : null}
        .
      </li>
      <li>
        <b className="font-normal text-ink-bright">{formatCount(f.ipv6Known)}</b> IPv6 addresses are
        known
        {f.ipv6Reachable === 0 ? (
          <>
            {" "}
            and none has answered: our vantage point has no IPv6 route yet, so IPv6 nodes are
            missing from every figure on this page.
          </>
        ) : (
          <> and {formatCount(f.ipv6Reachable)} answered.</>
        )}
      </li>
      <li>
        {subnets.length === 0 ? (
          <>
            <b className="font-normal text-ink-bright">No two</b> answering nodes share a /24
            subnet. When some do, they are listed here as <span className="text-ink">a.b.c.x</span>{" "}
            groups, never as addresses.
          </>
        ) : (
          <>
            <b className="font-normal text-ink-bright">
              {subnets.length} {subnets.length === 1 ? "subnet holds" : "subnets hold"}
            </b>{" "}
            more than one answering node:{" "}
            {subnets.map((s, i) => (
              <span key={s.subnet}>
                {i > 0 ? ", " : ""}
                <span className="text-ink tabular-nums">{s.subnet}</span> ({s.count})
              </span>
            ))}
            . A /24 label, never an address.
          </>
        )}
      </li>
      <li>
        <b className="font-normal text-ink-bright">Nodes behind NAT</b> accept no inbound connection
        and cannot be crawled.
        {peers ? (
          <>
            {" "}
            Our own node currently holds{" "}
            <b className="font-normal text-ink-bright">{formatCount(peers.count)}</b> peers,{" "}
            {formatCount(peers.inbound)} of them inbound — our node alone reaches more nodes than
            our crawl can count.
          </>
        ) : null}
      </li>
      <li>
        <b className="font-normal text-ink-bright">No health score.</b> Each figure here carries its
        own denominator; a single number would hide them.
      </li>
    </ul>
  );
}

/**
 * Bars anchored to the floor of a fixed-height SVG, heights as percentages of the tallest
 * bucket — SVG attributes, never a style. The highlighted bucket is the one a reader hopes to
 * see full; an empty bucket is drawn faint rather than omitted, so the axis keeps every step.
 */
function Histogram({
  histogram,
  highlight,
  label,
}: {
  histogram: NetHistogram;
  highlight: number;
  label: string;
}) {
  const n = histogram.buckets.length;
  const max = Math.max(1, ...histogram.buckets.map((b) => b.count));
  const slot = 100 / n;
  return (
    <>
      <svg
        className="net-hist block w-full"
        width="100%"
        height="140"
        role="img"
        aria-label={`${label}: ${histogram.buckets.map((b) => `${b.label} ${b.count}`).join(", ")}`}
      >
        {histogram.buckets.map((b, i) => {
          const h = Math.max(1.5, (85 * b.count) / max);
          return (
            <g key={b.label}>
              <rect
                className={`${i === highlight ? "is-hi" : ""} ${b.count === 0 ? "is-zero" : ""}`.trim()}
                x={`${(i * slot + slot * 0.08).toFixed(2)}%`}
                y={`${(100 - h).toFixed(2)}%`}
                width={`${(slot * 0.84).toFixed(2)}%`}
                height={`${h.toFixed(2)}%`}
              />
              <text
                x={`${(i * slot + slot / 2).toFixed(2)}%`}
                y={`${Math.max(9, 100 - h - 5).toFixed(2)}%`}
              >
                {b.count}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="net-histx">
        {histogram.buckets.map((b) => (
          <div key={b.label}>{b.label}</div>
        ))}
      </div>
    </>
  );
}
