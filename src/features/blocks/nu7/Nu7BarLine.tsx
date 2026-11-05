import { NU7_HEIGHT, targetSpacingAt } from "@/domain";
import { formatCount } from "@/lib/format";
import type { Nu7BarText } from "./nu7-bar";

export interface Nu7BarLineProps {
  text: Exclude<Nu7BarText, { kind: "over" }>;
}

const SEP = <span className="text-ink-faint"> · </span>;

/**
 * The site bar's words. A phone gets the short form ("~9 h · 412 blocks") so the count is never
 * what truncates.
 */
export function Nu7BarLine({ text }: Nu7BarLineProps) {
  const height = <b className="text-ink-bright">{formatCount(NU7_HEIGHT)}</b>;
  if (text.kind === "live") {
    return (
      <>
        live
        {SEP}
        activated at block {height}
        <span className="hidden sm:inline">
          {SEP}
          blocks every ~{targetSpacingAt(NU7_HEIGHT)} s
        </span>
      </>
    );
  }
  if (text.kind === "counting") {
    return (
      <>
        <span className="hidden sm:inline">activates </span>
        {text.remaining === null ? (
          "any moment"
        ) : (
          <>
            <span className="hidden sm:inline">in about </span>
            <span className="sm:hidden">~</span>
            <b className="text-ink-bright">{text.remaining}</b>
          </>
        )}
        {SEP}
        <b className="text-ink-bright">{formatCount(text.blocks)}</b>{" "}
        {text.blocks === 1 ? "block" : "blocks"}
        <span className="hidden sm:inline"> to go</span>
      </>
    );
  }
  return <>activates at block {height}</>;
}
