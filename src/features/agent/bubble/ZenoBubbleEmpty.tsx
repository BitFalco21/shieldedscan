import { Zeno } from "../Zeno";
import type { BubbleSuggestion } from "./bubble-pages";

export interface ZenoBubbleEmptyProps {
  suggestions: readonly BubbleSuggestion[];
  onPick: (suggestion: BubbleSuggestion) => void;
  disabled: boolean;
}

/**
 * The panel before the first question: Zeno at rest, and three questions for this kind of page.
 * One line of copy, which closes the gap the chip leaves open: Zeno knows only what is sent.
 */
export function ZenoBubbleEmpty({ suggestions, onPick, disabled }: ZenoBubbleEmptyProps) {
  return (
    <div className="flex flex-col">
      <div className="flex flex-col items-center text-center">
        <Zeno className="w-[104px]" />
        <p className="mt-2 text-xs text-ink-faint">Zeno only sees what you send.</p>
      </div>

      <div className="microlabel mt-4">TRY ONE</div>
      <ul className="mt-2 grid gap-2">
        {suggestions.map((suggestion) => (
          <li key={suggestion.question} className="flex">
            <button
              type="button"
              disabled={disabled}
              onClick={() => onPick(suggestion)}
              // A question naming the page's subject goes to the box, not the model: say so.
              title={suggestion.send ? undefined : "Puts the question in the box for you to send"}
              className="group flex min-h-11 w-full cursor-pointer items-start gap-2 rounded border border-edge-faint px-3 py-2 text-left text-[13px] leading-relaxed text-ink hover:border-edge-strong hover:text-ink-bright disabled:cursor-not-allowed"
            >
              <span aria-hidden className="text-green/60 group-hover:text-green">
                &gt;
              </span>
              <span className="min-w-0 break-words">{suggestion.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
