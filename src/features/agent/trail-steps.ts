/**
 * The thinking trail's data: what a step is, the header's phase words, and the pure rules that
 * turn a turn's steps into drawn rows and a live line. Shared by the console's state
 * (`use-zeno-conversation`, `exchange`), Zeno's mood and the trail component.
 */

export interface AgentStep {
  /**
   * `narration` is the model's own working before a tool call — `label` then holds sanitised
   * model prose rather than a phrase we built, it arrives already ended (startedAt === endedAt),
   * and it carries no `tool` and no duration worth drawing.
   */
  kind: "thinking" | "lookup" | "answering" | "narration";
  /** The human phrase — "looking up the block". Built by the caller's `describeTool`. */
  label: string;
  /**
   * The tool's own name (`chain_activity`). Recorded, not drawn: the sanitised arguments beneath
   * each row say what was read more specifically than a name.
   */
  tool?: string;
  /**
   * What was looked up: "3428150", "7 days". Built server-side from the model's own arguments
   * and sanitised there (`describeToolCall`), so this is display-ready text and never markup.
   * Absent when the call had no subject, or when the API predates the field.
   */
  detail?: string;
  startedAt: number;
  /** Null while the step is the one in flight. */
  endedAt: number | null;
}

/**
 * The header's phase words. Each is a fact the console observes about our loop — a status event,
 * and whether a delta has arrived in the current round — never a claim about what the model
 * concluded.
 *
 * - `THINKING_FIRST`: the first round, no token yet.
 * - `THINKING_AGAIN`: a later round, no token yet — the tool results are in and the next call is
 *   about to read them.
 * - `WORKING`: tokens are arriving. Not "writing the answer": the server knows a round is the
 *   answering round only when it ends, so that word is not available live.
 */
export const THINKING_FIRST = "reading the question";
export const THINKING_AGAIN = "reading what came back";
export const WORKING = "working";

/** The one label the console uses for a `calculate` step. */
export const COMPUTING = "computing";

/**
 * The steps drawn as rows: a read, a calculation, or the model's narration between them — never
 * one of our own waits ("thinking", "answering").
 */
export function concreteSteps(steps: readonly AgentStep[]): AgentStep[] {
  return steps.filter((s) => s.kind === "lookup" || s.kind === "narration");
}

/** One drawn row: a lookup, a narration, or a narration leading the lookup that followed it. */
export interface StepGroup {
  narration?: AgentStep;
  step?: AgentStep;
}

/**
 * Pair each narration with the lookup immediately after it.
 *
 * The server emits the narration right before the `looking-up` status it preceded, so adjacency
 * in `steps` IS the relationship. A narration followed by anything else — another narration, or
 * nothing (working at the top of the answering round) — stands alone; a lookup with no sentence
 * before it stands alone. Never two narrations in one group, never one narration over two
 * lookups: a sentence may only be attached to the step the model wrote it for.
 */
export function groupSteps(steps: readonly AgentStep[]): StepGroup[] {
  const groups: StepGroup[] = [];
  for (const s of steps) {
    const last = groups[groups.length - 1];
    if (s.kind === "lookup" && last?.narration !== undefined && last.step === undefined) {
      last.step = s;
    } else if (s.kind === "lookup") {
      groups.push({ step: s });
    } else {
      groups.push({ narration: s });
    }
  }
  return groups;
}

/** Hard cap on the live working line, in characters. A line, not a paragraph. */
export const MAX_WORKING_EXCERPT_CHARS = 160;

/** Collapse to one printable line. Whitespace (newlines included) is whitespace, then collapsed. */
function oneLine(text: string): string {
  let clean = "";
  for (const ch of text) {
    if (/\s/.test(ch)) {
      clean += " ";
      continue;
    }
    const code = ch.codePointAt(0) ?? 0;
    if (code === 0xfffd || code < 0x20 || (code >= 0x7f && code <= 0x9f)) continue;
    clean += ch;
  }
  return clean.replace(/\s+/g, " ").trim();
}

/**
 * The live line. Two sources, held to different bounds because the answer must appear once, at
 * the end:
 *
 * - `working` is prose the server has flagged as working (`working` events). It is known not to
 *   be the answer, so the line may roll with it — the tail of the round so far, cut to start at
 *   a sentence — and keeps moving while the model writes.
 * - `prose` is the round's candidate answer (`delta` events). Until the round ends it may be the
 *   answer, so only its first sentence is shown, frozen.
 *
 * Both are already post-sanitiser; the job here is shape. Only a bounded prefix/suffix is
 * examined, so the cost per delta does not grow with the round. Rendered as a text node.
 */
export function workingExcerpt(prose: string, working = ""): string {
  if (working !== "") {
    const tail = oneLine((prose + working).slice(-(MAX_WORKING_EXCERPT_CHARS * 3)));
    if (tail.length <= MAX_WORKING_EXCERPT_CHARS) return tail;
    let cut = tail.slice(-MAX_WORKING_EXCERPT_CHARS);
    // Start at a sentence if one starts inside the window, else at a word.
    const sentence = cut.search(/[.?!] \S/);
    if (sentence !== -1) cut = cut.slice(sentence + 2);
    else {
      const word = cut.indexOf(" ");
      if (word !== -1) cut = cut.slice(word + 1);
    }
    return `…${cut.trimStart()}`;
  }
  let clean = oneLine(prose.slice(0, MAX_WORKING_EXCERPT_CHARS * 3));
  const end = clean.search(/[.?!](?=\s|$)/);
  if (end !== -1) clean = clean.slice(0, end + 1);
  if (clean.length > MAX_WORKING_EXCERPT_CHARS) {
    clean = `${clean.slice(0, MAX_WORKING_EXCERPT_CHARS - 1).trimEnd()}…`;
  }
  return clean.trim();
}

/**
 * The live header's phrase: the concrete action in flight, or the phase word for a wait of ours.
 *
 * A `lookup` in flight names itself with its subject. An `answering` step in flight means deltas
 * are arriving (the console opens it on the round's first delta) and reads `WORKING`. A
 * `thinking` step keeps the label the console gave it — `THINKING_FIRST` before any lookup,
 * `THINKING_AGAIN` after one. Anything else (no step yet) is the first wait.
 */
export function liveHeadline(steps: readonly AgentStep[]): string {
  const running = steps[steps.length - 1];
  if (running === undefined || running.endedAt !== null) return THINKING_FIRST;
  if (running.kind === "lookup") {
    return running.detail ? `${running.label} · ${running.detail}` : running.label;
  }
  if (running.kind === "answering") return WORKING;
  if (running.kind === "thinking") {
    return running.label === THINKING_AGAIN ? THINKING_AGAIN : THINKING_FIRST;
  }
  return THINKING_FIRST;
}
