import {
  NU7,
  NET_UNIDENTIFIED_CLIENT,
  NU7_RELEASES,
  compareVersionsDesc,
  summarizeUpgradeReadiness,
  type ClassifiedRelease,
  type NetReleases,
  type NetworkUpgrade,
  type UpgradeReadiness,
  type UpgradeRelease,
} from "@/domain";
import { ClientMark } from "@/components/ClientMark";
import { MultiLineChart } from "@/components/MultiLineChart";
import { readinessChart } from "./readiness-chart";
import { Panel } from "@/components/Panel";
import { netPct } from "../net-format";
import { clientToneClass, isStripedClient } from "../net-palette";
import { NetBar } from "../NetBar";
import { NetRuleHeading } from "../NetRuleHeading";
import { EmptyState } from "@/components/EmptyState";
import { formatCount } from "@/lib/format";

export interface UpgradePageProps {
  releases: NetReleases;
  /** Injectable so a test can render the "ready" state before any real release carries it. */
  upgrade?: NetworkUpgrade;
  upgradeReleases?: readonly UpgradeRelease[];
}

/**
 * The upgrade tab: whether the nodes the crawler reaches run software that can follow NU7 on
 * mainnet. Every verdict is drawn here, from `domain/network-upgrade.ts`, over the raw groups
 * the API sent — so the release table can grow without an API deploy.
 *
 * The headline is the strict figure (a release that carries the activation height), never the
 * protocol version alone: a node can declare the new protocol version while no release can yet
 * activate NU7 on mainnet.
 */
export function UpgradePage({
  releases,
  upgrade = NU7,
  upgradeReleases = NU7_RELEASES,
}: UpgradePageProps) {
  const s = summarizeUpgradeReadiness(releases.groups, upgrade, "mainnet", upgradeReleases);
  const minProtocol = upgrade.minProtocolVersion.mainnet;
  const height = upgrade.activationHeight.mainnet;
  const carrying = upgradeReleases.filter((r) => r.network === "mainnet");
  const declaring = s.ready.numerator + s.declares.numerator;

  return (
    <div className="grid min-w-0 gap-4">
      <Panel
        title={`${upgrade.name} readiness`}
        action={<span className="text-xs text-ink-faint">mainnet · ZIP {upgrade.zip}</span>}
      >
        <p className="net-found" data-upgrade-headline>
          <b>{formatCount(s.ready.numerator)}</b> of {formatCount(s.answering)} answering nodes run
          a release that can activate {upgrade.name}.
        </p>
        <p className="mt-2 text-sm text-ink-dim">
          {height === null
            ? `None can yet: the mainnet activation height is ${upgrade.heightPending}, and no release can carry it before then.`
            : carrying.length === 0
              ? `The mainnet activation height is ${formatCount(height)}. No release we have read carries it yet.`
              : `The mainnet activation height is ${formatCount(height)}.`}
        </p>
        <div className="net-stats net-stats-4 mt-5">
          <Tile
            label={`declare ${minProtocol}+`}
            value={formatCount(declaring)}
            sub={`${netPct(declaring, s.answering)} · the minimum ZIP ${upgrade.zip} requires`}
          />
          <Tile
            label="older protocol"
            value={formatCount(s.older.numerator)}
            sub={`${netPct(s.older.numerator, s.answering)} · below ${minProtocol}`}
          />
          <Tile
            label="behind our tip"
            value={formatCount(s.behindTip.numerator)}
            sub={`of ${formatCount(s.tipKnown)} · over ${releases.behindTipBlocks} blocks at last answer`}
          />
          <Tile
            label="activation height"
            value={height === null ? "not set" : formatCount(height)}
            sub={height === null ? upgrade.heightPending : "mainnet"}
          />
        </div>
      </Panel>

      {/* The trend first and full width: it is the picture people share, and a half-width
          panel beside a long release list was mostly empty space. */}
      <Panel
        title="day by day"
        action={<span className="text-xs text-ink-faint">share of answering nodes</span>}
      >
        <Trend releases={releases} upgrade={upgrade} upgradeReleases={upgradeReleases} />
      </Panel>
      <Panel
        title="releases"
        action={<span className="text-xs text-ink-faint">what each node declares</span>}
      >
        <ReleaseRows releases={s.releases} answering={s.answering} minProtocol={minProtocol} />
      </Panel>

      <p className="max-w-4xl text-xs leading-relaxed text-ink-faint">
        <b className="font-medium text-ink-dim">How this is decided.</b> A node is ready when it
        declares protocol version {minProtocol} or higher <i>and</i> runs a release whose own notes
        set the mainnet activation height
        {carrying.length === 0
          ? " — none does yet."
          : `: ${carrying.map((r) => `${r.client} ${r.firstVersion}+`).join(", ")}.`}{" "}
        {`The protocol version alone is not readiness: Zakura 1.5.0 and later already declare ${minProtocol} while their notes leave ${upgrade.name} unscheduled on mainnet. Both are what a node says about itself. “Behind” is the one measurement: the height a node declared, against the height our own node had when it answered. `}
        Rules from{" "}
        <a
          href={upgrade.source.href}
          rel="noreferrer"
          target="_blank"
          className="text-ink-dim underline decoration-edge-faint underline-offset-2 hover:text-ink"
        >
          {upgrade.source.title}
        </a>
        , read {upgrade.source.verifiedOn}.
      </p>
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="net-stat">
      <div className="microlabel text-ink-dim">{label}</div>
      <div className="net-figure mt-1.5">{value}</div>
      <div className="mt-1 text-xs text-ink-faint">{sub}</div>
    </div>
  );
}

