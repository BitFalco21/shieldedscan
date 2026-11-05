import { NU7_HEIGHT } from "@/domain";
import { formatCount } from "@/lib/format";
import { NU7_CHANGES, formatZecShort } from "./nu7-countdown";

export interface Nu7ChangesProps {
  /** After activation the new values are the current ones, and the old ones become "was". */
  active: boolean;
}

/**
 * What the activation block changes, from the protocol schedule: the block target and the
 * miner's subsidy per block. Issuance per hour is unchanged, which is the one-line takeaway.
 */
export function Nu7Changes({ active }: Nu7ChangesProps) {
  const { spacingBefore, spacingAfter, minerBeforeZat, minerAfterZat } = NU7_CHANGES;
  const rows = [
    { label: "block", now: `${spacingBefore} s`, next: `${spacingAfter} s`, unit: "" },
    {
      label: "miner",
      now: formatZecShort(minerBeforeZat),
      next: formatZecShort(minerAfterZat),
      unit: " ZEC per block",
    },
  ];
  return (
    <section
      aria-labelledby="nu7-changes"
      className="border border-green-faint bg-panel px-4 py-3.5"
    >
      <h2 id="nu7-changes" className="microlabel mb-2.5 text-ink-faint">
        what changes at block {formatCount(NU7_HEIGHT)}
      </h2>
      <dl className="grid grid-cols-[3rem_auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1.5">
        {rows.map((row) => (
          <div key={row.label} className="contents">
            <dt className="text-xs text-ink-faint">{row.label}</dt>
            <dd
              className={`text-[19px] font-extrabold tracking-[0.08em] tabular-nums sm:text-[22px] ${
                active ? "text-warn" : "text-ink-bright"
              }`}
            >
              {active ? row.next : row.now}
            </dd>
            <dd className="min-w-0 text-xs text-ink-dim">
              {active ? (
                <>
                  {row.unit.trim() ? `${row.unit.trim()} · ` : ""}
                  <b className="text-ink">was {row.now}</b>
                </>
              ) : (
                <>
                  → <b className="text-ink">{row.next}</b>
                  {row.unit}
                </>
              )}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-1.5 pl-15 text-xs text-ink-dim">three times the blocks, same ZEC per hour</p>
    </section>
  );
}
