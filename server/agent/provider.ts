/**
 * Which inference host the agent talks to, and what its request body may contain.
 *
 * The hosts disagree about the body in ways that fail silently, so each body is built separately:
 *
 *   · NEAR AI answers HTTP 200 to every unknown field and honours none of it (`provider`,
 *     `reasoning`, `usage`, `chat_template_kwargs`). Sending OpenRouter's
 *     `provider: { zdr, data_collection }` there would leave `/privacy` promising guarantees
 *     that are not on the wire. A field goes in a body only where the host acts on it.
 *   · `usage: { include: true }` yields no usage block on a NEAR stream; the OpenAI spelling
 *     `stream_options: { include_usage: true }` does. The daily budget is metered from that
 *     block, so the wrong spelling meters zero and leaves a keyless paid endpoint unmetered.
 *   · Some models reason by default and stream it as `reasoning_content`, which
 *     `parseSseStream` turns into a text-free heartbeat so a long think does not read as a
 *     stalled call and none of it reaches the answer. `chat_template_kwargs:
 *     { enable_thinking: false }` is not used: the model then writes its thinking into
 *     `content` behind a literal `</think>`, leaking it into the answer.
 *
 * The default is NEAR AI. OpenRouter stays as the rollback path, one env var away
 * (`AGENT_INFERENCE_PROVIDER=openrouter`), so a provider swap is revertible without a code change.
 */

export type ProviderId = "openrouter" | "near-ai";

export interface InferenceProvider {
  id: ProviderId;
  baseUrl: string;
  /**
   * The model id this host serves the agent from.
   *
   * NEAR's id is undated because NEAR publishes no dated variant. An alias can re-point beneath
   * you; the eval corpus, not the string, is what would catch that.
   */
  model: string;
  /** The env var holding this host's key. Named per host so one cannot authenticate at the other. */
  keyEnv: string;
  /** Human names for `/privacy` and `/ai-agent`; the frontend keeps its own copy in `src/lib/agent.ts`. */
  routerLabel: string;
  modelLabel: string;
}

export const PROVIDERS: Record<ProviderId, InferenceProvider> = {
  openrouter: {
    id: "openrouter",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "deepseek/deepseek-v4-pro-0813",
    keyEnv: "OPENROUTER_API_KEY",
    routerLabel: "OpenRouter",
    modelLabel: "DeepSeek V4 Pro",
  },
  "near-ai": {
    id: "near-ai",
    baseUrl: "https://cloud-api.near.ai/v1",
    // Not attested: NEAR's Incognito tier proxies this model to an external provider, and its
    // attestation endpoint answers 503. `/privacy` and `/ai-agent` say so (`AGENT_IS_ATTESTED` in
    // `src/lib/agent.ts`). Chosen for latency: attested models measured too slow for multi-call turns.
    // A hosted model's speed is a property of its host on the day it is measured, so re-measure
    // before switching.
    model: "deepseek/deepseek-v4.1-flash",
    keyEnv: "NEAR_AI_API_KEY",
    routerLabel: "NEAR AI Cloud",
    modelLabel: "DeepSeek V4.1 Flash",
  },
};

/**
 * Resolve the active provider from the environment.
 *
 * An unrecognised value throws rather than falling back: a typo that silently kept the old host
 * would send one host's key to the other and 401 every question, which reads as an outage.
 */
export function resolveProvider(
  env: Record<string, string | undefined> = process.env,
): InferenceProvider {
  const raw = env.AGENT_INFERENCE_PROVIDER;
  if (raw === undefined || raw === "") return PROVIDERS["near-ai"];
  const provider = PROVIDERS[raw as ProviderId] as InferenceProvider | undefined;
  if (provider === undefined) {
    throw new Error(
      `AGENT_INFERENCE_PROVIDER="${raw}" is not a provider — expected one of ${Object.keys(PROVIDERS).join(", ")}`,
    );
  }
  return provider;
}
