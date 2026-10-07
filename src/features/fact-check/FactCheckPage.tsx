import { PageHeader } from "@/components/PageHeader";
import { ScrollSpy } from "@/components/ScrollSpy";
import type { ChainInfo, SupplyBreakdown } from "@/domain";
import { CLAIM_GROUPS, CLAIMS } from "./claims";
import { ClaimEntry } from "./ClaimEntry";
import { ClaimOutline } from "./ClaimOutline";
import { factCheckFigures } from "./figures";

export interface FactCheckPageProps {
  /** Null when the read failed: the answers still render, their live rows say "unavailable". */
  supply: SupplyBreakdown | null;
  chain: ChainInfo | null;
}

/**
 * `/fact-check` — common claims about Zcash, each with a verdict, a short sourced answer and,
 * where the chain bears on it, the live figure.
 *
 * The page must be more accurate than the claims it answers, so it concedes what is true (two
 * counterfeiting bugs existed) before saying what is not, and every sentence traces to a source
 * listed under it.
 */
/** Module-level, so the observer is built once rather than on every render. */
const CLAIM_IDS = CLAIMS.map((c) => c.id);

export function FactCheckPage({ supply, chain }: FactCheckPageProps) {
  const figures = factCheckFigures(supply, chain);
  return (
    <>
      <PageHeader
        eyebrow="FACT CHECK"
        title="Claims about Zcash, checked"
        lede="Each claim as it is usually made, what the record says, and where to check it."
      />

      <ScrollSpy ids={CLAIM_IDS} />

      {/* Mobile: a native disclosure; no JS, no state, and it never overlays content. */}
      <details className="panel mb-6 p-5 lg:hidden">
        <summary className="microlabel cursor-pointer select-none">ON THIS PAGE</summary>
        <div className="mt-3">
          <ClaimOutline />
        </div>
      </details>

      <div className="flex gap-10">
        <aside className="hidden w-60 shrink-0 lg:block">
          <div className="sticky top-6 max-h-[calc(100vh-3rem)] overflow-y-auto pr-2">
            <ClaimOutline />
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col gap-8 pb-10">
          {CLAIM_GROUPS.map((group) => (
            <section key={group.id} aria-labelledby={`group-${group.id}`}>
              <h2 id={`group-${group.id}`} className="microlabel mb-3 text-green">
                {group.title}
              </h2>
              <div className="flex flex-col gap-3">
                {CLAIMS.filter((c) => c.group === group.id).map((claim) => (
                  <ClaimEntry
                    key={claim.id}
                    claim={claim}
                    figures={(claim.live ?? []).flatMap((id) => figures[id])}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </>
  );
}
