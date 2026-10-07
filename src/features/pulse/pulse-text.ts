import type { PulseEnd, PulseEvent, PulseLeg } from "@/domain";
import { assetTickerIsKnown, isPulsePool, pulseChainTicker } from "@/domain";
import { formatCount, formatZecAmount } from "@/lib/format";

/**
 * Every sentence `/pulse` is allowed to say about a movement.
 *
 * One module, because the same event is described three times — in a mark's `<title>`, in the
 * log row, and in the screen-reader announcement — and the refusals live here for the same
 * reason:
 *
 *  - A hub states its signed legs and stops: `transparent −X · sapling −Y · orchard +Z · fee f ·
 *    direction not settled by the chain`. Never "from A + B → C": choosing which leg paid which
 *    is the inference `poolMigration` refuses.
 *  - A row never says "sent to". Deciding which output was the payment and which was change is
 *    chain analysis this site does not do.
 *  - No dollars. A crossing's counterpart is named, never priced.
 */

const ZEC = (zat: number): string => `${formatZecAmount(Math.abs(zat))} ZEC`;

/**
 * True when a movement crossed a swap venue, however it is drawn.
 *
 * Not `kind === "swap"`: `pairSwapsWithTxs` folds a crossing into the transaction that carried
 * its Zcash leg, and the merged event keeps that transaction's `kind`. The counterpart facts are
 * what the fold copies through, so they are what this reads.
 */
export function isCrossing(event: PulseEvent): boolean {
  return event.counterpartChain !== undefined || event.venue !== undefined;
}

/**
 * How much of a block was drawn, when it was not all of it. The count is the fact and the marks
 * are a window onto it: a block capped at 300 of 2,450 must never present its 300 as the total,
 * and the only place to say so is beside the marks.
 */
export interface PulseCoverage {
  drawn: number;
  total: number;
}

export function coverageNote(coverage?: PulseCoverage): string | null {
  if (coverage === undefined || coverage.drawn >= coverage.total) return null;
  return `${formatCount(coverage.drawn)} of ${formatCount(coverage.total)} drawn`;
}

/** A node as a reader reads it: a pool by name, a chain by ticker, the boundary as itself. */
export function nodeLabel(node: PulseEnd): string {
  const ticker = pulseChainTicker(node);
  if (ticker !== null) return ticker;
  if (node === "hub") return "the shielded boundary";
  return node;
}

/**
 * The signed legs of a hub movement, in the order they were published.
 *
 * A sign is a fact the pool itself published, so it is kept: `−` is value that left, `+` value
 * that arrived. A leg with no published amount says so rather than reading as zero.
 */
export function hubSentence(event: PulseEvent): string {
  const legs = event.legs
    .map((leg) => {
      const node = leg.from === "hub" ? leg.to : leg.from;
      if (leg.amountZat === null) return `${nodeLabel(node)} amount not published`;
      // Signed from the hub's point of view, which is how the domain builds them: a leg
      // leaving the hub arrived at the pool.
      const sign = leg.from === "hub" ? "+" : "−";
      return `${nodeLabel(node)} ${sign}${ZEC(leg.amountZat)}`;
    })
    .join(" · ");
  const fee =
    event.feeZat === null || event.feeZat === undefined
      ? "fee unknown"
      : `fee ${ZEC(event.feeZat)}`;
  return `${legs} · ${fee} · direction not settled by the chain`;
}

/** What the counterpart of a crossing is called, with every caveat the venue's own row earns. */
export function counterpartPhrase(event: PulseEvent): string {
  const chain = event.counterpartChain ?? "an unnamed chain";
  const asset = event.counterpartAsset;
  if (event.counterpartIsSynthetic === true) return `wrapped ZEC (synthetic) on ${chain}`;
  if (asset === undefined) return chain;
  if (!assetTickerIsKnown(asset)) return `${chain} · ticker unknown`;
  // A chain's own coin is named once. "BTC on BTC" is true and reads as a mistake.
  if (asset.toUpperCase() === chain.toUpperCase()) return chain;
  return `${asset} on ${chain}`;
}

/**
 * The title a mark carries — what moved, from where to where, and what is not knowable.
 *
 * A coinbase's outputs are the subsidy and the fees the block collected, and the two separate
 * only when the fee total was derivable — never by a hard-coded split. A collapsed block states
 * its own sum; an unpaired crossing states that no block has recorded it.
 */
export function eventTitle(event: PulseEvent, leg?: PulseLeg, coverage?: PulseCoverage): string {
  const parts: string[] = [];

  if (event.shape === "veil") {
    parts.push("fully shielded — the movement is public, the amount is not");
  } else if (event.shape === "hub") {
    parts.push(hubSentence(event));
  } else if (leg) {
    const route = `${nodeLabel(leg.from)} → ${nodeLabel(leg.to)}`;
    if (leg.amountZat === null) {
      parts.push(`${route} · value not carried in this view`);
    } else {
      parts.push(`${ZEC(leg.amountZat)} · ${route}`);
    }
    // Only an unshielding leg. Its amount is what left the pool, which includes the fee; a
    // shielding leg's does not, nor does a crossing's or a coinbase's. A crossing landing on
    // transparent pays no Zcash fee on that leg.
    if (leg.to === "transparent" && isPulsePool(leg.from) && leg.amountZat !== null) {
      parts.push("incl. fee");
    }
  }

  if (event.kind === "coinbase") {
    if (event.subsidyIncludesFees === true) {
      parts.push("coinbase · subsidy + fees");
    } else if (event.subsidyZat !== null) {
      parts.push(`coinbase · subsidy ${ZEC(event.subsidyZat)}`);
    }
  }

  if (isCrossing(event)) {
    parts.push(counterpartPhrase(event));
    if (event.venue !== undefined) parts.push(String(event.venue));
    parts.push("public venues only");
    if (event.height === null) {
      parts.push("placed at venue time · no block has recorded it");
    }
  }

  if (isCrossing(event) && event.legs.some((l) => l.to === "hub" || l.from === "hub")) {
    parts.push("lands at a shielded address");
  }

  if (event.pending === true) parts.push("unconfirmed · in our node's mempool");
  if (event.height !== null) parts.push(`block ${formatCount(event.height)}`);
  const drawn = coverageNote(coverage);
  if (drawn !== null) parts.push(drawn);
  return parts.join(" · ");
}

