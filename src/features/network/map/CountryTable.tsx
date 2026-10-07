import type { NetMap } from "@/domain";
import { Panel } from "@/components/Panel";
import { netPct } from "../net-format";
import { NetBar } from "../NetBar";

export interface CountryTableProps {
  map: NetMap;
  /** Every answering node, the denominator of each share. */
  total: number;
}

const SHOWN = 12;

/**
 * Answering nodes by country, the twelve largest and the rest folded — never dropped, so the
 * rows still sum to the map. A GeoIP country is a database's claim, and the panel says so.
 */
export function CountryTable({ map, total }: CountryTableProps) {
  const rows = map.countries;
  const top = rows.slice(0, SHOWN);
  const rest = rows.slice(SHOWN);
  const max = Math.max(1, ...rows.map((r) => r.count));
  const restCount = rest.reduce((s, r) => s + r.count, 0);
  return (
    <Panel
      title="by country"
      action={<span className="text-xs text-ink-faint">answering nodes · GeoIP-placed</span>}
      className="mt-4"
    >
      <ol className="grid gap-x-7 gap-y-1.5 md:grid-cols-2">
        {top.map((r) => (
          <li key={r.country ?? "unplaced"} className="net-row">
            <span className={`net-row-name ${r.country === null ? "text-ink-faint" : ""}`.trim()}>
              {r.country ?? "unplaced"}
            </span>
            <NetBar share={r.count / max} toneClass="text-green-dim" height={6} />
            <span className="net-row-count">
              {r.count}
              <small> · {netPct(r.count, total)}</small>
            </span>
          </li>
        ))}
        {rest.length > 0 ? (
          <li className="net-row">
            <span className="net-row-name text-ink-faint">
              {rest.length} more {rest.length === 1 ? "country" : "countries"}
            </span>
            <NetBar share={restCount / max} toneClass="text-ink-faint" height={6} />
            <span className="net-row-count">
              {restCount}
              <small> · {netPct(restCount, total)}</small>
            </span>
          </li>
        ) : null}
      </ol>
    </Panel>
  );
}
