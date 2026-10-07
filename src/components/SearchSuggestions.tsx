import Link from "@/components/Link";
import type { SearchSuggestion } from "@/lib/search-suggestions";

export interface SearchSuggestionsProps {
  suggestions: SearchSuggestion[];
  /** Index of the keyboard-highlighted row, or -1 when the input itself holds focus. */
  activeIndex: number;
  /** Called when a row is chosen, so the parent can close itself. */
  onChoose: () => void;
  /** id of the listbox, referenced by the input's aria-controls. */
  id: string;
  /**
   * True while the resolver is being asked about these rows. Renders a "checking…" hint so the
   * eventual label upgrade ("— on chain") reads as an answer arriving, not as the first label
   * having been wrong.
   */
  checking?: boolean;
}

/**
 * The rows under a search input: what the typed text could resolve to, as real links.
 *
 * Real `<Link>`s rather than click handlers, so middle-click, ⌘-click, "copy link" and a
 * screen reader's link list all behave the way they do everywhere else on the site. The
 * ARIA pattern is a listbox with `aria-activedescendant` on the input, which is what lets
 * the input keep focus (so typing continues to work) while the highlight moves.
 */
export function SearchSuggestions({
  suggestions,
  activeIndex,
  onChoose,
  id,
  checking = false,
}: SearchSuggestionsProps) {
  if (suggestions.length === 0) return null;
  return (
    <ul id={id} role="listbox" aria-label="Search results" className="mt-2 flex flex-col gap-1">
      {suggestions.map((s, i) => (
        <li key={s.href} role="presentation">
          <Link
            id={`${id}-option-${i}`}
            role="option"
            aria-selected={i === activeIndex}
            href={s.href}
            // `prefetch={false}` is a privacy requirement: Next prefetches a Link as soon as it
            // renders, which would send a typed txid to the server before the reader clicked
            // anything — contradicting the palette's "nothing leaves this box".
            prefetch={false}
            onClick={onChoose}
            className={`flex items-baseline justify-between gap-3 rounded-sm border px-3 py-2 text-sm ${
              i === activeIndex
                ? "border-edge-strong bg-green-wash-strong text-ink-bright"
                : "border-edge-faint text-ink-dim hover:border-edge hover:text-ink"
            }`}
          >
            <span className="microlabel !text-[10px] whitespace-nowrap">
              {s.label}
              {checking && (
                // Static, no animation (reduced-motion is site policy anyway): the word
                // marks the row as provisional; its disappearance IS the state change.
                <span className="text-ink-faint normal-case"> · checking…</span>
              )}
            </span>
            <code className="min-w-0 truncate">{s.detail}</code>
          </Link>
        </li>
      ))}
    </ul>
  );
}
