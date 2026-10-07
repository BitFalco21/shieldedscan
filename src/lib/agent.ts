import { isTestnet } from "./network";

/**
 * The AI agent's single feature flag. Nothing else in `src/` reads
 * `NEXT_PUBLIC_AGENT_ENABLED`; it gates the route, the nav entry, the sitemap path and the
 * agent's data flow on `/privacy`.
 *
 * Absent means off. The value is set per deploy context in `netlify.toml`, never in the
 * Netlify dashboard, where an unscoped variable applies to every context. The API has its own
 * independent `AGENT_ENABLED`, so page and endpoint are switched on separately.
 *
 * Mainnet only: the testnet site builds in the same production context, so the flag alone
 * would turn the agent on there too, and the agent answers from `apiBaseUrl`, which is the
 * mainnet API on both deployments. Testnet would then serve mainnet figures under testnet
 * chrome.
 */
export const isAgentEnabled = process.env.NEXT_PUBLIC_AGENT_ENABLED === "1" && !isTestnet;

/** Where the browser POSTs a question. The keyless /v1 host, already in `connect-src`. */
export const agentAskUrl = (apiBaseUrl: string): string => `${apiBaseUrl}/agent/ask`;

/**
 * The model and its host, named on the page and on `/privacy` so a visitor knows a question
 * leaves for a third party before they type it.
 *
 * Edit together with `server/agent/provider.ts`, which is what is actually on the wire. The
 * frontend cannot import from `server/`, so this is a second copy by necessity, and naming the
 * wrong vendor would be a false privacy claim. `AGENT_IS_ATTESTED` gates the enclave wording,
 * so switching between an attested and an external model is a flag flip, not a prose edit.
 */
export const AGENT_MODEL_LABEL = "DeepSeek V4.1 Flash";
/** False while the model runs at an external provider outside NEAR's TEE. */
export const AGENT_IS_ATTESTED = false;
export const AGENT_ROUTER_LABEL = "NEAR AI Cloud";
