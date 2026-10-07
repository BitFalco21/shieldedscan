import { CLAIM_GROUPS, CLAIMS } from "./claims";

/**
 * The page's outline: every claim, under its group, as a plain anchor link.
 *
 * The `/zips` and `/api-docs` sidebars' shape: with JavaScript off it is still a working menu,
 * and `ScrollSpy` stamps `aria-current="location"` on the link whose claim is on screen, which
 * the classes below light. No headings inside, so the page's heading outline is the claims'
 * own and nothing else.
 */
export function ClaimOutline() {
  return (
    <nav aria-label="Claims on this page" className="text-[13px] leading-snug">
      {CLAIM_GROUPS.map((group) => (
        <div key={group.id} className="mb-4 last:mb-0">
          <div className="microlabel text-ink-faint">{group.title}</div>
          <ul className="mt-2 space-y-1.5">
            {CLAIMS.filter((c) => c.group === group.id).map((claim) => (
              <li key={claim.id}>
                <a
                  href={`#${claim.id}`}
                  className="block border-l-2 border-transparent pl-2 text-ink-dim hover:text-green [&[aria-current]]:border-green [&[aria-current]]:text-green"
                >
                  {claim.claim}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
