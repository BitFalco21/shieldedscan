import { isTestnet } from "@/lib/network";
import { X_PROJECT_HANDLE, X_PROJECT_URL } from "@/lib/links";
import { apiBaseUrl } from "@/lib/site";
import { AGENT_IS_ATTESTED, AGENT_MODEL_LABEL, AGENT_ROUTER_LABEL } from "@/lib/agent";

/**
 * What `/privacy` claims, as data — the page renders it, and the agent reads it.
 *
 * There is exactly one copy of these claims: `PrivacyPage` renders these strings, the agent's
 * `site_guide` 'privacy' section renders the same strings, and `privacy-facts.test.tsx` fails
 * when either stops containing one. A hand-written summary beside the page would be a second
 * copy of a legal claim, free to drift.
 *
 * Every claim the page makes about collection, processing, processors, egress, the legal basis
 * and rights lives here, and a new claim belongs here too. What stays in the page as ordinary
 * JSX is elaboration that asserts nothing about data we hold (the chain-data and changes
 * panels).
 *
 * Markup: the bodies are plain text with three markers, so one string serves a rendered page
 * and a text payload: `` `x` `` is a code span, `*x*` an emphasis, `[text](url)` a link.
 * `renderPrivacyText` draws them; `plainPrivacyText` strips them for the agent, keeping the
 * link text and dropping the URL, since `guard.ts` allowlists what an answer may link.
 */
export interface PrivacyClaim {
  /** Stable id — the test names a drifted claim by it, and the guide does not print it. */
  readonly id: string;
  /** The lead the page prints in ink. Short, and a claim in its own right. */
  readonly label: string;
  /** The rest of it. Markers as described above; never HTML. */
  readonly body: string;
}

/** The page's opening summary — the whole policy in three sentences. */
export const PRIVACY_SUMMARY =
  "This site sets no cookies, runs no analytics or tracking script, and writes one thing to your browser only if you ask it to: the colour theme you pick in the footer. It has no accounts and asks for no personal information. What follows is the honest remainder: the processing that happens anyway because a web request has to reach a server, who carries it, and what rights you have over it.";

/**
 * Who is responsible. Identification is by handle only: no personal name and no country of
 * residence appears here, which is also why the rights claim names no supervisory authority.
 * A test pins both absences.
 */
export const PRIVACY_OPERATOR: PrivacyClaim = {
  id: "operator",
  label: "Contact",
  body: `for any privacy question or request: [${X_PROJECT_HANDLE}](${X_PROJECT_URL}) on X. There is deliberately no contact form on this site, because a form is a way of collecting data and this site does not need one.`,
};

/** What this site does not do. */
export const PRIVACY_NOT_DONE: readonly PrivacyClaim[] = [
  {
    id: "no-cookies",
    label: "No cookies.",
    body: "Not for analytics, not for preferences, not “essential” ones. No response from this site carries a `Set-Cookie` header, which is why you have never seen a cookie banner here. There is nothing to consent to.",
  },
  {
    id: "no-analytics",
    label: "No analytics and no tracking script.",
    body: "No Google Analytics, no Plausible, no Fathom, no pixel, no beacon, no session recorder, no fingerprinting.",
  },
  {
    id: "one-storage-key",
    label: "One key in localStorage, and only if you ask.",
    body: "Choosing a colour theme in the footer stores its name under the key `theme` — nothing else, and nothing at all until you choose one. It is never sent to any server; switching back to the default removes it, as does clearing site data. Nothing is written to sessionStorage or IndexedDB, and the search palette keeps no history.",
  },
  {
    id: "no-accounts",
    label: "No accounts, no sign-in, no email collection.",
    body: "There is no newsletter and no waiting list. There are no API keys either — the public API is keyless, because a key would be an identifier and this site stores none.",
  },
  {
    id: "no-third-party-requests",
    label: "No third-party requests from your browser.",
    body: "Fonts, icons, logos and charts are served from this domain. A Content Security Policy enforces it: your browser is instructed to refuse connections to any origin except this site and this project’s own public API. Nothing you load here tells another company you were here.",
  },
  {
    id: "no-advertising",
    label: "No advertising, and no data is ever sold or shared",
    body: "for anyone else’s purposes.",
  },
];

/** The framing sentence above the processing list — an IP is personal data and cannot be avoided. */
export const PRIVACY_PROCESSED_INTRO =
  "To send you a page, a server has to receive a request from your *IP address*, along with whatever your browser sends with it — the page you asked for, your user agent, and possibly a referring URL. Under the GDPR an IP address is personal data. It is not possible to serve a website without processing one, and any site claiming otherwise is describing a wish.";

/**
 * What is processed anyway. The first claim is scoped to "this project's own servers": the
 * evidence behind it is the data API's reverse proxy and application, and Netlify keeps
 * records of its own that we cannot switch off. Dropping the scope would state the opposite.
 */
