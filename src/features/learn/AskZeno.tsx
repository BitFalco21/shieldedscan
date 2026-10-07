"use client";

import { useContext } from "react";
import { AskZenoContext } from "./zeno-context";

export interface AskZenoProps {
  /**
   * What is sent: a question the page wrote — about the concept on screen, a practice
   * transaction, or an example the page fetched. Never anything the reader pasted.
   */
  question: string;
  /**
   * A short label when the question is long — "explain this transaction" over a question that
   * spells the transaction out. The drawer's transcript always shows the question as sent.
   */
  label?: string;
}

/**
 * "zeno> …" — by default the question itself is the label. Pressing it asks it: the drawer opens
 * and the answer streams in beside the warning and the disclosure about where questions go.
 */
export function AskZeno({ question, label }: AskZenoProps) {
  const ask = useContext(AskZenoContext);
  if (ask === null) return null;
  const shown = label ?? question;
  return (
    <button
      type="button"
      aria-label={`Ask Zeno: ${shown}`}
      title={label === undefined ? undefined : question}
      onClick={() => ask(question)}
      className="inline-flex cursor-pointer items-baseline gap-1.5 text-left text-xs text-green-dim transition-colors hover:text-green"
    >
      <span aria-hidden className="font-bold">
        zeno&gt;
      </span>
      <span>{shown}</span>
    </button>
  );
}
