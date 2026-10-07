import { Badge } from "@/components/Badge";
import { VERDICT_LABEL, VERDICT_MEANING, type Verdict } from "./claims";

export interface VerdictTagProps {
  verdict: Verdict;
}

/**
 * The verdict on one claim, as a bordered word: the site's one pill, `Badge`.
 *
 * Ink weight, never red or amber: the palette reserves red for negative deltas and amber for
 * charts and the testnet banner. Never green either, which means "shielded / in force" and
 * would read as approval. The word carries the verdict; the weight only separates "the record
 * contradicts it" (`bright`) from "part of it is true" (`neutral`), so a PARTLY TRUE never
 * reads as loudly as a FALSE.
 *
 * The wrapper carries `data-verdict` (the e2e suite counts one per claim) and `shrink-0`, since
 * it is the flex child beside the claim's heading; `Badge` takes no data attributes of its own.
 */
export function VerdictTag({ verdict }: VerdictTagProps) {
  const tone = verdict === "partly-true" || verdict === "outdated" ? "neutral" : "bright";
  return (
    <span className="inline-flex shrink-0" data-verdict={verdict}>
      <Badge tone={tone} title={VERDICT_MEANING[verdict]}>
        {VERDICT_LABEL[verdict]}
      </Badge>
    </span>
  );
}