export const PRIVACY_PROCESSED: readonly PrivacyClaim[] = [
  {
    id: "no-access-logs",
    label: "This project’s own servers keep no access logs.",
    body: "The reverse proxy in front of the data API has request logging switched off outright — not truncated, not anonymised, discarded — and the API application logs only its own start-up and shutdown, never a request. There is deliberately no automatic IP-banning tool, because banning by address means writing addresses to disk. The website itself is served by Netlify, which keeps records of its own — described below.",
  },
  {
    id: "counters-in-memory",
    label: "Rate-limit counters are held in memory only.",
    body: "They are what stops one visitor overwhelming a single server, they are never written to disk, and they are gone when the process restarts.",
  },
  {
    id: "p2p-node-addresses",
    label: "The network crawler stores the addresses of Zcash nodes, never of visitors.",
    body: "To draw the node map, a crawler on this project’s own server performs the Zcash peer-to-peer handshake with every node address the network advertises to it — as every Zcash node does — and keeps those addresses with the country, city and network operator a GeoIP database assigns to them. They are the addresses of Zcash *nodes*, published by the network itself to anyone who asks, and have nothing to do with anyone reading this site. No page, API response or rendered element ever carries one: what leaves the server is a country, a network operator, a one-degree grid cell, a one-way hash. The GeoIP lookup runs on this project’s own server against a downloaded database, so no address is sent anywhere to be looked up.",
  },
  {
    id: "no-profile",
    label: "No profile is built.",
    body: "Nothing links one request to another, and there is no identifier — no cookie, no fingerprint, no account — that could make that possible even in principle.",
  },
];

/** The legal basis, named with its article. */
export const PRIVACY_LEGAL_BASIS =
  "The legal basis for this minimal processing is *legitimate interests* (GDPR Article 6(1)(f)): delivering the pages you asked for and keeping the service available. Your interests were weighed against it, which is precisely why the logging is off.";

/** The framing above the processor list. */
export const PRIVACY_PROCESSORS_INTRO =
  "Three infrastructure providers act as processors. None is asked to analyse anything about you, but each necessarily handles the connection, and each keeps its own operational records under its own policy. Nothing here is exported from those records, joined to them, or built into a report.";

/**
 * The providers that carry the request. No retention figure appears here, and none may be
 * added: Netlify's window is plan-dependent, so a number would silently become false.
 */
export const PRIVACY_PROCESSORS: readonly PrivacyClaim[] = [
  {
    id: "cloudflare",
    label: "Cloudflare",
    body: "sits in front of the website only — never the data API — to filter automated traffic, since 2026-09-07. Every request to the website passes through it, including the IP address it came from; it is a US company with its own data processing terms and its own records, none of which this project reads.",
  },
  {
    id: "netlify",
    label: "Netlify",
    body: "serves the website itself. Netlify is a US company, so serving a page to a visitor in Europe involves a transfer outside the EEA, made under the safeguards in Netlify’s own data processing terms. Netlify records each request it serves, including the IP address it came from, and makes a short recent window of them visible to this project in its dashboard — collection that no customer can switch off.",
  },
  {
    id: "netcup",
    label: "netcup",
    body: "provides the server in Vienna, Austria that runs the Zcash node, the database and the data API. That machine is inside the EU.",
  },
];

/** What is NOT involved — the claim that makes the list of three exhaustive. */
export const PRIVACY_PROCESSORS_OUTRO =
  "Nothing else is involved. There is no analytics service and no error-reporting service, and nothing sits in front of the data API at all.";

/** The framing above the egress list, and the reason the list exists at all. */
export const PRIVACY_EGRESS_INTRO =
  "These are the only interactions on the site that send anything beyond an ordinary page request. They are listed because a privacy page that omits them would be technically accurate and practically misleading.";

/**
 * The places data genuinely leaves the browser.
 *
 * `agentOnly` gates the AI-agent entry on the deployment's own flag, so the page's heading
 * count and the agent's own account of itself both derive from one list.
 */
export interface PrivacyEgressClaim extends PrivacyClaim {
  /** Present only where the agent is switched on for this deployment. */
  readonly agentOnly?: true;
  /** Present only on mainnet, where the page it describes exists. */
  readonly mainnetOnly?: true;
}

