import type { NetCrawlHistory, NetSummary } from "@/domain";
import { CrawlSparkline } from "./CrawlSparkline";
import { formatWindow } from "./net-format";
import { formatCount } from "@/lib/format";

export interface NetworkHeaderProps {
  summary: NetSummary;
  crawls: NetCrawlHistory;
}

/**
 * The page's one sentence and its one chart. The figure in the h1 is the crawl's answering count
 * — a floor, and the lede says why in the same breath rather than in a footnote.
 *
 * Its own layout rather than `PageHeader`, because the crawl sparkline sits beside the
 * statement; the spacing and lede width match `PageHeader`'s.
 */
export function NetworkHeader({ summary, crawls }: NetworkHeaderProps) {
  return (
    <header className="grid items-end gap-8 pt-8 pb-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div>
        <div className="microlabel">network · listening nodes</div>
        <h1 className="net-h1 mt-1">
          <b className="tabular-nums">{formatCount(summary.reachable)}</b> nodes answered our
          handshake in the last {formatWindow(summary.windowSeconds)}.
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-dim">
          Out of {formatCount(summary.known)} addresses the network has ever advertised to us. We
          can only count nodes that accept connections: a node behind a router is invisible to any
          crawler, so the real network is bigger.
        </p>
      </div>
      <CrawlSparkline history={crawls} asOf={summary.asOf} />
    </header>
  );
}
