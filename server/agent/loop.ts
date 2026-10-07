import {
  DELIBERATION_RETRY_NOTICE,
  MACHINERY_RETRY_NOTICE,
  looksLikeToolCallMarkup,
  namesOurMachinery,
  narrationText,
  prepareHistory,
  readsAsDeliberation,
  splitLeadingWorking,
  StreamSanitizer,
  type AskMessage,
} from "./guard";
import type { ChatMessage, ChatStreamer, CompletionParams, StreamEvent } from "./chat-client";
import type { AskPage } from "./ask-pages";
import { pageContext } from "./page-context";
import { SYSTEM_PROMPT, turnContext } from "./prompt";
import { resolveProvider } from "./provider";
import { describeToolCall, sourceLinkFor, type AgentTools, type SourceLink } from "./tools";

/**
 * The bounded tool loop: model → tools → model, with hard ceilings on everything that could
 * otherwise run away. Emits the SSE-shaped events the route serialises; holds no state between
 * turns — history arrives from the browser and tool results are deliberately not replayed into
 * later turns.
 */

export const MAX_TOOL_CALLS_PER_TURN = 4;
/**
 * Per model call, not per turn: a turn may make up to `MAX_MODEL_CALLS` of them, and usually only
 * the last is prose.
 *
 * Sized for the answers this agent is actually asked for — multi-window tables in ZEC and dollars
 * — not from short samples. A cut-off answer is worse than a long one: the last thing a grounded
 * answer says is often a refusal, and a half-stated refusal reads as a hedge.
 *
 * Two things bound it:
 *  - Every completion token can be answer text, and the browser replays each answer as history,
 *    so the cap must stay under `MAX_ASSISTANT_MESSAGE_CHARS` or the site's own longest answers
 *    would 400 on the follow-up. `loop.test.ts` pins that relationship, and the dependent
 *    constants (`MAX_ASSISTANT_MESSAGE_CHARS`, `MAX_NARRATION_CHARS`, `MAX_ASK_BODY_BYTES`,
 *    `TURN_TIMEOUT_MS`) move with it.
 *  - The daily budget, not this cap, bounds spend. A per-turn cap that truncates only decides
 *    whether the same tokens go to finished answers or to halves of them.
 */
export const MAX_OUTPUT_TOKENS = 4_000;
/** Model calls per turn: every useful path is ≤ tool executions + a forced-prose round. */
const MAX_MODEL_CALLS = MAX_TOOL_CALLS_PER_TURN + 2;

export type AgentEvent =
  | {
      event: "status";
      data:
        | { state: "thinking" }
        /**
         * `detail` is the subject of the call ("3428150", "7 days") from the model's own arguments,
         * sanitised and capped by `describeToolCall`. It turns the thinking trail from a list of tools
         * into a list of lookups.
         *
         * Optional, and absent rather than empty when there is nothing to say (`wrapped_zec_pools` takes
         * no arguments; a malformed argument string has no readable subject). The browser treats absence
         * as valid, so an older deployment loses the subject, never the row.
         */
        | { state: "looking-up"; tool: string; detail?: string };
    }
  | { event: "delta"; data: { text: string } }
  /**
   * The round's prose once it has started reading as working (`readsAsDeliberation`), streamed as it
   * arrives for the trail's live line. The gate below withholds `delta` so self-talk can never stand
   * as the answer; this carries the same text on a different event, which keeps that guarantee: the
   * client routes it only into the trail's live line, so it cannot reach `answer`, the replayed
   * history or the copy button. Same sanitised stream as `delta`. An older console drops it as
   * unknown.
   */
  | { event: "working"; data: { text: string } }
  /**
   * Discard everything drawn so far. Emitted when a turn produced prose and then called a tool: that
   * prose is preamble ("I'll look up that block."), not answer. A round is only known to be a tool
   * call once it ends, so it cannot be suppressed server-side without giving up streaming; the page
   * clears instead. A sanitised copy follows as a `narration` event, so the discard is from the
   * answer only; the trail keeps the working.
   */
  | { event: "reset"; data: Record<string, never> }
  /**
   * The model's own working, for the thinking trail: one per tool-call round, emitted after that
   * round's `reset` and before its first `looking-up` status. Always post-`narrationText` (sanitised,
   * whitespace-collapsed, printable-only, capped), so nothing here is fetchable however an injected
   * string phrased itself and the client may render it as a plain text node. Never part of the
   * answer: the client routes it into the trail, away from `answer`, the replayed history and the
   * copy button.
   */
  | { event: "narration"; data: { text: string } }
  | { event: "sources"; data: { sources: SourceLink[] } }
  | {
      event: "done";
      data: {
        stopReason: "complete" | "length" | "tool-limit";
        /**
         * Set only on `unansweredEnding`: the text before this `done` is our closing, not an answer, so
         * the console must not present it as one. A separate key rather than a fourth stop reason, because
         * deployed consoles ignore unknown keys but would read an unknown reason as a truncation.
         */
        unanswered?: true;
      };
    };

