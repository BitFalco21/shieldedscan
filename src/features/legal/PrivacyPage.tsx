import Link from "@/components/Link";
import { Panel } from "@/components/Panel";
import { LEGAL_LAST_UPDATED, X_PROJECT_HANDLE, X_PROJECT_URL } from "@/lib/links";
import { isAgentEnabled } from "@/lib/agent";
import { PrivacyText } from "./PrivacyText";
import {
  PRIVACY_EGRESS_INTRO,
  PRIVACY_LEGAL_BASIS,
  PRIVACY_NOT_DONE,
  PRIVACY_OPERATOR,
  PRIVACY_PROCESSED,
  PRIVACY_PROCESSED_INTRO,
  PRIVACY_PROCESSORS,
  PRIVACY_PROCESSORS_INTRO,
  PRIVACY_PROCESSORS_OUTRO,
  PRIVACY_RIGHTS,
  PRIVACY_SUMMARY,
  privacyEgressFor,
  type PrivacyClaim,
} from "@/content/privacy-facts";
import { PageHeader } from "@/components/PageHeader";

/**
 * The privacy page.
 *
 * Every claim here is checked against the running system rather than against intent: response
 * headers off the deployed site, the reverse proxy's live config, the application's logging
 * source. A privacy policy is the one page whose entire value is that it is true.
 *
 * It is deliberately not the shortest version. "We collect nothing" would be simpler and
 * slightly false: a request has to reach a server, and the providers carrying it see an IP
 * address in order to answer.
 *
 * The claims live in `privacy-facts.ts` and this page renders them, so the AI agent's answers
 * about this policy read the same single copy. A new claim goes in that file; this page is
 * layout.
 */
export function PrivacyPage() {
  return (
    <>
      <PageHeader eyebrow="LEGAL" title="Privacy" lede={<PrivacyText text={PRIVACY_SUMMARY} />}>
        <p className="mt-2 text-xs text-ink-faint">Last updated {LEGAL_LAST_UPDATED}.</p>
      </PageHeader>

      <Panel title="WHO IS RESPONSIBLE">
        <div className="max-w-2xl space-y-3 py-1 text-sm leading-relaxed text-ink-dim">
          <p>
            <ClaimText claim={PRIVACY_OPERATOR} />
          </p>
        </div>
      </Panel>

      <Panel title="WHAT THIS SITE DOES NOT DO" className="mt-3">
        <div className="max-w-2xl space-y-3 py-1 text-sm leading-relaxed text-ink-dim">
          <ClaimList claims={PRIVACY_NOT_DONE} />
        </div>
      </Panel>

      <Panel title="WHAT IS PROCESSED ANYWAY" className="mt-3">
        <div className="max-w-2xl space-y-3 py-1 text-sm leading-relaxed text-ink-dim">
          <p>
            <PrivacyText text={PRIVACY_PROCESSED_INTRO} />
          </p>
          <p>What happens to it here:</p>
          <ClaimList claims={PRIVACY_PROCESSED} />
          <p>
            <PrivacyText text={PRIVACY_LEGAL_BASIS} />
          </p>
        </div>
      </Panel>

      <Panel title="THE PROVIDERS THAT CARRY THE REQUEST" className="mt-3">
        <div className="max-w-2xl space-y-3 py-1 text-sm leading-relaxed text-ink-dim">
          <p>
            <PrivacyText text={PRIVACY_PROCESSORS_INTRO} />
          </p>
          <ClaimList claims={PRIVACY_PROCESSORS} />
          <p>
            <PrivacyText text={PRIVACY_PROCESSORS_OUTRO} />
          </p>
        </div>
      </Panel>

      <EgressPanel />

      <Panel title="WHAT YOU LOOK AT, AND WHAT YOU DONATE" className="mt-3">
        <div className="max-w-2xl space-y-3 py-1 text-sm leading-relaxed text-ink-dim">
          <p>
            The blocks, transactions and addresses shown here are public Zcash blockchain data. They
            are not personal data this project collected — they are a public ledger anyone can read
            with their own node, and this site is a way of reading it.{" "}
            <span className="text-ink">
              Looking up an address here does not tell this site that the address is yours
            </span>
            , and no record is kept associating a visitor with anything they viewed.
          </p>
          <p>
            Because the chain is public, be aware of the general point: searching a{" "}
            <span className="text-ink">transparent</span> address on any explorer, including this
            one, reveals that address to whoever operates it. That is a property of transparent
            addresses rather than of this site, and it is one reason shielded addresses exist.
          </p>
          <p>
            Donations are on-chain payments to a published address. This project sees only what the
            chain shows: a shielded donation stays shielded and is not visible to this site either.
            No payment processor is involved and no payment details are ever handled.
          </p>
        </div>
      </Panel>

      <Panel title="YOUR RIGHTS" className="mt-3">
        <div className="max-w-2xl space-y-3 py-1 text-sm leading-relaxed text-ink-dim">
          {PRIVACY_RIGHTS.map((paragraph) => (
            <p key={paragraph.slice(0, 24)}>
              <PrivacyText text={paragraph} />
            </p>
          ))}
        </div>
      </Panel>

      <Panel title="CHANGES" className="mt-3">
        <div className="max-w-2xl space-y-3 py-1 text-sm leading-relaxed text-ink-dim">
          <p>
            If this changes, this page changes with it and the date at the top moves. A change that
            introduced any form of tracking would be announced at{" "}
            <a
              href={X_PROJECT_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-green hover:underline"
            >
              {X_PROJECT_HANDLE}
            </a>{" "}
            rather than slipped in — retiring a promise quietly is not the same as removing it.
          </p>
          <p>
            The{" "}
            <Link href="/terms" className="text-green hover:underline">
              terms of use
            </Link>{" "}
            cover the other half: what this site is, and what it does not guarantee.
          </p>
        </div>
      </Panel>
    </>
  );
}

/**
 * The egress heading counts the list rather than restating it, through `privacyEgressFor`, so
 * the title cannot disagree with the list beneath it (the list depends on deployment flags).
 */
const EGRESS_COUNT_WORDS = ["ZERO", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX"] as const;

function EgressPanel() {
  const claims = privacyEgressFor(isAgentEnabled);
  const count = EGRESS_COUNT_WORDS[claims.length] ?? String(claims.length);
  return (
    <Panel title={`${count} PLACES DATA LEAVES YOUR BROWSER`} className="mt-3">
      <div className="max-w-2xl space-y-3 py-1 text-sm leading-relaxed text-ink-dim">
        <p>
          <PrivacyText text={PRIVACY_EGRESS_INTRO} />
        </p>
        <ClaimList claims={claims} />
      </div>
    </Panel>
  );
}

function ClaimText({ claim }: { claim: PrivacyClaim }) {
  return (
    <>
      <span className="text-ink">{claim.label}</span> <PrivacyText text={claim.body} />
    </>
  );
}

function ClaimList({ claims }: { claims: readonly PrivacyClaim[] }) {
  return (
    <ul className="space-y-2">
      {claims.map((claim) => (
        <li key={claim.id}>
          <ClaimText claim={claim} />
        </li>
      ))}
    </ul>
  );
}