/** The title a per-edge sum carries when a block is too busy to draw one mark per movement. */
export function collapsedTitle(
  count: number,
  totalZat: number,
  height: number | null,
  from: PulseEnd,
  to: PulseEnd,
  coverage?: PulseCoverage,
): string {
  const parts = [`${count} tx · Σ ${ZEC(totalZat)} · ${nodeLabel(from)} → ${nodeLabel(to)}`];
  if (height !== null) parts.push(`block ${formatCount(height)}`);
  const drawn = coverageNote(coverage);
  if (drawn !== null) parts.push(drawn);
  return parts.join(" · ");
}

/**
 * A block's fully shielded movements, counted rather than dropped.
 *
 * They have no amount to sum along an edge, which is why a collapsed view has no ribbon to put
 * them on — and dropping them would state that a busy block held only the movements that could
 * be summed. The count is what is knowable and the count is what is said.
 */
export function collapsedVeilTitle(
  count: number,
  pool: PulseEnd,
  height: number | null,
  throughHeight?: number | null,
): string {
  return `${count} inside ${nodeLabel(pool)} · amounts private by design${blockRange(height, throughHeight)}`;
}

/**
 * `· block N`, or `· blocks A–B` once one merged count mark stands for several. A range that
 * collapses to one block prints as one block: `blocks 12–12` would state a span that is not
 * there.
 */
function blockRange(height: number | null, throughHeight?: number | null): string {
  if (height === null) return "";
  const from = formatCount(height);
  if (throughHeight === undefined || throughHeight === null || throughHeight === height) {
    return ` · block ${from}`;
  }
  const [lo, hi] = height <= throughHeight ? [height, throughHeight] : [throughHeight, height];
  return ` · blocks ${formatCount(lo)}–${formatCount(hi)}`;
}

/**
 * A block's movements whose direction the chain did not settle, counted.
 *
 * Summing a hub's legs along an edge would state the direction `poolMigration` refuses, so a
 * collapsed hub carries its count and nothing else.
 */
export function collapsedHubTitle(
  count: number,
  height: number | null,
  throughHeight?: number | null,
): string {
  return `${count} unsettled · direction not settled by the chain${blockRange(height, throughHeight)}`;
}

export interface PulseLogLine {
  /** The amount, or null when the chain did not publish one. */
  amount: string | null;
  /** What happened, stated without pairing inputs to outputs. */
  text: string;
  /** The caveat that travels with it. */
  kind: string;
  /** True when the amount is encrypted on-chain, which is the only thing the Veil may mean. */
  shielded: boolean;
}

/**
 * A movement as one log row.
 *
 * The log is the primary record under reduced motion — a reader who cannot watch marks travel
 * reads this instead — so every row has to be complete on its own, including the caveat.
 */
export function pulseLogLine(event: PulseEvent): PulseLogLine {
  if (event.shape === "veil") {
    const pool = event.legs[0]?.to ?? event.legs[0]?.from ?? "a shielded pool";
    return {
      amount: null,
      text: `inside ${nodeLabel(pool as PulseEnd)}`,
      kind: "fully shielded · amount private by design",
      shielded: true,
    };
  }

  if (event.shape === "hub") {
    return { amount: null, text: hubSentence(event), kind: "mixed · legs exact", shielded: false };
  }

  const leg = event.legs.find((l) => l.amountZat !== null) ?? event.legs[0];
  const amount = leg?.amountZat == null ? null : ZEC(leg.amountZat);
  const route = leg ? `${nodeLabel(leg.from)} → ${nodeLabel(leg.to)}` : "no leg published";

  if (isCrossing(event)) {
    // The floor caveat stays on the ribbon and pulse titles, where the figure is; the log row
    // names the venue and the counterpart and stops.
    const caveats = [counterpartPhrase(event)];
    if (event.venue !== undefined) caveats.unshift(String(event.venue));
    if (event.height === null) caveats.push("no block has recorded it");
    return { amount, text: route, kind: caveats.join(" · "), shielded: false };
  }

  if (event.kind === "coinbase") {
    return {
      amount,
      text: route,
      kind:
        event.subsidyIncludesFees === true
          ? "coinbase · subsidy + fees, not separable"
          : "coinbase · issuance",
      shielded: false,
    };
  }

  if (event.kind === "lockbox") {
    return { amount, text: route, kind: "deferred subsidy · consensus", shielded: false };
  }

  const caveats: string[] = [];
  if (leg?.amountZat == null) caveats.push("value not carried in this view");
  if (leg && (leg.from === "sprout" || leg.to === "sprout")) {
    caveats.push("vpub-derived · a different measurement");
  }
  if (leg && leg.to === "transparent" && isPulsePool(leg.from)) caveats.push("incl. fee");
  if (event.pending === true) caveats.push("unconfirmed · in our node's mempool");
  return { amount, text: route, kind: caveats.join(" · "), shielded: false };
}
