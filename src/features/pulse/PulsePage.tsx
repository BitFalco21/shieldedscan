import type { PulseFrame, PulseRibbonsPayload } from "@/domain";
import { Panel } from "@/components/Panel";
import { nowSeconds } from "@/lib/clock";
import { PulseLedgerRows } from "./PulseLedgerRows";
import { PulseStage } from "./PulseStage";
import { formatCount } from "@/lib/format";

/**
 * The ledger page's server shell. Thin on purpose; two things are load-bearing:
 *
 *  - `frame.stocks` is one row. The height every balance and ruler prints comes from the same
 *    block row as the balances, never a tip read on another call.
 *  - `ribbons === null` is a real state, not a loading one. The day views behind the aggregate
 *    may not be filled; the page then draws floored ribbons and says the totals are unavailable,
 *    rather than drawing none, which would claim nothing has ever crossed a boundary.
 *
 * The ledger panel is passed as a child rather than rendered inside the client component, so its
 * copy controls never appear in a static render of the stage, where a control that cannot work
 * is a dead one.
 */
export interface PulsePageProps {
  frame: PulseFrame;
  /** `null` while the day views behind the ribbons have not been filled. */
  ribbons: PulseRibbonsPayload | null;
}

export function PulsePage({ frame, ribbons }: PulsePageProps) {
  return (
    // `pt-8`: the top every other page gets from `PageHeader`. The statement heading below stays
    // its own.
    <div className="space-y-4 pt-8">
      <div>
        <p className="microlabel">./shieldedscan › pulse</p>
        <h1 className="mt-1 text-2xl font-extralight text-ink-bright">
          The <span className="text-green">pulse</span> of the Zcash chain
        </h1>
      </div>
      <PulseStage
        frame={frame}
        ribbons={ribbons}
        serverNow={nowSeconds()}
        ledgerPanel={
          // Titled with the height it was read at. These rows are the server's, and the stage
          // in front of them follows the live feed — so the panel is anchored to the frame it
          // came from rather than silently drifting behind the boxes above it.
          <Panel
            title={`transparent ledger — newest outputs · at block ${formatCount(frame.stocks.height)}`}
          >
            <PulseLedgerRows rows={frame.ledger} />
          </Panel>
        }
      />
    </div>
  );
}