export interface AgentLoopDeps {
  streamer: ChatStreamer;
  tools: AgentTools;
  /** Called once per model call with its usage block — the budget meters from this. */
  onUsage?: (usage: { promptTokens: number; completionTokens: number }) => void;
  /**
   * Observer for the model's text before the sanitiser sees it. Production passes nothing, and that
   * absence is the security property: raw text is deliberately not an `AgentEvent`, so there is no
   * path by which it reaches the SSE route or a browser. A `raw` event would hand the exfiltration
   * channel back to an injected instruction.
   *
   * It exists because the sanitiser and the eval have different jobs. The sanitiser protects the
   * visitor and deletes `![…](…)` outright; the eval measures the model, and an injection case can
   * only tell obedience from refusal by reading what the model actually wrote.
   */
  onRawText?: (text: string) => void;
  model?: string;
  /**
   * How long a model call may produce nothing before it is abandoned and retried once. Injectable
   * for tests; production takes `STALL_RETRY_MS`. A stalled call often answers the identical question
   * in seconds on retry, so the stall must be detected well inside the turn budget.
   */
  stallRetryMs?: number;
  /**
   * How long a model call that has produced output may then go silent before it is abandoned.
   * Injectable for tests; production takes `MODEL_IDLE_MS`. Silence is what a hang looks like;
   * elapsed time is not, so this, rather than a turn-wide wall clock, bounds a provider that hangs
   * mid-stream.
   */
  modelIdleMs?: number;
  /**
   * The clock `turnContext` resolves "today" against, injectable like `AgentTools`' clock: an eval
   * case about "last week" has no fixed expected answer unless the run can pin the date.
   */
  now?: () => number;
}

/**
 * How long a model call may yield nothing before it is abandoned and retried.
 *
 * A stall window is a claim about the provider's first-token latency, so a model swap invalidates
 * it: too short, and healthy calls are abandoned as stalls. `loop.test.ts` pins it against the
 * worst measured round of the model in service. The cost: a genuinely dead call waits this long
 * before its one retry.
 */
export const STALL_RETRY_MS = 30_000;

/**
 * How long a model call may go silent after it has started producing output before the call is
 * abandoned. A healthy stream delivers a token every few hundred milliseconds and a tool round trip
 * inside this service is well under a second, so 20 s of nothing is a hang, not a long answer.
 *
 * An idle call is retried once, sharing the stall clock's single retry: nothing a round streams is
 * committed until `done`, so the round is re-run after a `reset` takes back the trail's live line.
 * The retry happens in `runAgentTurn`, which knows what was emitted; `callModelOnce` throws
 * `ModelIdle`.
 */
export const MODEL_IDLE_MS = 20_000;

/** Thrown internally when a model call produced no event inside the stall window. */
class ModelStall extends Error {
  constructor() {
    super("model call produced nothing inside the stall window");
  }
}

