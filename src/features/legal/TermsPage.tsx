import Link from "@/components/Link";
import { Panel } from "@/components/Panel";
import { LEGAL_LAST_UPDATED, OPERATOR_NAME } from "@/lib/links";
import { PageHeader } from "@/components/PageHeader";

/**
 * The terms of use.
 *
 * Kept to what actually applies. There is no account, no payment, no upload and no user
 * content here, so the clauses that usually fill this page — termination of accounts,
 * refunds, licence to user submissions, arbitration of billing disputes — would be
 * decoration. What genuinely needs saying is narrower and mostly protective of the
 * reader: the data can be wrong, none of it is advice, this site will never ask for a key
 * or hold funds, and the API has no guarantee behind it.
 */
export function TermsPage() {
  return (
    <>
      <PageHeader
        eyebrow="LEGAL"
        title="Terms of use"
        lede={
          <>
            ./shieldedscan is a free, informational Zcash block explorer published by
            {OPERATOR_NAME}. Using the site or its public API means accepting what follows. If you
            do not accept it, please do not use them.
          </>
        }
      >
        <p className="mt-2 text-xs text-ink-faint">Last updated {LEGAL_LAST_UPDATED}.</p>
      </PageHeader>

      <Panel title="WHAT THIS SERVICE IS">
        <div className="max-w-2xl space-y-3 py-1 text-sm leading-relaxed text-ink-dim">
          <p>
            A read-only window onto the public Zcash blockchain, plus analytics derived from it and
            records of ZEC crossings published by public swap venues. It is provided free of charge,
            with no account and no registration.
          </p>
          <p>
            <span className="text-ink">It is not a wallet, an exchange or a payment service.</span>{" "}
            It never holds, transmits, swaps or has custody of anyone&rsquo;s funds, and it cannot
            broadcast a transaction for you. The only address this site publishes as its own is the
            one on the{" "}
            <Link href="/donate" className="text-green hover:underline">
              donate
            </Link>{" "}
            page.
          </p>
          <p>
            <span className="text-ink">
              This site will never ask you for a private key, a seed phrase or a viewing key
            </span>
            , and there is no field anywhere on it for entering one. Any site or message claiming
            otherwise in this project&rsquo;s name is fraudulent. Treat an unexpected request for a
            key as an attack, wherever it appears to come from.
          </p>
        </div>
      </Panel>

      <Panel title="ACCURACY, AND THE ABSENCE OF A GUARANTEE" className="mt-3">
        <div className="max-w-2xl space-y-3 py-1 text-sm leading-relaxed text-ink-dim">
          <p>
            The service is provided <span className="text-ink">&ldquo;as is&rdquo;</span> and{" "}
            <span className="text-ink">&ldquo;as available&rdquo;</span>, without warranties of any
            kind, express or implied, including any implied warranty of merchantability, fitness for
            a particular purpose, accuracy or non-infringement, to the fullest extent permitted by
            law.
          </p>
          <p>
            Real limits worth stating plainly: figures are derived by software that can contain
            bugs; data can lag the chain, particularly near the tip, where recent blocks may still
            be reorganised; third-party inputs — market prices and swap-venue records — can be
            wrong, delayed or withdrawn; and cross-chain totals cover public swap venues only and
            are therefore a floor, not a total. Pages label what is unmeasured rather than filling
            it in, but that is an engineering commitment, not a warranty.
          </p>
          <p>
            <span className="text-ink">
              Nothing here is financial, investment, trading, tax or legal advice
            </span>
            , and nothing here is a solicitation to buy or sell anything. Verify anything that
            matters against your own Zcash node or another independent source before acting on it.
            Decisions you take on the basis of this site are yours.
          </p>
          <p>
            No uptime is promised. The service runs on a single server maintained by one person and
            may be slow, interrupted, or withdrawn in whole or in part at any time and without
            notice.
          </p>
        </div>
      </Panel>

      <Panel title="THE PUBLIC API" className="mt-3">
        <div className="max-w-2xl space-y-3 py-1 text-sm leading-relaxed text-ink-dim">
          <p>
            The{" "}
            <Link href="/api-docs" className="text-green hover:underline">
              public API
            </Link>{" "}
            is free and keyless — deliberately, because an API key is an identifier and issuing one
            would mean recording who is calling. In exchange, please use it in a way that keeps it
            available for everyone else:
          </p>
          <ul className="space-y-2">
            <li>Respect the published rate limits, and do not try to work around them.</li>
            <li>
              Cache what you can. Chain data past reorg depth never changes, and the responses say
              so in their cache headers.
            </li>
            <li>
              Do not use the service to attack it or anyone else — no attempt to overwhelm, probe,
              circumvent or reverse the infrastructure, and no use that breaks the law.
            </li>
            <li>
              Do not present the data as your own live service in a way that implies this project
              endorses or supports you. Attribution is appreciated but not required.
            </li>
          </ul>
          <p>
            There is no service level, no support commitment and no guarantee of backwards
            compatibility beyond a good-faith effort to keep the versioned surface stable. Endpoints
            can change or disappear, and access can be limited or refused where use threatens the
            service.
          </p>
        </div>
      </Panel>

      <Panel title="OWNERSHIP AND MARKS" className="mt-3">
        <div className="max-w-2xl space-y-3 py-1 text-sm leading-relaxed text-ink-dim">
          <p>
            <span className="text-ink">The blockchain data is nobody&rsquo;s property.</span> It is
            public, factual and freely reproducible; no ownership is claimed over it and you may use
            figures obtained here without permission.
          </p>
          <p>
            The site&rsquo;s design, code, written explanations and brand marks are{" "}
            <span className="text-ink">
              &copy; {new Date().getUTCFullYear()} {OPERATOR_NAME}
            </span>
            . See the{" "}
            <Link href="/brand" className="text-green hover:underline">
              brand page
            </Link>{" "}
            for what you may do with the name and logo without asking.
          </p>
          <p>
            Third-party names and logos shown here — Zcash, Zakura, and the chains, assets and swap
            venues that appear in cross-chain records — belong to their respective owners and are
            used descriptively, to identify what a figure refers to or to credit a dependency. Their
            appearance implies no affiliation with or endorsement by those parties. This project is
            not affiliated with the Electric Coin Company, the Zcash Foundation, or any venue whose
            data it reports.
          </p>
          <p>
            Links to other sites are provided for reference. This project does not control them and
            is not responsible for their content, accuracy or practices.
          </p>
        </div>
      </Panel>

      <Panel title="LIABILITY" className="mt-3">
        <div className="max-w-2xl space-y-3 py-1 text-sm leading-relaxed text-ink-dim">
          <p>
            To the fullest extent permitted by law, ShieldedScan shall not be liable for any
            indirect, incidental, special or consequential loss, nor for any loss of profit,
            revenue, data or cryptocurrency, arising from your use of — or inability to use — this
            site or its API, including any loss caused by reliance on a figure that turns out to be
            inaccurate, delayed or unavailable.
          </p>
          <p>
            Some jurisdictions do not allow certain exclusions of warranty or liability, and where
            that is so, the exclusions above apply only as far as the law allows. Nothing here
            limits liability for fraud, for death or personal injury caused by negligence, or for
            anything else that cannot lawfully be limited. If you are a consumer, your mandatory
            statutory rights are unaffected.
          </p>
        </div>
      </Panel>
    </>
  );
}
