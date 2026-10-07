import type { NetCrawlHistory } from "@/domain";
import { formatUtcClock, formatWatched } from "./net-format";
import { formatCount } from "@/lib/format";

export interface CrawlSparklineProps {
  history: NetCrawlHistory;
  /** The read's own instant, for "watching for N hours" — never the wall clock. */
  asOf: number;
}

const W = 340;
const H = 80;

/**
 * Nodes answering per crawl cycle, since the crawler started. The height of the last point is
 * the h1's figure. An SVG path, not a canvas — a few hundred points is nothing.
 *
 * A history the route capped is drawn as far as it reaches and says so in its caption; the total
 * is the true count, never the drawn one.
 *
 * No text inside the SVG: it stretches with `preserveAspectRatio="none"`, which distorts any
 * glyph drawn in it. The readout and axis ends are HTML; the SVG draws marks only, with a
 * non-scaling stroke so the stretch cannot thicken the line.
 */
export function CrawlSparkline({ history, asOf }: CrawlSparklineProps) {
  const points = history.crawls;
  const watched =
    history.firstStartedAt === null
      ? null
      : formatWatched(Math.max(0, asOf - history.firstStartedAt));
  const last = points[points.length - 1];
  const caption = [
    `${formatCount(history.total)} ${history.total === 1 ? "crawl" : "crawls"}`,
    watched,
    last ? `last ${formatUtcClock(last.finishedAt)}` : null,
    history.truncated ? `newest ${formatCount(points.length)} drawn` : null,
  ]
    .filter((s): s is string => s !== null)
    .join(" · ");

  if (points.length < 2 || !last) {
    return (
      <div className="net-sparkline-box">
        <div className="microlabel">answered per crawl</div>
        <p className="mt-6 text-sm text-ink-faint">
          {points.length === 0 ? "no finished crawl yet" : "one crawl so far — a line needs two"}
        </p>
      </div>
    );
  }

  const max = Math.max(1, ...points.map((c) => c.reachable));
  const x = (i: number) => 2 + ((W - 4) * i) / (points.length - 1);
  const y = (v: number) => H - 3 - ((H - 10) * v) / max;
  const line = points
    .map((c, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(c.reachable).toFixed(1)}`)
    .join("");
  const area = `${line}L${x(points.length - 1).toFixed(1)} ${H - 3}L${x(0).toFixed(1)} ${H - 3}Z`;

  return (
    <div className="net-sparkline-box">
      <div className="microlabel">answered per crawl</div>
      <p className="mt-2 text-sm text-ink-dim">
        <span className="text-lg text-ink-bright tabular-nums">{last.reachable}</span> answered of{" "}
        <span className="text-ink tabular-nums">{formatCount(last.attempted)}</span> tried on the
        newest crawl
      </p>
      <svg
        className="net-sparkline mt-2"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Nodes answering per crawl cycle since the crawler started: ${last.reachable} answered of ${last.attempted} tried on the newest crawl`}
      >
        <line className="net-spark-base" x1="0" y1={H - 2.5} x2={W} y2={H - 2.5} />
        <path className="net-spark-area" d={area} />
        <path className="net-spark-line" d={line} />
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-ink-faint">
        <span>first crawl</span>
        <span>newest</span>
      </div>
      <div className="microlabel mt-2">{caption}</div>
    </div>
  );
}
