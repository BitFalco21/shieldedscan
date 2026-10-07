import type { NetSummary } from "@/domain";
import { compareVersionsDesc } from "@/domain";
import { ClientMark } from "@/components/ClientMark";
import { Panel } from "@/components/Panel";
import { netPct } from "../net-format";
import { clientToneClass, isStripedClient } from "../net-palette";
import { NetBar, NetBarFill } from "../NetBar";
import { NetRuleHeading } from "../NetRuleHeading";
import { Badge } from "@/components/Badge";
import { EmptyState } from "@/components/EmptyState";
import { formatCount } from "@/lib/format";

export interface SoftwarePageProps {
  summary: NetSummary;
}

/**
 * The software tab: which implementations the answering nodes run, which releases are out there
 * and which protocol version the handshake declared.
 *
 * There is deliberately no per-client "answers our crawls" comparison: it would read as node
 * quality while measuring our setup — the crawler shares an address with our own node, and
 * Zebra-family nodes accept one connection per address, so a node already connected to ours
 * turns the crawler away. Everything here is what a node said about itself in its `version`
 * message, and the tab says so: a user agent is not verified.
 */
export function SoftwarePage({ summary }: SoftwarePageProps) {
  const total = summary.reachable;
  return (
    <div className="grid min-w-0 gap-4">
      <Panel
        title="software answering right now"
        action={<span className="text-xs text-ink-faint">{formatCount(total)} nodes</span>}
      >
        <ClientStack summary={summary} />
      </Panel>
      <div className="grid min-w-0 gap-4 md:grid-cols-2">
        <Panel
          title="releases"
          action={<span className="text-xs text-ink-faint">self-reported user agents</span>}
        >
          <ReleaseLadder summary={summary} />
          <p className="mt-3.5 text-xs text-ink-faint">
            A user agent is what a node says about itself. It is not verified and can be anything.
          </p>
        </Panel>
        <Panel
          title="protocol version"
          action={<span className="text-xs text-ink-faint">what the handshake declares</span>}
        >
          <ProtocolVersions summary={summary} />
        </Panel>
      </div>
    </div>
  );
}

/** The software stack's height in px. */
const STACK_HEIGHT = 26;

/** One row of shares, widest first, each an SVG whose width attribute is the share. */
function ClientStack({ summary }: { summary: NetSummary }) {
  const total = summary.reachable;
  return (
    <>
      <div className="net-stack" role="img" aria-label={stackLabel(summary)}>
        {summary.clients.map((c) => (
          <svg
            key={c.client}
            className={clientToneClass(c.client)}
            width={`${Math.max(0.5, (100 * c.numerator) / total).toFixed(2)}%`}
            height={STACK_HEIGHT}
            focusable="false"
          >
            <NetBarFill stripe={isStripedClient(c.client)} height={STACK_HEIGHT} />
          </svg>
        ))}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs">
        {summary.clients.map((c) => (
          <li key={c.client} className="flex items-center gap-2">
            <ClientMark client={c.client} size={16} />
            <b className="font-normal text-ink-bright">{c.client}</b>
            <span className="tabular-nums">{c.numerator}</span>
            <span className="text-ink-faint tabular-nums">· {netPct(c.numerator, total)}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

function stackLabel(summary: NetSummary): string {
  return `Software share of ${summary.reachable} answering nodes: ${summary.clients
    .map((c) => `${c.client} ${c.numerator}`)
    .join(", ")}`;
}

/** Versions per client, newest first, the newest seen tagged; nodes with no version are counted by name. */
function ReleaseLadder({ summary }: { summary: NetSummary }) {
  const total = summary.reachable;
  const max = Math.max(1, ...summary.versions.map((v) => v.count));
  const groups = summary.clients.map((c) => ({
    client: c.client,
    versions: summary.versions
      .filter((v) => v.client === c.client)
      .sort((a, b) => compareVersionsDesc(a.version, b.version)),
    withVersion: summary.versions
      .filter((v) => v.client === c.client)
      .reduce((s, v) => s + v.count, 0),
    nodes: c.numerator,
  }));
  return (
    <div className="grid gap-1.5">
      {groups.map((g) => (
        <div key={g.client} className="grid gap-1.5">
          <NetRuleHeading>
            <ClientMark client={g.client} size={16} />
            {g.client}
          </NetRuleHeading>
          {g.versions.length === 0 ? (
            <p className="text-xs text-ink-faint">
              {g.nodes} {g.nodes === 1 ? "node declares" : "nodes declare"} no version
            </p>
          ) : null}
          {/* The wide name column, like the protocol rows: at 9rem the "newest seen" badge
              truncated the version itself. Every row of a group takes it, so the bars still
              start on one line. */}
          {g.versions.map((v, i) => (
            <div key={v.version} className="net-row net-row-wide">
              <span className={`net-row-name ${i === 0 ? "text-ink" : ""}`.trim()}>
                <span className="truncate">{v.version}</span>
                {i === 0 ? <Badge tone="accent">newest seen</Badge> : null}
              </span>
              <NetBar
                share={v.count / max}
                toneClass={clientToneClass(g.client)}
                stripe={isStripedClient(g.client)}
              />
              <span className="net-row-count">
                {v.count}
                <small> · {netPct(v.count, total)}</small>
              </span>
            </div>
          ))}
          {g.versions.length > 0 && g.withVersion < g.nodes ? (
            <p className="text-xs text-ink-faint">
              {g.nodes - g.withVersion} more{" "}
              {g.nodes - g.withVersion === 1 ? "declares" : "declare"} no version
            </p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/**
 * Declared protocol versions, newest first. The newest declared is tagged, never a version this
 * page believes to be current: a declared version is a claim about the software, not a
 * measurement of which chain the node follows, and naming the consensus version here would
 * be a hardcoded fact that goes stale at the next upgrade.
 */
function ProtocolVersions({ summary }: { summary: NetSummary }) {
  const total = summary.reachable;
  const rows = [...summary.protocolVersions].sort((a, b) => b.protocolVersion - a.protocolVersion);
  const newest = rows[0];
  const declared = rows.reduce((s, r) => s + r.count, 0);
  const max = Math.max(1, ...rows.map((r) => r.count));
  if (!newest) {
    return <EmptyState inset>No answering node declared a protocol version.</EmptyState>;
  }
  const older = declared - newest.count;
  return (
    <>
      <ol className="net-rows mt-1">
        {rows.map((r, i) => (
          <li key={r.protocolVersion} className="net-row net-row-wide">
            <span className={`net-row-name ${i === 0 ? "text-ink" : ""}`.trim()}>
              <span className="tabular-nums">{r.protocolVersion}</span>
              {i === 0 ? <Badge tone="accent">newest declared</Badge> : null}
            </span>
            <NetBar share={r.count / max} toneClass={i === 0 ? "text-green" : "text-green-dim"} />
            <span className="net-row-count">
              {r.count}
              <small> · {netPct(r.count, total)}</small>
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-3.5 text-xs text-ink-faint">
        {older} of {declared} declaring nodes announce a protocol version below the newest we have
        seen{total > declared ? `; ${total - declared} declare none` : ""}. A declared version is a
        claim about the software, not a measurement of which chain it follows.
      </p>
    </>
  );
}