/** Thrown internally when a model call went silent mid-stream for longer than the idle window. */
class ModelIdle extends Error {
  constructor() {
    super("model call went silent mid-stream for longer than the idle window");
  }
}

/**
 * One model call, retried at most once, and only when it produced nothing.
 *
 * "Nothing" is the safety argument: no event reached the caller, so no token reached a visitor and
 * no tool call was half-assembled, and retrying cannot duplicate output (every tool is a read
 * anyway). Two failure shapes qualify: an immediate throw (fetch error, non-2xx), and a silent
 * stall, detected by racing the first event against `stallRetryMs`. Once anything has arrived the
 * stream is never retried here, but every later event is raced against `modelIdleMs`, so a
 * provider that hangs mid-answer is abandoned instead of holding a slot until the outer wall clock.
 * A slow tail that keeps producing tokens is never cut.
 *
 * `retryState` is shared across the turn's rounds so a turn retries once in total: a host sick
 * enough to stall twice should fail loudly rather than double every round's worst case.
 */
async function* callModelOnce(
  deps: AgentLoopDeps,
  params: CompletionParams,
  outerSignal: AbortSignal,
  retryState: { used: boolean },
): AsyncGenerator<StreamEvent> {
  const stallMs = deps.stallRetryMs ?? STALL_RETRY_MS;
  const idleMs = deps.modelIdleMs ?? MODEL_IDLE_MS;
  for (;;) {
    // A private controller per attempt, chained to the caller's: aborting a stalled attempt
    // must not abort the turn, but an aborted turn must abort the attempt.
    const attempt = new AbortController();
    const onAbort = () => attempt.abort();
    outerSignal.addEventListener("abort", onAbort, { once: true });
    let sawEvent = false;
    try {
      const iterator = deps.streamer(params, attempt.signal)[Symbol.asyncIterator]();
      for (;;) {
        let timer: NodeJS.Timeout | undefined;
        const pending = iterator.next();
        // The racing promise's rejection must not become unhandled when the stall wins.
        pending.catch(() => {});
        // Before the first event the window is the (retriable) stall clock; after it, the
        // (non-retriable) idle clock. Both are "no event for N ms", measured per event.
        const windowMs = sawEvent ? idleMs : stallMs;
        const next = await Promise.race([
          pending,
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(sawEvent ? new ModelIdle() : new ModelStall()),
              windowMs,
            );
          }),
        ]).finally(() => clearTimeout(timer));
        if (next.done) return;
        sawEvent = true;
        yield next.value;
      }
    } catch (error) {
      attempt.abort();
      const retriable = !sawEvent && !outerSignal.aborted && !retryState.used;
      if (!retriable) throw error;
      retryState.used = true;
    } finally {
      outerSignal.removeEventListener("abort", onAbort);
    }
  }
}

/**
 * The turn's closing when the model's own words are unusable — twice degenerate, or twice empty.
 * Ours, deterministic, never a third model call; names the reader-facing pages consulted and no
 * figure (see the degenerate-twice branch in `runAgentTurn`).
 */
function* unansweredEnding(consulted: SourceLink[]): Generator<AgentEvent> {
  const looked =
    consulted.length === 0
      ? ""
      : ` I did read ${listPhrase(consulted.map((s) => s.label))}, so the data is there;`;
  yield {
    event: "delta",
    data: {
      text:
        `I could not put that answer into words.${looked}` +
        ` the failure is on my side, not the chain's.` +
        ` Ask again, or narrow it to a single figure — that usually works.`,
    },
  };
  yield { event: "sources", data: { sources: consulted } };
  yield { event: "done", data: { stopReason: "complete", unanswered: true } };
}

