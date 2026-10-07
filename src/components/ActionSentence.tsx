import type { ReactNode } from "react";
import type { ActionPart } from "@/domain";
import { ZCASH_CHAIN, assetTickerIsKnown, protocolLabel } from "@/domain";
import { formatZecAmount } from "@/lib/format";
import { coinTicker, isTestnet } from "@/lib/network";
import { ChainLogo } from "@/components/ChainLogo";
import { Badge } from "@/components/Badge";
import { PoolBadge } from "@/components/PoolBadge";
import { ProtocolLogo } from "@/components/ProtocolLogo";
import { Redacted } from "@/components/Redacted";

export interface ActionSentenceProps {
  parts: readonly ActionPart[];
}

/**
 * A sentence a reader can read aloud and a page a reader can scan: the words carry the
 * meaning, the marks inside them carry the privacy and the chains at a glance.
 *
 * Every separator between a figure and its ticker is a real character, never only a gap in
 * CSS — copy-paste and a screen reader get the text, not the layout. Marks are decorative
 * (`aria-hidden`): the word beside each one already names it.
 */
export function ActionSentence({ parts }: ActionSentenceProps) {
  return (
    <p className="text-[15px] leading-8 text-ink">
      {parts.map((part, index) => (
        <Part key={index} part={part} />
      ))}
    </p>
  );
}

/**
 * The alignment rule for anything in the sentence that is not a word — a coin mark, a chain
 * chip, a pool chip, a venue mark.
 *
 * `vertical-align: middle` centres the box on the sentence's baseline plus half its x-height,
 * which is exact for both kinds of mark:
 *
 * - a 14px logo is centred on the lowercase body of the words around it;
 * - a chip (22px: 16px line + 2px padding + 1px border, each way) centres its 10px capitals,
 *   which puts the chip's own baseline within half a pixel of the sentence's.
 *
 * `inline-flex items-center` stops the box taking a baseline from its first child (an SVG has
 * none, so it would synthesise one from its bottom edge), and `leading-4` keeps a chip from
 * inheriting the sentence's 32px line. Every box is no taller than the line box, so a mark never
 * pushes a line apart. Words stay plain inline text: inside the flex box they would be centred
 * too and drop a pixel below their neighbours.
 */
const INLINE_MARK = "inline-flex items-center align-middle leading-4";

/** A logo sitting inline in prose: the one rule, plus the gap before the word it labels. */
function InlineMark({ children }: { children: ReactNode }) {
  return <span className={`${INLINE_MARK} mr-1`}>{children}</span>;
}

function Part({ part }: { part: ActionPart }) {
  switch (part.kind) {
    case "text":
      return <>{part.text}</>;
    case "verb":
      return (
        <strong
          className={`font-semibold ${part.tone === "shielded" ? "text-green" : "text-ink-bright"}`}
        >
          {part.text}
        </strong>
      );
    case "zec":
      return (
        <span className="whitespace-nowrap">
          {part.zat === null ? (
            <Redacted className="text-xs" />
          ) : (
            <span className="font-semibold text-ink-bright tabular-nums">
              {formatZecAmount(part.zat)}
            </span>
          )}{" "}
          {/* The ZEC mark labels ZEC; a testnet amount is TAZ, which has no mark of its own. */}
          {isTestnet ? null : (
            <InlineMark>
              <ChainLogo chain={ZCASH_CHAIN} size="sm" />
            </InlineMark>
          )}
          <span className="text-xs text-ink-dim">{coinTicker}</span>
        </span>
      );
    case "end":
      return (
        <span className="whitespace-nowrap">
          {part.before}
          <span className={INLINE_MARK}>
            <PoolBadge pool={part.end} shield />
          </span>
          {part.after}
        </span>
      );
    case "asset":
      return (
        <span className="whitespace-nowrap">
          <span className="font-semibold text-ink-bright tabular-nums">{part.amount}</span>{" "}
          <InlineMark>
            <ChainLogo chain={part.ticker} fallbackChain={part.chain} size="sm" />
          </InlineMark>
          {/* A venue that published no ticker gets a label, never the chain's native ticker in
              its place — an SPL token on Solana is not SOL. */}
          <span className="text-xs text-ink-dim">
            {assetTickerIsKnown(part.ticker) ? part.ticker : "unidentified token"}
          </span>
        </span>
      );
    case "chain":
      // The shared badge size, so this chip and a pool chip in one sentence are one height.
      // Zcash in neutral ink; a foreign chain bright and dashed — the edge this site uses for
      // what it does not index.
      return (
        <Badge
          tone={part.chain === ZCASH_CHAIN ? "neutral" : "bright"}
          dashed={part.chain !== ZCASH_CHAIN}
          icon={<ChainLogo chain={part.chain} size="sm" />}
          className="align-middle"
        >
          {part.label}
        </Badge>
      );
    case "venue":
      // `before` ("via ") rides inside the nowrap span: the preposition alone at a line's end
      // with the venue on the next reads as two fragments.
      // The venue's NAME stays a word in the sentence; only its mark takes the inline rule.
      return (
        <span className="whitespace-nowrap">
          {part.before}
          <InlineMark>
            <ProtocolLogo protocol={part.protocol} size="sm" />
          </InlineMark>
          <span className="text-ink-bright">{protocolLabel(part.protocol)}</span>
        </span>
      );
  }
}