export const PRIVACY_EGRESS: readonly PrivacyEgressClaim[] = [
  {
    id: "search",
    label: "The search box.",
    body: "When what you type looks like a transaction id, an address or a block height, your browser asks this site’s own server whether it exists, so the dropdown can offer a real result rather than a guess. That request goes to this domain and nowhere else, and neither the query nor the result is stored. What you type is a chain identifier, not a search term — but if you would rather it never left your browser at all, a search only fires once the input looks like an identifier, so ordinary typing sends nothing.",
  },
  {
    id: "learn-check",
    mainnetOnly: true,
    label: "The learning page’s transaction check.",
    body: "On [/learn](/learn), checking a transaction ID asks this site’s own server what that transaction is, so the page can show what the blockchain shows about it. That request goes to this domain and nowhere else, and neither the ID nor the result is stored. It is optional: every step works without it, the practice simulator sends nothing at all, and the address check on the same page runs entirely in your browser.",
  },
  {
    id: "playground",
    label: "The API playground.",
    body: `On the API reference page, the “try it” control sends a request from your browser directly to \`${apiBaseUrl}\`. That is this project’s own keyless public API on the server described above, subject to the same no-logging rule. Nothing is proxied through a third party and no result is stored.`,
  },
  {
    id: "agent",
    agentOnly: true,
    label: "The AI agent.",
    body: `This is the only feature on the site that sends anything to a third party, and it is the most consequential entry on this page. If you use [/ai-agent](/ai-agent), or ask Zeno on the learning page, the text of your question — and any earlier turns in that conversation — is sent from your browser to this project’s API, and from there to *${AGENT_ROUTER_LABEL}*, which runs the *${AGENT_MODEL_LABEL}* model ${
      AGENT_IS_ATTESTED
        ? "inside a hardware trusted execution environment — an enclave the host itself is not supposed to be able to read into, and which publishes a signed attestation that anyone can check. That is a stronger arrangement than a promise not to retain your question, and it is why this site uses them. It is still *someone else’s computer*: they are a *separate controller*, the guarantee is theirs to keep, and this project can verify the attestation but not audit their operations on your behalf."
        : "in its *Incognito* tier. That means the model runs at an *external provider* outside NEAR’s trusted execution environment and publishes *no attestation*: NEAR AI states it retains nothing, and the external provider’s own terms govern what it receives. This is a *promise, not a proof*, and it is weaker than the attested arrangement this site last used until 2026-09-30, when it moved off it because NEAR’s enclave answered questions too slowly. Both NEAR AI and the external provider are *separate controllers*; this project can verify neither on your behalf, and it will move back to an attested model when one answers in reasonable time."
    } This project stores no part of the conversation: not the question, not the answer, not an identifier, and nothing survives closing the tab. It does keep one number — a daily total of how many questions were asked and what they cost — because that is what stops the agent spending past its budget. It records no request individually and nothing that could distinguish one asker from another, which is the same reason the rate-limit counters described above are allowed to exist. *Do not paste a viewing key, a seed phrase, or anything you would not publish.* If you would rather nothing left the site, do not use that page — everything else here works without it.`,
  },
  {
    id: "live-updates",
    label: "Live updates.",
    body: "The home page and the block, transaction and cross-chain lists refresh themselves while you watch, so a new block appears without a reload. To do that your browser asks this site’s own server for the newest rows every few seconds, for as long as the tab is visible. That request goes to this domain and nowhere else, it carries no identifier — only which filter the list is showing — and nothing about it is stored. It is also purely an addition: with JavaScript switched off every one of those pages still works, it simply shows the chain as it stood when the page loaded.",
  },
  {
    id: "external-links",
    label: "Links to other sites.",
    body: "Cross-chain transfers link out to the venue that recorded the far side of a swap. Following any external link is a visit to that site, governed by their policy, not this one. This site sends a restrictive referrer by default, and venue links are marked to send *no referrer at all*, so the venue is not told which page sent you.",
  },
];

/** The egress list for a deployment: the agent's entry appears only where the agent does. */
export const privacyEgressFor = (agentEnabled: boolean): readonly PrivacyEgressClaim[] =>
  PRIVACY_EGRESS.filter(
    (claim) =>
      (agentEnabled || claim.agentOnly !== true) && (!isTestnet || claim.mainnetOnly !== true),
  );

/**
 * Your rights. No identifier is stored, so the controller cannot identify a requester and is
 * not required to collect more data in order to (Article 11); the page says so rather than
 * promising a lookup it cannot perform. No supervisory authority is named, because naming one
 * would name a country.
 */
export const PRIVACY_RIGHTS: readonly string[] = [
  "Under the GDPR you have the right to access your personal data, to have it corrected or erased, to restrict or object to its processing, and to receive it in a portable form. You also have the right to lodge a complaint with a supervisory authority, and you may complain to the authority in your own country of residence.",
  "An honest caveat about exercising them here: because no identifier is stored, this project *cannot identify you* from a request and holds nothing to look up, correct, export or delete. GDPR Article 11 covers exactly this situation — a controller is not required to collect additional information purely to identify someone. In practice the answer to an access request will be that no data about you is held, and the way to verify that claim is this page describing a system that never stores it in the first place.",
  "There is no automated decision-making and no profiling. This site is not directed at children and does not knowingly process any child’s data — it collects no personal data from anyone.",
];

const MARKER = /`([^`]+)`|\*([^*]+)\*|\[([^\]]+)\]\(([^)]+)\)/g;

/**
 * One claim as plain prose: markers removed, link text kept, link TARGET dropped.
 *
 * The target is dropped rather than appended because this text goes to the agent, and a URL in
 * a payload is a URL a model may quote — `guard.ts` allowlists what an answer may link, and the
 * page guide already refuses to carry absolute URLs for the same reason.
 */
export const plainPrivacyText = (text: string): string =>
  text.replace(MARKER, (_m, code, emph, linkText) => code ?? emph ?? linkText);