export async function* runAgentTurn(
  deps: AgentLoopDeps,
  history: AskMessage[],
  signal: AbortSignal,
  /** The page the question was asked from, when the request names one (`page-context.ts`). */
  page: AskPage | null = null,
): AsyncGenerator<AgentEvent> {
  const leading: ChatMessage[] = [
    // System prompt first: fixed content leads the array so prompt caching covers it.
    { role: "system", content: SYSTEM_PROMPT },
    // The calendar, second and separate (see `turnContext`): it changes every day, so folding it into
    // `SYSTEM_PROMPT` would break the cached prefix and put a volatile value in a constant that must
    // hold none.
    { role: "system", content: turnContext((deps.now ?? Date.now)()) },
    // The page the question came from, third and only when named: after the cached prefix for the
    // calendar's reason, and absent for the console so its requests are unchanged.
    ...(page === null ? [] : [{ role: "system" as const, content: pageContext(page) }]),
  ];
  /**
   * How many leading messages are ours rather than the conversation's. A retry notice is spliced in
   * after them (below); appended instead, it makes the model continue writing instructions rather
   * than answer.
   */
  const systemMessageCount = leading.length;
  const messages: ChatMessage[] = [
    ...leading,
    // `prepareHistory` is the deterministic half of the user-turn defence: it labels an output-format
    // directive and re-sanitises assistant turns the browser sent back. Called here rather than in
    // `parseAskBody` because the eval runner builds its history directly and never touches the body
    // parser; this is the one place every caller passes through.
    ...prepareHistory(history).map((m): ChatMessage => ({ role: m.role, content: m.content })),
  ];

  let sanitizer = new StreamSanitizer();
  const endpoints: string[] = [];
  /*
   * Whether this turn is answering a question about the API, which changes what counts as our
   * plumbing leaking. Once `site_guide` has run, "the payload" is the ordinary word for the thing
   * under discussion. Tool names stay forbidden regardless — none of them is English.
   */
  let apiAnswer = false;
  let toolBudget = MAX_TOOL_CALLS_PER_TURN;
  const retryState = { used: false };
  /*
   * The deliberation retry is its own budget, separate from `retryState`, which covers a call that
   * produced nothing. This covers a call that produced the wrong kind of something — a stream of
   * tokens the stall clock cannot see. One retry per turn: a model that degenerates twice on the
   * same question will not be argued out of it, and no answer beats a third attempt on the visitor's
   * clock.
   */
  let deliberationRetryUsed = false;
  /** One more, for a final round that ends with no text at all — see the answering branch. */
  let emptyRoundRetryUsed = false;

  yield { event: "status", data: { state: "thinking" } };

  for (let call = 0; call < MAX_MODEL_CALLS; call++) {
    const params: CompletionParams = {
      // Resolved here rather than at import: the model belongs to the host, and a second copy in
      // prompt.ts could send one vendor's id to the other.
      model: deps.model ?? resolveProvider().model,
      messages,
      // Once the budget is spent the model is offered NO tools, which forces prose.
      tools: toolBudget > 0 ? deps.tools.defs() : [],
      maxTokens: MAX_OUTPUT_TOKENS,
    };

    let final: Extract<StreamEvent, { type: "done" }> | null = null;
    let emittedText = false;
    /*
     * The round's raw prose, and whether it has started reading as deliberation.
     *
     * Judged on the raw text because the tells are words, and the sanitiser's job is URLs. Checked
     * incrementally so that once a round has turned, nothing further from it reaches the page; the
     * decision is taken below, where the round's shape (tool call or answer) is known.
     */
    let roundText = "";
    let deliberating = false;
    // One attempt per pass; only a mid-stream idle runs a second (see the catch).
    for (;;) {
      final = null;
      emittedText = false;
      roundText = "";
      deliberating = false;
      try {
        for await (const event of callModelOnce(deps, params, signal, retryState)) {
          if (event.type === "content") {
            // Before the sanitiser, and never as an event — see `onRawText`.
            deps.onRawText?.(event.text);
            roundText += event.text;
            if (!deliberating && readsAsDeliberation(roundText)) deliberating = true;
            const safe = sanitizer.push(event.text);
            if (safe !== "") {
              if (deliberating) {
                // Known working: to the trail's live line, never to the answer (see `working`).
                yield { event: "working", data: { text: safe } };
              } else {
                emittedText = true;
                yield { event: "delta", data: { text: safe } };
              }
            }
          } else if (event.type === "reasoning") {
            // A heartbeat only: it has already reset the clocks inside `callModelOnce`, and must
            // not stand in for the round's final event.
          } else {
            final = event;
          }
        }
        break;
      } catch (error) {
        /*
         * A call that went silent mid-stream is re-run once, on the stall retry's terms: nothing of
         * it is committed, because the answer renders only at `done`. The trail's live line is taken
         * back with a `reset`, the attempt's buffers are dropped, and the same round runs again with
         * the same tools. Shares the stall retry's one-per-turn budget.
         */
        if (error instanceof ModelIdle && !retryState.used && !signal.aborted) {
          retryState.used = true;
          if (emittedText) yield { event: "reset", data: {} };
          sanitizer = new StreamSanitizer();
          yield { event: "status", data: { state: "thinking" } };
          continue;
        }
        /*
         * Any other round cut off mid-stream (the wall clock fired, the idle retry was already spent,
         * or the visitor left) never reaches the answering-round check below. Its prose is the last
         * thing the reader sees, so it is judged the same way: if it reads as deliberation (e.g. the
         * preamble to a tool call that was never made), the page is told to take it back and the
         * visitor gets the console's honest "did not answer". Prose that reads as a genuine partial
         * answer is left standing — a partial answer is never reported as no answer. `deliberating`
         * is cumulative over the round, so it also covers prose that began as an answer and turned,
         * after deltas reached the page.
         *
         * Yielded before the rethrow: the route's catch still writes its error event afterwards, and
         * the client reconciles both.
         */
        if (emittedText && deliberating) {
          yield { event: "reset", data: {} };
        }
        throw error;
      }
    }
    if (final?.usage != null) deps.onUsage?.(final.usage);

    if (final === null || final.toolCalls.length === 0) {
      /*
       * An empty answering round is re-asked once, with the tool results kept.
       *
       * A final model call can return zero tokens after every lookup succeeded — invisible to both
       * silence clocks because the call ended. Asking again costs one model call and no tool calls
       * (tools are stripped: the round had everything and wrote nothing). Its own budget, separate from
       * the transport and deliberation retries, so one turn cannot spend three extra calls.
       */
      if (roundText.trim() === "" && final !== null) {
        if (!emptyRoundRetryUsed) {
          emptyRoundRetryUsed = true;
          toolBudget = 0;
          yield { event: "status", data: { state: "thinking" } };
          continue;
        }
        // Twice empty: close in our own words rather than in silence, as the degenerate-twice path does.
        yield* unansweredEnding(dedupeSources(endpoints));
        return;
      }
      /*
       * Working at the top of the answer is split off, not discarded with it.
       *
       * Models often write a line of working above a complete, correct answer. Discarding the whole round
       * for that head would throw away a good answer, and the retry may come back worse. So the round is
       * first tried as working + answer, by content: the working goes to the trail as a `narration` row,
       * and only the body is published. `splitLeadingWorking` refuses the shapes the guard exists for (a
       * long head, a mid-answer correction, no real body), which still fall through to discard-and-retry.
       * The body is held to the other two checks itself: a preamble naming a tool is what the trail is
       * for; an answer naming one is still a leak.
       */
      const split = deliberating ? splitLeadingWorking(roundText) : null;
      if (
        split !== null &&
        !namesOurMachinery(split.answer, apiAnswer) &&
        !looksLikeToolCallMarkup(split.answer)
      ) {
        // Deltas stopped at the tell, so the page may hold the head's first words: take them back.
        sanitizer = new StreamSanitizer();
        if (emittedText) yield { event: "reset", data: {} };
        const narration = narrationText(split.working);
        if (narration !== "") yield { event: "narration", data: { text: narration } };
        // The raw observer already saw the whole round, and the eval runner clears its raw accumulator on
        // `narration`, so the body is re-supplied as the raw text that is the answer. Production passes no
        // observer.
        deps.onRawText?.(split.answer);
        const body = sanitizer.push(split.answer) + sanitizer.flush();
        yield* finishTurn(body, endpoints, answeredStopReason(final));
        return;
      }
      /*
       * The answering round, and the only place `readsAsDeliberation` is consulted (see its comment for
       * why that scoping is what makes it safe). A round with no tool calls has nothing left to look up,
       * so "let me check" there is not preamble.
       *
       * A round that deliberates, names our machinery or emits tool-call markup is discarded whole and
       * re-asked, never edited: a false positive costs one model call, a true positive costs the visitor
       * nothing. `deliberating` is decided while streaming; the machinery check runs here because it is
       * about the finished text — a tool name can appear in the last clause. The reasons share one retry
       * because a round that is both is one bad round, and two retries would double the worst case.
       */
      const leaksMachinery = namesOurMachinery(roundText, apiAnswer);
      // A round that emitted its own tool-call scaffolding produced no answer at all — the most
      // clear-cut of the three, and invisible to the sanitiser because the markers are not tags.
      const emittedMarkup = looksLikeToolCallMarkup(roundText);
      if (deliberating || leaksMachinery || emittedMarkup) {
        // Same two conditions as the tool-call branch below: the buffer is always dropped, and `reset` is
        // emitted only if the page actually drew something to take back.
        sanitizer = new StreamSanitizer();
        if (emittedText) yield { event: "reset", data: {} };
        if (!deliberationRetryUsed) {
          deliberationRetryUsed = true;
          /*
           * Inserted into the system block, never appended, and the position decides whether the retry
           * helps. As the last message before the model's turn, a system notice reads as something to keep
           * writing: the model continues it with invented instruction-shaped prose instead of answering.
           * After the prompt and the calendar it is part of the standing instructions. It costs the cached
           * prefix only on a retry, a turn already paying for an extra model call.
           */
          messages.splice(systemMessageCount, 0, {
            role: "system",
            content: deliberating ? DELIBERATION_RETRY_NOTICE : MACHINERY_RETRY_NOTICE,
          });
          // No tools on the retry: the round already had everything it needed and answered badly, so the
          // only thing left is to write prose.
          toolBudget = 0;
          yield { event: "status", data: { state: "thinking" } };
          continue;
        }
        /*
         * Twice: the model's own words are unusable, so the turn closes in ours.
         *
         * Silence is the wrong ending. A capability gap makes the model flail, the flailing trips these
         * guards, and an empty reply would turn a reportable limit ("it said it cannot do X") into
         * something that reads as an outage, so the visitor retries forever and never learns the limit.
         * An unanswered turn is our own failure and is named as one.
         *
         * Deterministic, never a third model call: two failed rounds are the evidence that asking again is
         * not the fix. It states no figure, and it names the reader-facing pages consulted, never a tool
         * or a path.
         */
        yield* unansweredEnding(dedupeSources(endpoints));
        return;
      }
      yield* finishTurn(sanitizer.flush(), endpoints, answeredStopReason(final));
      return;
    }

    /*
     * Prose before a tool call is preamble, not answer. Two conditions, and they are not the same:
     *
     *   - Any prose at all means the sanitiser must be recreated: it holds back the trailing
     *     non-whitespace run, which would otherwise be emitted as the first characters of the next
     *     round. The deliberation guard can suppress a round's deltas entirely, so prose can exist
     *     with nothing drawn; keying this on `emittedText` would leak the buffer.
     *   - Something actually drawn is what needs taking back, so `reset` is keyed on that.
     */
    if (roundText !== "") sanitizer = new StreamSanitizer();
    if (emittedText) yield { event: "reset", data: {} };
    /*
     * The preamble the reset just took out of the answer goes to the trail instead, through
     * `narrationText`. Here rather than while streaming, because this is the first point the round is
     * known to be preamble; regardless of `deliberating`, because deliberation-shaped prose is what a
     * thinking trail exists to show. One per round, before the first `looking-up` status, so the trail
     * reads: working, then the step.
     */
    if (roundText !== "") {
      const narration = narrationText(roundText);
      if (narration !== "") yield { event: "narration", data: { text: narration } };
    }

    // Echo the assistant's tool_calls message back, per the chat-completions contract.
    messages.push({
      role: "assistant",
      content: null,
      tool_calls: final.toolCalls.map((c) => ({
        id: c.id,
        type: "function" as const,
        function: { name: c.name, arguments: c.arguments },
      })),
    });

    for (const toolCall of final.toolCalls) {
      if (signal.aborted) return;
      if (toolBudget <= 0) {
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content:
            "tool budget for this turn is exhausted — answer from what you already have, and say plainly what you could not look up",
        });
        continue;
      }
      toolBudget--;
      // Before the dispatch, so the subject is on screen while the fetch is in flight. The arguments are
      // the model's, so `describeToolCall` sanitises them; the key is omitted when there is no subject,
      // since an empty string and an absent one read alike to a consumer.
      const detail = describeToolCall(toolCall.name, toolCall.arguments);
      yield {
        event: "status",
        data: {
          state: "looking-up",
          tool: toolCall.name,
          ...(detail === null ? {} : { detail }),
        },
      };
      if (toolCall.name === "site_guide") apiAnswer = true;
      const result = await deps.tools.dispatch(toolCall.name, toolCall.arguments);
      endpoints.push(...result.endpoints);
      messages.push({ role: "tool", tool_call_id: toolCall.id, content: result.content });
    }

    /*
     * The round is over and the model is about to read what came back, so say so.
     *
     * One per round, after every tool in it: the results arrive in one message list and produce one
     * next model call, so a status per tool would claim round-trips that did not happen. At the end of
     * the loop body so the answering round (which returns from the `toolCalls.length === 0` branch)
     * never gets a trailing "thinking" that would leave the trail's last step open.
     *
     * The same `thinking` state rather than a new wire value: it is the same fact (a model call is about
     * to be made), and an older console renders a plainer row instead of an unknown one.
     *
     * It is a fact about our execution, never the model's reasoning, which stays off so deliberation
     * can never be published as the answer.
     */
    yield { event: "status", data: { state: "thinking" } };
  }

  // A model that keeps demanding tools it no longer has. Stop it rather than loop.
  yield* finishTurn(sanitizer.flush(), endpoints, "tool-limit");
}

