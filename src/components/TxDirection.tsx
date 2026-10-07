import type { Transaction } from "@/domain";
import { txFlowPath, txPools } from "@/domain";
import { PoolBadge, type TxTypeName } from "@/components/PoolBadge";

export interface TxDirectionProps {
  tx: Transaction;
}

/** The join between two names on one end of a path. Spoken as "and", like the refusal. */
function Plus() {
  return (
    <span role="img" aria-label="and" className="text-ink-faint">
      +
    </span>
  );
}

/** An extra end, carrying its `+` on the side away from the arrow. */
function ExtraEnd({ pool, plus }: { pool: TxTypeName; plus: "before" | "after" }) {
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      {plus === "before" ? <Plus /> : null}
      <PoolBadge pool={pool} variant="text" />
      {plus === "after" ? <Plus /> : null}
    </span>
  );
}

/**
 * Where one transaction's value went: `[from…] → [to…]`.
 *
 * The DIRECTION column on `/block`, `/txs`, `/address` and `/mempool` — shared, because a row
 * must read the same way wherever it appears. {@link txFlowPath} owns which path is claimable;
 * this owns only how it is drawn.
 *
 * Pool names are plain text, not chips: the ink weight already carries the privacy grammar,
 * and the TYPE pill beside this column stays boxed.
 *
 * The arrow binds to the name it points at, always. A `flex-wrap` cell can break between
 * names — which lets a phone spend vertical space instead of horizontal — and an arrow left at
 * the end of a line points at nothing.
 *
 * From `xl` up, one step is one row: the last source, the arrow and the first destination stop
 * wrapping at 1280px. Not below it — an unbreakable step widens the column enough to push some
 * list tables past the page edge at 1024px. Extra ends on a multi-pool path wrap at every width.
 *
 * Two names on one end are joined by a `+`, or `ORCHARD SAPLING` reads as one phrase. The `+`
 * is a real character so it copies, and it stays with the extra end, on the side away from the
 * arrow (`ORCHARD + | SAPLING → IRONWOOD`, `MINED → TRANSPARENT | + ORCHARD`), so a wrap never
 * splits the step or starts a line with a bare `+`.
 *
 * A refused path renders the pools flat, with no arrow. That is not a blank state: the TYPE
 * column beside it reads MIXED, which is the explanation.
 */
export function TxDirection({ tx }: TxDirectionProps) {
  const path = txFlowPath(tx);

  if (path === null) {
    /*
     * The refusal, joined by the word "and" rather than left as a bare pair: two names side by
     * side under DIRECTION read as ordered — source then destination — which is the one claim
     * this branch withholds. "and" states the set.
     *
     * One inline run rather than one flex item per name, so the spaces are real text that
     * copy-paste and a screen reader get. The space before "and" is ordinary (the one place a
     * line may break); the one after is non-breaking, so "and" stays with the name it
     * introduces.
     */
    return (
      <span className="text-[10px] tracking-[0.14em]">
        {txPools(tx).map((pool, index) => (
          <span key={pool}>
            {index > 0 ? " " : null}
            <span className="whitespace-nowrap">
              {index > 0 ? <span className="text-ink-faint">{"and\u00A0"}</span> : null}
              <PoolBadge pool={pool} variant="text" />
            </span>
          </span>
        ))}
      </span>
    );
  }

  const lastFrom = path.from[path.from.length - 1];

  return (
    <>
      {path.from.slice(0, -1).map((end) => (
        <ExtraEnd key={end} pool={end} plus="after" />
      ))}
      {/* The step: may break between its source and its arrow below `xl`, never from it up.
          The gaps match the cell wrapper's (TxDirectionCell), so the nesting is invisible. */}
      <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 xl:flex-nowrap">
        {lastFrom ? <PoolBadge pool={lastFrom} variant="text" /> : null}
        <span className="inline-flex items-center gap-2 whitespace-nowrap">
          {/*
          A real character rather than a border or a margin, so the direction survives copy and
          announcement. Labelled rather than hidden: a bare "→" announces as "right arrow".
        */}
          <span role="img" aria-label="moved to" className="text-green-dim">
            →
          </span>
          {path.to[0] ? <PoolBadge pool={path.to[0]} variant="text" /> : null}
        </span>
      </span>
      {path.to.slice(1).map((end) => (
        <ExtraEnd key={end} pool={end} plus="before" />
      ))}
    </>
  );
}
