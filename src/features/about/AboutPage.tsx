import Link from "@/components/Link";
import { Panel } from "@/components/Panel";
import { ZakuraMark } from "@/components/ZakuraMark";
import {
  X_AUTHOR_HANDLE,
  X_AUTHOR_URL,
  X_PROJECT_HANDLE,
  X_PROJECT_URL,
  ZAKURA_URL,
} from "@/lib/links";
import { PageHeader } from "@/components/PageHeader";

/**
 * What this site is, who runs it, and where its numbers come from.
 *
 * Written to answer the question a sceptical reader actually has — "can I trust these
 * figures?" — rather than to describe features they can see for themselves. So it states
 * the infrastructure plainly (one archive node, one box, no third-party index), names what
 * is deliberately absent, and says who is accountable.
 */
export function AboutPage() {
  return (
    <>
      <PageHeader
        eyebrow="ABOUT"
        title="A privacy-first Zcash explorer"
        lede="Most block explorers were built for transparent chains and treat Zcash as one that happens to have some missing columns. Shielded activity shows up as a blank cell, a zero, or a dash — as an absence of data rather than what it is: cryptography working exactly as designed. This explorer starts from the opposite premise."
      />

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="WHAT THIS DOES DIFFERENTLY">
          <div className="space-y-3 py-1 text-sm leading-relaxed text-ink-dim">
            <p>
              <span className="text-ink">A shielded value is never rendered as zero.</span> It is
              drawn as a redaction bar that says, in as many words, that the amount is encrypted
              on-chain and hidden by design. A zero is a claim about the amount; a blank is a claim
              that we should have had it.
            </p>
            <p>
              <span className="text-ink">Nothing is inferred about who paid whom.</span> Deciding
              which output of a transparent transaction is the payment and which is change is a
              guess — and it is the same guess chain-analysis firms make to deanonymise people.
              Transaction pages state what the chain says and stop there.
            </p>
            <p>
              <span className="text-ink">A figure we cannot measure says so.</span> When a price
              feed is cold or a fee cannot be derived, the page reads{" "}
              <span className="text-ink-faint">unavailable</span> — never a substituted zero, and
              never the redaction bar, which means something specific and must not be spent on an
              outage of ours.
            </p>
          </div>
        </Panel>

        <Panel title="WHERE THE NUMBERS COME FROM">
          <div className="space-y-3 py-1 text-sm leading-relaxed text-ink-dim">
            <p>
              Chain data is read from a <span className="text-ink">full Zcash archive node</span>{" "}
              run for this site — not from another explorer&rsquo;s API, and not from a hosted
              index. The node holds the entire chain from genesis, and a follower process walks it
              block by block into a database that backs the lists, the address history and the
              analytics.
            </p>
            <p>
              <span className="text-ink">Every transaction on Zcash has been indexed</span> —
              roughly 18 million of them, with their transparent inputs and outputs resolved, which
              is what makes per-transaction fees and address histories exact rather than estimated.
            </p>
            <p>
              Cross-chain figures come from the swap venues&rsquo; own public APIs. They cover
              public swap protocols only: custodial routes such as exchange withdrawals publish no
              per-transfer record, and aggregators are excluded because they settle on these same
              venues and would double every figure.
            </p>
            <p>
              Prices are the one thing that cannot come from the chain. Live quotes and historical
              daily closes come from public market data, each row stored with the source that
              supplied it — because there is no canonical daily ZEC price, and two reputable sources
              disagree by a couple of percent on the same day.
            </p>
          </div>
        </Panel>
      </div>

      <Panel title="POWERED BY ZAKURA" className="mt-3">
        <div className="flex flex-col gap-4 py-1 sm:flex-row sm:items-start">
          <a
            href={ZAKURA_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex shrink-0 items-center gap-2 text-sm text-ink hover:text-green"
          >
            <ZakuraMark size={40} />
            <span className="sr-only">Zakura (opens in a new tab)</span>
          </a>
          <p className="max-w-2xl text-sm leading-relaxed text-ink-dim">
            The node is{" "}
            <a
              href={ZAKURA_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-green hover:underline"
            >
              Zakura
            </a>
            , a consensus-compatible Zcash full node built for scale, running in archive mode. It is
            what makes a single-operator explorer viable: it syncs the full chain far faster than
            the alternatives and supports the current network upgrade, including the fourth shielded
            pool. Running our own node rather than querying someone else&rsquo;s is also a privacy
            property — no third party learns which blocks, transactions or addresses this
            site&rsquo;s visitors look at, because no third party is asked.
          </p>
        </div>
      </Panel>

      <Panel title="WHO RUNS IT" className="mt-3">
        <div className="max-w-2xl space-y-3 py-1 text-sm leading-relaxed text-ink-dim">
          {/* Handles only, no legal name or country: this page owes a reader one accountable
              person they can reach, and a handle supplies it. */}
          <p>
            <a
              href={X_AUTHOR_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-green hover:underline"
            >
              {X_AUTHOR_HANDLE}
            </a>{" "}
            — building and paying for it myself :)
          </p>
          <p>
            Site updates and findings are also posted at{" "}
            <a
              href={X_PROJECT_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-green hover:underline"
            >
              {X_PROJECT_HANDLE}
            </a>
            . If you notice any bugs or have any suggestions for improvements, tag either of these X
            accounts — I&rsquo;ll do my best to address the issue asap.
          </p>
        </div>
      </Panel>

      <Panel title="WHAT THIS WILL NEVER DO" className="mt-3">
        <div className="max-w-2xl space-y-3 py-1 text-sm leading-relaxed text-ink-dim">
          <p>
            <span className="text-ink">No viewing-key field.</span> A viewing key reveals an entire
            transaction history. Other explorers offer to decrypt your transactions if you paste one
            in; there is no such box here, not even a disabled one, because rendering the control at
            all teaches the habit. Never paste a viewing key into a website — including this one.
          </p>
          <p>
            <span className="text-ink">No linkability analysis.</span> Correlating shieldings with
            unshieldings to guess which pair belongs together is chain analysis, and offering it
            keylessly would let anyone run it on anyone.
          </p>
          <p>
            <span className="text-ink">No privacy score.</span> A single number stamped on a
            transaction or an address reads as a verdict, and the inputs to it would be guesses.
          </p>
          <p>
            <span className="text-ink">No tracking.</span> No cookies, no analytics script, no
            third-party requests from your browser. The{" "}
            <Link href="/privacy" className="text-green hover:underline">
              privacy page
            </Link>{" "}
            says exactly what that means and what is unavoidably processed anyway.
          </p>
        </div>
      </Panel>
    </>
  );
}