type StopReason = Extract<AgentEvent, { event: "done" }>["data"]["stopReason"];

/** How an answering round ended: cut by the output cap, or finished. */
function answeredStopReason(final: Extract<StreamEvent, { type: "done" }> | null): StopReason {
  return final?.finishReason === "length" ? "length" : "complete";
}

/** The end of every answered turn: the answer's last text, its sources, then `done`. */
function* finishTurn(
  tail: string,
  endpoints: readonly string[],
  stopReason: StopReason,
): Generator<AgentEvent> {
  if (tail !== "") yield { event: "delta", data: { text: tail } };
  yield { event: "sources", data: { sources: dedupeSources(endpoints) } };
  yield { event: "done", data: { stopReason } };
}

/**
 * "a", "a and b", "a, b and c" — a list for one sentence of our own prose. The unanswered-turn
 * closing is the one piece of text on this surface the model did not write, so it has to read like
 * a sentence rather than a joined array.
 */
function listPhrase(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** One source per PAGE, first label wins — two endpoints about one tx are one citation. */
function dedupeSources(endpoints: readonly string[]): SourceLink[] {
  const byHref = new Map<string, SourceLink>();
  for (const endpoint of endpoints) {
    const link = sourceLinkFor(endpoint);
    if (link !== null && !byHref.has(link.href)) byHref.set(link.href, link);
  }
  return [...byHref.values()];
}
