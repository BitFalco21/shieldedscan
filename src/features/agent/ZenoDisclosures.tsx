import Link from "@/components/Link";
import { AGENT_IS_ATTESTED, AGENT_MODEL_LABEL, AGENT_ROUTER_LABEL } from "@/lib/agent";

/**
 * What Zeno will not do, and what leaves this site when you ask it something — the two
 * disclosures every place Zeno answers must carry. One component, so `/ai-agent` and the
 * `/learn` drawer cannot describe the same flow differently.
 *
 * No JavaScript: each is a `<details>` the reader controls. The attestation wording is decided
 * at build time from the flag.
 */
export function ZenoDisclosures() {
  return (
    <div>
      <Expander summary="what it will not do">
        <ul className="list-outside list-disc space-y-1.5 pl-4">
          <li>
            It will not handle a viewing key, and there is no field anywhere here to paste one into.
            A viewing key reveals an entire transaction history.
          </li>
          <li>
            It will not attempt linkability, clustering or deanonymisation — including guessing
            which output of a transparent transaction was the payment and which was change. That
            inference is not chain fact.
          </li>
          <li>It will not name the person, company or exchange behind an address.</li>
          <li>No privacy scores, no price predictions, and no investment advice of any kind.</li>
          <li>It will not help you build, sign or broadcast a transaction.</li>
        </ul>
        <p className="mt-3">
          It also will not invent a number. Anything about a specific block, transaction, address or
          balance comes from a lookup, and where the chain keeps a value encrypted it says so rather
          than reporting a zero. If it cannot find something, the honest answer is that it could not
          — and that is the answer you should get.
        </p>
      </Expander>

      <Expander summary="what leaves this site when you ask">
        <p>
          Your question, and the earlier turns of the same conversation, go from your browser to
          this project&rsquo;s API and from there to{" "}
          <span className="text-ink">{AGENT_ROUTER_LABEL}</span>, which runs{" "}
          <span className="text-ink">{AGENT_MODEL_LABEL}</span>
          {AGENT_IS_ATTESTED
            ? " inside a hardware enclave that publishes a signed attestation of what it is running. That is meant to put your question out of reach of the host itself, rather than resting on a promise not to keep it — which is why this site uses them rather than a general model API. It is still a separate company and still someone else’s machine: the guarantee is theirs to keep."
            : " in its Incognito tier: the model itself runs at an external provider, outside NEAR’s enclaves, and publishes no attestation. NEAR states it keeps nothing; the provider’s own terms apply to what it receives. This is a promise, not a proof. This site last ran an attested model until 2026-09-30 and moved off it because NEAR’s enclave answered too slowly; it will move back when an attested model answers in reasonable time."}
        </p>
        <p className="mt-3">
          Nothing is stored here: not the question, not the answer, not an identifier. Reloading the
          page clears the conversation and no copy of it survives. The one thing this site does
          record is a daily <span className="text-ink">count</span> of how many questions were asked
          and how many tokens they cost — that is what lets the agent stop before it runs past its
          budget for the day. It is a number, never a who, and it says nothing about any individual
          question. The full account is on the{" "}
          <Link href="/privacy" className="text-green hover:underline">
            privacy page
          </Link>
          .
        </p>
      </Expander>
    </div>
  );
}

interface ExpanderProps {
  summary: string;
  children: React.ReactNode;
}

/**
 * A `<details>` in the nav's command grammar. No JavaScript, keyboard-operable for free, and the
 * marker is the prompt's own `>`, turning down when open, rather than the browser's default
 * triangle — which differs per platform and would be the one un-styled glyph on the page. Sized
 * for the rail's narrow foot.
 * Deliberately not `data-popover`: this is content, and `DismissPopovers` must not close a
 * disclosure the reader opened because they clicked elsewhere.
 */
function Expander({ summary, children }: ExpanderProps) {
  return (
    <details className="group border-t border-edge-faint">
      <summary className="flex cursor-pointer list-none items-center gap-2 py-1.5 text-[11px] text-ink-dim hover:text-green [&::-webkit-details-marker]:hidden">
        {/* The prompt marker is the disclosure chevron: it turns down when open. A separate
            chevron at the far end would cost the width that keeps "what leaves this site when
            you ask" on one line in the 256px rail. */}
        <span
          aria-hidden
          className="inline-block text-green-dim transition-transform group-open:rotate-90 motion-reduce:transition-none"
        >
          &gt;
        </span>
        <span>{summary}</span>
      </summary>
      <div className="pb-2 pl-3 text-xs leading-relaxed text-ink-faint">{children}</div>
    </details>
  );
}
