import Link from "@/components/Link";
import { Unmeasured } from "@/components/Unmeasured";
import type { Claim } from "./claims";
import type { LiveFigure } from "./figures";
import { VerdictTag } from "./VerdictTag";

export interface ClaimEntryProps {
  claim: Claim;
  figures: readonly LiveFigure[];
}

/**
 * One claim: as it is usually made, the verdict, the short answer, what the chain says right
 * now where that bears on it, and where to check every sentence.
 *
 * The heading links to its own anchor so a single answer can be shared on its own —
 * `/fact-check#premine` — which is how a rebuttal actually travels.
 */
export function ClaimEntry({ claim, figures }: ClaimEntryProps) {
  return (
    <article id={claim.id} className="panel scroll-mt-20 p-5" data-claim={claim.id}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h3 className="max-w-2xl text-base font-bold text-ink-bright">
          <a href={`#${claim.id}`} className="hover:text-green">
            &ldquo;{claim.claim}&rdquo;
          </a>
        </h3>
        <VerdictTag verdict={claim.verdict} />
      </div>

      <div className="mt-3 flex max-w-3xl flex-col gap-2 text-sm leading-relaxed text-ink">
        {claim.answer.map((sentence) => (
          <p key={sentence}>{withUnbrokenDates(sentence)}</p>
        ))}
      </div>

      {figures.length > 0 ? (
        <dl className="mt-4 flex flex-col gap-1 border-t border-edge-faint pt-3 text-sm">
          {figures.map((figure) => (
            <div key={figure.label} className="flex flex-wrap gap-x-2">
              <dt className="microlabel pt-0.5 text-ink-faint">{figure.label}</dt>
              <dd className="tabular-nums">
                {figure.value === null ? (
                  <Unmeasured />
                ) : (
                  <span className="text-green" title={figure.exact}>
                    {figure.value}
                  </span>
                )}
                {/* Each "·"-separated phrase is one atom that never breaks; the row may wrap
                    between them, or long live figures overflow at 375px. */}
                {figure.readAt ? (
                  <span className="text-ink-faint">
                    {figure.readAt.split(" · ").map((part) => (
                      <span key={part}>
                        {" "}
                        <span className="whitespace-nowrap">{`· ${part}`}</span>
                      </span>
                    ))}
                  </span>
                ) : null}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      {/* Closed by default: the answer is the page and the sources are evidence to open. A
          native <details>, so it works without JavaScript; no `data-popover`, because an outside
          click must not close evidence someone opened. The group is named because each source
          link carries its own `group` for its hover. */}
      <details className="group/sources mt-4 border-t border-edge-faint pt-3">
        <summary className="flex cursor-pointer list-none items-center gap-2 select-none [&::-webkit-details-marker]:hidden">
          <span className="microlabel text-ink-faint">{`SOURCES · ${claim.sources.length}`}</span>
          <span
            aria-hidden
            className="inline-flex h-5 w-5 items-center justify-center rounded-sm border border-edge text-xs text-green"
          >
            <span className="group-open/sources:hidden">+</span>
            <span className="hidden group-open/sources:inline">-</span>
          </span>
        </summary>
        <ul className="mt-2 flex flex-col gap-1 text-xs">
          {claim.sources.map((source) =>
            source.href.startsWith("/") ? (
              <li key={source.href}>
                <Link href={source.href} className="text-ink-dim hover:text-green">
                  {source.label}
                </Link>
              </li>
            ) : (
              <li key={source.href}>
                <a
                  href={source.href}
                  rel="noreferrer"
                  target="_blank"
                  className="group text-ink-dim hover:text-green"
                >
                  <span>{source.label}</span>{" "}
                  <span aria-hidden className="text-ink-faint group-hover:text-green">
                    ↗
                  </span>
                  <span className="sr-only"> (opens a new tab)</span>
                </a>
              </li>
            ),
          )}
        </ul>
      </details>
    </article>
  );
}

/**
 * A date is one token and never breaks at its hyphens. Only the date is held together; the
 * sentence still wraps.
 */
function withUnbrokenDates(sentence: string) {
  return sentence.split(/(\d{4}-\d{2}-\d{2})/).map((part, i) =>
    i % 2 === 1 ? (
      <span key={i} className="whitespace-nowrap">
        {part}
      </span>
    ) : (
      part
    ),
  );
}
