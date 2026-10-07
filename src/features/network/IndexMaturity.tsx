import type { NetCrawlHistory } from "@/domain";
import { indexMaturity } from "@/domain";
import { formatSharePct } from "@/lib/format";
import { formatWatched } from "./net-format";
import { Badge } from "@/components/Badge";

export interface IndexMaturityProps {
  history: NetCrawlHistory;
  known: number;
  /** The read's own instant — never the wall clock, which would differ between server and client. */
  nowSeconds: number;
}

/**
 * How far discovery is from settling. A crawler's first days find addresses faster than the
 * network changes, so every count is still climbing; the strip says so until the index has been
 * watched for seven days and adds under a tenth of itself a day — the convergence rule
 * `indexMaturity` encodes.
 *
 * The track is an SVG `width` attribute, the site's escape for runtime geometry.
 */
export function IndexMaturity({ history, known, nowSeconds }: IndexMaturityProps) {
  const m = indexMaturity(history, known, nowSeconds);
  const watched = formatWatched(m.daysWatched * 86_400);
  const progress = Math.min(100, (100 * m.daysWatched) / m.dayGoal);
  const day = Math.min(m.dayGoal, Math.floor(m.daysWatched) + 1);
  const share =
    m.newPerDayShare === null
      ? null
      : formatSharePct(m.newPerDayShare.pct, m.newPerDayShare.pct < 10 ? 1 : 0);

  return (
    <div
      className="panel grid items-center gap-x-4 gap-y-2 px-4 py-3 sm:grid-cols-[auto_1fr_auto]"
      role="status"
      data-settled={m.settled ? "true" : "false"}
    >
      {/* The site's one pill (`Badge`): the warning role while the index is still climbing, the
          accent a step back once it has settled. */}
      <span className="inline-flex">
        <Badge tone={m.settled ? "dim" : "warn"}>
          {m.settled ? "index settled" : "index maturing"}
        </Badge>
      </span>
      <div className="min-w-0">
        <p className="mb-1.5 flex flex-wrap justify-between gap-x-4 text-xs text-ink-dim">
          <span>
            Watching for <b className="font-normal text-ink">{watched}</b>
            {share === null ? (
              <> · too few crawls in the last day to measure discovery</>
            ) : m.settled ? (
              <>
                {" "}
                · <b className="font-normal text-ink">{share}</b> of the known set new per day
              </>
            ) : (
              <>
                {" "}
                · still finding <b className="font-normal text-ink">{share}</b> of the known set per
                day
              </>
            )}
          </span>
          <span className="text-ink-faint">
            settles at {m.dayGoal} days and under 10% new a day
          </span>
        </p>
        <svg
          className="net-track net-track-thin w-full"
          width="100%"
          height="4"
          aria-hidden
          focusable="false"
        >
          <rect className="fill-green-dim" width={`${progress.toFixed(1)}%`} height="4" />
        </svg>
      </div>
      <span className="text-right text-xs whitespace-nowrap text-ink-faint tabular-nums">
        {m.settled ? `${Math.floor(m.daysWatched)} days watched` : `day ${day} of ${m.dayGoal}`}
      </span>
    </div>
  );
}