/**
 * Grouped by state, because that is the question the tab asks; within a state, by client and
 * newest release first. The client's mark and name lead each row, so the row still says whose
 * software it is.
 */
function ReleaseRows({
  releases,
  answering,
  minProtocol,
}: {
  releases: ClassifiedRelease[];
  answering: number;
  minProtocol: number;
}) {
  if (releases.length === 0) {
    return <EmptyState inset>No node answered in the window.</EmptyState>;
  }
  const max = Math.max(1, ...releases.map((r) => r.nodes));
  const sections: Array<{ state: UpgradeReadiness; title: string }> = [
    { state: "ready", title: "ready" },
    { state: "declares", title: `declare ${minProtocol}+, not ready` },
    { state: "older", title: `older protocol` },
    { state: "undeclared", title: "no protocol declared" },
  ];
  return (
    <div className="grid gap-1.5">
      {sections.map(({ state, title }) => {
        const rows = releases
          .filter((r) => r.state === state)
          .sort(
            (a, b) =>
              a.client.localeCompare(b.client) ||
              compareVersionsDesc(a.version ?? "", b.version ?? "") ||
              (b.protocolVersion ?? -1) - (a.protocolVersion ?? -1),
          );
        if (rows.length === 0) return null;
        const nodes = rows.reduce((sum, r) => sum + r.nodes, 0);
        return (
          <div key={state} className="grid gap-1.5" data-release-section={state}>
            <NetRuleHeading>
              <span className={state === "ready" ? "text-green" : undefined}>{title}</span>
              <span className="text-ink-faint tabular-nums">{nodes}</span>
            </NetRuleHeading>
            {rows.map((r) => (
              <div
                key={`${r.client}|${r.version ?? ""}|${r.protocolVersion ?? ""}`}
                className="net-row net-row-release"
                data-release-state={r.state}
              >
                <span className="net-row-name">
                  <ClientMark client={r.client} size={14} />
                  <span
                    className="truncate text-ink"
                    title={
                      r.client === NET_UNIDENTIFIED_CLIENT
                        ? undefined
                        : `${r.client} ${r.version ?? ""}`.trim()
                    }
                  >
                    {r.client === NET_UNIDENTIFIED_CLIENT
                      ? "unidentified"
                      : `${r.client} ${r.version ?? "(no version)"}`}
                  </span>
                </span>
                <span className="text-ink-faint tabular-nums">{r.protocolVersion ?? "—"}</span>
                <NetBar
                  share={r.nodes / max}
                  toneClass={clientToneClass(r.client)}
                  stripe={isStripedClient(r.client)}
                />
                <span className="net-row-count">
                  {r.nodes}
                  <small>
                    {" "}
                    <span className="net-row-pct">· {netPct(r.nodes, answering)}</span>
                    {r.behindTip > 0 ? ` · ${r.behindTip} behind` : ""}
                  </small>
                </span>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function Trend({
  releases,
  upgrade,
  upgradeReleases,
}: {
  releases: NetReleases;
  upgrade: NetworkUpgrade;
  upgradeReleases: readonly UpgradeRelease[];
}) {
  const { days, chart } = readinessChart(releases, upgrade, upgradeReleases);
  const first = days[0];
  if (!first || !chart) {
    return (
      <EmptyState inset>
        {first
          ? `Recording since ${first.day}. The line draws once a second day is recorded.`
          : "The daily record has not started yet. It begins with the crawler's next cycle."}
      </EmptyState>
    );
  }
  return (
    <>
      {/* Two renderings of one chart, by width: the drawing scales its 1000-unit frame to
          the container, so on a phone the regular ticks land near 3px. `phone` draws them large
          enough to survive the downscale, in a taller frame, and is far too large at full
          width, so each width gets its own. `display: none` keeps the hidden one out
          of the accessibility tree, so a reader meets one chart. */}
      <div className="sm:hidden">
        <MultiLineChart {...chart} phone />
      </div>
      <div className="hidden sm:block">
        <MultiLineChart {...chart} />
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-dim">
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-0.5 w-3 bg-green" />
          ready
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-0.5 w-3 bg-green-dim" />
          declare {upgrade.minProtocolVersion.mainnet}+
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-0.5 w-3 bg-series" />
          behind our tip
        </li>
      </ul>
      <p className="mt-2 text-xs text-ink-faint">
        Each day as it stood at the day&apos;s last crawl, since {first.day}. Behind is a share of
        the nodes whose height we could compare.
      </p>
    </>
  );
}
