import type { ReactNode } from "react";
import { CopyButton } from "@/components/CopyButton";
import { AnswerMarkdown } from "./AnswerMarkdown";
import { AgentSources } from "./AgentSources";
import { AgentTrail } from "./AgentTrail";
import type { Exchange } from "./exchange";

/**
 * One turn of the conversation: the question as typed, the trail of what Zeno did, the answer,
 * its sources, and the controls that act on it.
 */

export interface AgentExchangeProps {
  exchange: Exchange;
  /** The request for this turn is in flight. */
  live: boolean;
  /** Whether `edit` belongs here: the last turn, with no edit already pending. */
  editable: boolean;
  /** Any turn is running — `edit` waits for it, since editing mid-stream abandons a paid answer. */
  busy: boolean;
  /** Whether `ask again` belongs here: the last turn, settled, and worth retrying. */
  retryable: boolean;
  /** Draw a rule above this turn: every turn but the first. */
  separated: boolean;
  onEdit: () => void;
  onAskAgain: () => void;
  /** Zeno at work, for a phone — where the rail is only a bar. Shown while `live`. */
  stage?: ReactNode;
}

export function AgentExchange({
  exchange,
  live,
  editable,
  busy,
  retryable,
  separated,
  onEdit,
  onAskAgain,
  stage,
}: AgentExchangeProps) {
  const settled = exchange.status !== "streaming" && !live;
  const hasAnswer = exchange.answer.trim() !== "";
  return (
    // A rule above every turn but the first, and the strongest rule in the pane, since a turn
    // boundary must outweigh the divider above a turn's own sources.
    <article className={separated ? "border-t border-edge pt-6" : undefined}>
      {/* The question is the brightest ink in the turn: it is the reader's own words and what
          they scan for once turns stack up. It carries the prompt it was typed at — `you>` —
          and weight.

          `edit` sits on the question, not at the foot of the turn beside `copy`, where it
          read as an offer to edit the answer: a control's position is a claim about what it
          acts on. It shows for the last turn whether or not an answer arrived — a failed or
          cut-off question is the one you most want to change. */}
      <div className="flex items-start gap-3">
        <p className="min-w-0 flex-1 text-sm break-words text-ink-bright">
          <span className="text-green">you&gt;</span> {exchange.question}
        </p>
        {editable && (
          <button
            type="button"
            onClick={onEdit}
            disabled={busy}
            className="shrink-0 cursor-pointer text-xs text-ink-faint hover:text-green disabled:cursor-not-allowed"
            // Names the keyboard route too, so the shortcut is discoverable from the control
            // rather than only from a hint nobody reads.
            title="Change this question and ask again (↑ in an empty box)"
          >
            edit
          </button>
        )}
      </div>

      <div className="mt-3 space-y-3">
        {/* The steps, open while the turn runs and folded to one line afterwards. `live` comes
            from the request being in flight, not from `status`: a stream that ends without a
            `done` event leaves the status at "streaming" until `send` settles it. */}
        <AgentTrail
          steps={exchange.steps}
          live={live}
          prose={exchange.live}
          working={exchange.working}
        />

        {live && stage}

        {/* Only `answer` — never `answer + live`. A round's prose is not known to be the
            answer until the round ends, so the live tail is accumulated but not drawn; it
            commits into `answer` in `send`'s `finally`, so the answer appears once, whole,
            and never shrinks. The trail makes the wait legible.

            Labelled `zeno>` — the agent's prompt answering the reader's `you>` — or `zeno>
            couldn't answer`, dimmed, when the text is the server's unanswered closing rather
            than an answer. */}
        {hasAnswer && (
          <div>
            <div
              className={`mb-2 text-xs font-bold ${exchange.unanswered ? "text-warn" : "text-green"}`}
            >
              zeno&gt;{exchange.unanswered ? " couldn't answer" : ""}
            </div>
            <AnswerMarkdown text={exchange.answer} tone={exchange.unanswered ? "dim" : "normal"} />
          </div>
        )}
      </div>

      {exchange.note !== null && (
        <p
          className={`mt-3 text-xs ${exchange.status === "failed" ? "text-warn" : "text-ink-faint"}`}
        >
          {exchange.note}
        </p>
      )}

      {exchange.sources.length > 0 && <AgentSources sources={exchange.sources} />}

      {/* Copy, at the foot of the turn below its sources, once the turn has settled: beside a
          half-written answer it would copy half an answer. It is handed `exchange.answer`,
          the markdown source in full — never the rendered DOM — and withheld from the
          unanswered closing.

          `ask again` sends the same question in place of this turn, for an ending a retry can
          fix (`Exchange.retryable`). Words rather than a ↻, which is not in the self-hosted
          JetBrains Mono. */}
      {settled && ((hasAnswer && !exchange.unanswered) || retryable) && (
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-ink-faint">
          {hasAnswer && !exchange.unanswered && (
            <CopyButton value={exchange.answer} label="answer" withLabel />
          )}
          {retryable && (
            <button type="button" onClick={onAskAgain} className="btn btn-primary px-2.5 py-1">
              <span aria-hidden>&gt; </span>ask again
            </button>
          )}
        </div>
      )}
    </article>
  );
}
