import type { ChatStreamer, CompletionParams, StreamEvent } from "../chat-client";
import type { EvalCase } from "./cases";

/**
 * A stand-in model for checking the runner's wiring with no key and no provider: it makes a case's
 * `route` calls in one round, then answers with a fixed sentence. Everything it measures is our own
 * side — dispatch, timing, the summary — so a scripted run says nothing about how fast or how well
 * the real model answers. A case with no route is answered at once.
 */
export function scriptedStreamerFor(testCase: EvalCase): ChatStreamer {
  return async function* (params: CompletionParams): AsyncGenerator<StreamEvent> {
    const route = testCase.route ?? [];
    const hasResults = params.messages.some((m) => m.role === "tool");
    if (route.length > 0 && !hasResults && params.tools.length > 0) {
      yield {
        type: "done",
        finishReason: "tool_calls",
        toolCalls: route.map((call, i) => ({
          id: `scripted-${i}`,
          name: call.name,
          arguments: JSON.stringify(call.args),
        })),
        usage: null,
      };
      return;
    }
    yield { type: "content", text: "Scripted answer." };
    yield { type: "done", finishReason: "stop", toolCalls: [], usage: null };
  };
}

/**
 * Whether a tool answer is a dispatch failure of ours rather than data: an argument the tool
 * refused, or a tool that does not exist. A fixture world's `<unavailable>` block is not one — it is
 * the world lacking a figure, which the route test reports separately.
 */
export function isDispatchFailure(content: string): boolean {
  return /^(?:unknown tool:|invalid arguments)/i.test(content.trimStart());
}
