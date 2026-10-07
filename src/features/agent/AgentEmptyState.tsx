import { AGENT_ALSO_READS, AGENT_EXAMPLES } from "./agent-examples";
import { Zeno } from "./Zeno";

/**
 * The console before the first question: runnable examples, and what else Zeno can read.
 *
 * Top-left, not centred, on a wide screen. A fresh shell puts its prompt at the top and leaves
 * the rest of the screen empty; centring this block made it read as a floating card in a void,
 * and the space below is legible as room for the conversation. On a phone it opens with Zeno
 * himself, because there the rail is only a slim bar and this is the first thing a reader sees.
 */

export interface AgentEmptyStateProps {
  onPick: (question: string) => void;
  disabled: boolean;
}

export function AgentEmptyState({ onPick, disabled }: AgentEmptyStateProps) {
  return (
    <div className="flex flex-none flex-col">
      {/* The phone hero. The wordmark here is decoration — the page's one <h1> is in the bar
          above — so it is hidden from assistive technology rather than read twice. */}
      <div className="flex flex-col items-center text-center lg:hidden">
        <Zeno className="w-[136px]" />
        <div className="microlabel mt-1.5">AI AGENT</div>
        <p aria-hidden className="zeno-wordmark zeno-crt mt-0.5 text-[52px]">
          ZENO
        </p>
        <p className="mt-2.5 text-[15px] font-bold text-ink-bright">ask the chain.</p>
        <p className="mt-1 max-w-[300px] text-xs leading-normal text-ink-dim">
          Blocks, pools, swaps, prices and ZIPs — looked up live, with sources.
        </p>
      </div>

      <div className="microlabel mt-5 lg:mt-0">TRY ONE</div>
      <ul className="mt-2.5 grid gap-2 lg:mt-3 lg:grid-cols-3 lg:gap-3">
        {AGENT_EXAMPLES.map((example) => (
          <li key={example.question} className="flex">
            {/* The border shows at rest, not only on hover: a phone has no hover, and the
                tiles would otherwise look like dim text rather than controls. */}
            <button
              type="button"
              disabled={disabled}
              onClick={() => onPick(example.question)}
              className="group flex w-full cursor-pointer items-start gap-2.5 rounded border border-edge-faint px-3 py-2.5 text-left hover:border-edge-strong disabled:cursor-not-allowed lg:min-h-[108px] lg:flex-col lg:gap-2.5 lg:px-3.5 lg:pt-3.5 lg:pb-4"
            >
              <span aria-hidden className="flex shrink-0 items-center gap-2 pt-0.5 lg:pt-0">
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="shrink-0 text-green-dim"
                >
                  <path d={example.icon} />
                </svg>
                <span className="microlabel hidden lg:inline">{example.topic}</span>
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span aria-hidden className="microlabel text-[9.5px] lg:hidden">
                  {example.topic}
                </span>
                <span className="flex gap-2 text-[13px] leading-relaxed text-ink group-hover:text-ink-bright lg:text-[13.5px]">
                  <span
                    aria-hidden
                    className="hidden text-green/60 group-hover:text-green lg:inline"
                  >
                    &gt;
                  </span>
                  <span>{example.question}</span>
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>

      {/* Points at the composer, which is the one thing the examples cannot teach: that the box
          below is yours to type in. One dim line, in the notice's own voice. */}
      <p className="mt-3.5 text-xs text-ink-faint">
        <span aria-hidden className="text-green/50">
          #{" "}
        </span>
        or type your own question below
      </p>

      <div className="microlabel mt-6 lg:mt-8">ZENO ALSO READS</div>
      <ul className="mt-2.5 flex flex-wrap gap-1.5 lg:gap-2">
        {AGENT_ALSO_READS.map((subject) => (
          <li
            key={subject}
            className="rounded-sm border border-edge-faint px-2 py-0.5 text-[11px] text-ink-dim lg:text-[11.5px]"
          >
            {subject}
          </li>
        ))}
      </ul>
    </div>
  );
}
