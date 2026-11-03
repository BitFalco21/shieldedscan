import type { BubblePage, BubbleSubject } from "./bubble-pages";

export interface ZenoBubbleChipProps {
  page: BubblePage;
  /** The composer is disabled while an answer streams, so there is nowhere to add to. */
  disabled: boolean;
  onAdd: (subject: BubbleSubject) => void;
}

/**
 * Where the reader is, and — on a page with a subject — a way to put it in the question.
 *
 * It says "on this page", not "Zeno sees": Zeno is sent nothing of the page (`bubble-pages.ts`).
 * The subject goes only into the composer, where the reader sees it before sending it.
 */
export function ZenoBubbleChip({ page, disabled, onAdd }: ZenoBubbleChipProps) {
  const subject = page.subject;
  return (
    <div className="flex flex-none items-center gap-3 border-b border-edge-faint px-4 py-1 text-xs">
      <p className="min-w-0 flex-1 truncate py-1 text-ink-faint">
        on this page: <span className="text-ink-dim">{page.label}</span>
      </p>
      {subject !== undefined && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => onAdd(subject)}
          className="shrink-0 cursor-pointer text-green hover:text-ink-bright disabled:cursor-not-allowed disabled:opacity-60 max-sm:min-h-11"
        >
          <span aria-hidden>+ </span>add to question
          <span className="sr-only">: {page.label}</span>
        </button>
      )}
    </div>
  );
}
