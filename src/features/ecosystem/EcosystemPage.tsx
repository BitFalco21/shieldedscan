import { PageHeader } from "@/components/PageHeader";
import { ECOSYSTEM_CATEGORIES, ECOSYSTEM_UPDATED_ON, ECOSYSTEM_ENTRIES } from "@/domain/ecosystem";
import { X_AUTHOR_HANDLE, X_AUTHOR_URL } from "@/lib/links";
import { EcosystemExplorer } from "./EcosystemExplorer";
import { ECOSYSTEM_LOGOS } from "./logos.generated";

/**
 * `/ecosystem` — the projects that build on, carry or serve Zcash, as a map a reader can move
 * around and a list grouped by category. Static: every figure is committed editorial data, so
 * there is nothing to fetch and nothing to go stale between deploys except the list itself,
 * which carries its check date.
 */
export function EcosystemPage() {
  return (
    <>
      <PageHeader
        eyebrow="ECOSYSTEM"
        title="The Zcash ecosystem"
        lede={
          <>
            {ECOSYSTEM_ENTRIES.length} projects that build on, carry or serve Zcash. Listing is not
            an endorsement or an audit.{" "}
            <span className="whitespace-nowrap">Last updated on {ECOSYSTEM_UPDATED_ON}.</span>
          </>
        }
      >
        {/* The list is editorial and will always lag the ecosystem, so the way to fix it sits
            where a reader notices the gap: under the title, before either view. A new tab and no
            referrer, as every link out of this page. */}
        <p className="mt-2 text-sm text-ink-dim" data-ecosystem-contact>
          Missing a project? Ask me on X at{" "}
          <a
            href={X_AUTHOR_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-green hover:underline"
          >
            {X_AUTHOR_HANDLE}
          </a>
          .
        </p>
      </PageHeader>

      <EcosystemExplorer
        categories={ECOSYSTEM_CATEGORIES}
        entries={ECOSYSTEM_ENTRIES}
        logos={[...ECOSYSTEM_LOGOS]}
        updatedOn={ECOSYSTEM_UPDATED_ON}
      />
    </>
  );
}
