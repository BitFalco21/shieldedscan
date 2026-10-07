import Link from "@/components/Link";
import { AgentConsole } from "./AgentConsole";
import { ZenoDisclosures } from "./ZenoDisclosures";

/**
 * The /ai-agent page: Zeno's console, and nothing around it. The page header is the rail's ZENO
 * wordmark, the standing notice sits directly above the composer it is about, and the
 * disclosures live in the rail's foot behind `<details>` the reader controls, which needs no
 * JavaScript.
 *
 * The disclosures live in `ZenoDisclosures`, shared with the Zeno drawer on `/learn` so both
 * places say the same thing; the attestation wording is decided at build time like every other
 * flag-derived sentence.
 */
export function AgentPage() {
  return (
    <>
      <AgentConsole about={<ZenoDisclosures />} />

      <noscript>
        <p className="mt-3 text-xs text-ink-faint">
          Zeno needs JavaScript, because the answer streams in as it is written. The{" "}
          <Link href="/api-docs" className="text-green hover:underline">
            API reference
          </Link>{" "}
          answers the same questions without it.
        </p>
      </noscript>
    </>
  );
}
