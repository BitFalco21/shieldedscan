import { PageHeader } from "@/components/PageHeader";
import { PrivacyShield } from "@/components/PrivacyShield";
import { isAgentEnabled } from "@/lib/agent";
import { LearnModes } from "./LearnModes";
import { LearnZeno } from "./LearnZeno";

export interface LearnPageProps {
  /** Today's ZEC price, for the test exchange and the fee beside a real result; null when unread. */
  priceUsd: number | null;
  pageUrl: string;
}

/**
 * `/learn` — from nothing to a first shielded transaction: wallet setup, getting ZEC, shielding
 * and unshielding, sending and receiving.
 *
 * Two words a beginner needs are defined once, at the top, with the same shields every other
 * page uses, so the grammar learned here is the grammar of the whole explorer.
 */
export function LearnPage({ priceUsd, pageUrl }: LearnPageProps) {
  return (
    <>
      <PageHeader
        eyebrow="learn"
        title="Your first shielded transaction"
        lede="Practice with test ZEC first. Then do it for real: after each step, paste what your wallet gives you and see what the blockchain shows everyone else."
      >
        <p className="mt-4 flex flex-wrap gap-x-6 gap-y-1.5 text-sm text-ink-dim">
          <span className="inline-flex items-center gap-2">
            <PrivacyShield variant="shielded" />
            <b className="font-semibold text-ink-bright">shielded</b> private
          </span>
          <span className="inline-flex items-center gap-2">
            <PrivacyShield variant="transparent" />
            <b className="font-semibold text-ink-bright">transparent</b> public, like Bitcoin
          </span>
        </p>
      </PageHeader>
      <LearnZeno enabled={isAgentEnabled}>
        <LearnModes priceUsd={priceUsd} pageUrl={pageUrl} />
      </LearnZeno>
    </>
  );
}
