import { API_CONVENTIONS, API_GROUPS, curlCommand, type ApiEndpoint } from "@/api-catalogue";
import { ADDRESS_LABELS, type LabelledBalance, type LabelledBalances } from "@/domain";
import { formatZec } from "@/lib/format";
import { asRecord } from "./tools/json";
import { DONATION_ADDRESS } from "@/lib/donation";
import { STATIC_PATHS } from "@/app/sitemap";
import { REACHABLE_WINDOW_SEC } from "../netmap/snapshot";
import {
  PRIVACY_EGRESS_INTRO,
  PRIVACY_LEGAL_BASIS,
  PRIVACY_NOT_DONE,
  PRIVACY_OPERATOR,
  PRIVACY_PROCESSED,
  PRIVACY_PROCESSED_INTRO,
  PRIVACY_PROCESSORS,
  PRIVACY_PROCESSORS_INTRO,
  PRIVACY_PROCESSORS_OUTRO,
  PRIVACY_RIGHTS,
  PRIVACY_SUMMARY,
  plainPrivacyText,
  privacyEgressFor,
  type PrivacyClaim,
} from "@/content/privacy-facts";

/**
 * What this site publishes and what its API contract says: the committed half of `site_guide`.
 *
 * Every fact here is read from the source that already owns it, never restated beside it, so the
 * agent cannot carry a drifting second copy of a contract:
 *
 *  - the live `/v1` descriptor answers rate limits, conventions, refusals and the endpoint list;
 *  - `API_GROUPS`, the catalogue `/api-docs` renders, answers per-endpoint detail, so the agent
 *    and the reference page cannot disagree about a parameter;
 *  - `STATIC_PATHS`, the list `sitemap.ts` publishes, enumerates the pages, so the page guide
 *    cannot fall behind the site.
 *
 * The one thing written here is a sentence per page saying what a reader finds there, and
 * `site-guide.test.ts` fails when a path in `STATIC_PATHS` has none.
 */

export interface PageEntry {
  /** What a reader finds there. One sentence; this is a guide, not the page's own copy. */
  readonly what: string;
}

/** The crawler's answering window in words, read from the API's own constant so this guide and
 * the page it describes cannot state two windows. */
const ANSWERING_WINDOW = `${REACHABLE_WINDOW_SEC / 3600} hours`;

/**
 * A sentence per public page, keyed by the path `sitemap.ts` publishes.
 *
 * Keyed by that list rather than hand-enumerated: with a separate list, a new page would silently
 * never appear in an answer, which reads as the page not existing. The coverage test is the
 * mechanism.
 *
 * `/mining` and `/v1` are deliberately absent, as they are from the sitemap: describing an
 * unlisted page to a visitor is the same act as listing it for indexing.
 */
export const SITE_PAGES: Readonly<Record<string, PageEntry>> = {
  "/": {
    what: "The homepage: chain tip, market cap, 24h transaction count and fully-shielded share, plus a search box that takes a block height, a block hash, a txid or an address.",
  },
  "/blocks": { what: "The most recent blocks, newest first, with miner, size and privacy mix." },
  "/txs": {
    what: "The most recent transactions, newest first, filterable by privacy kind — transparent, shielded, shielding, unshielding, coinbase.",
  },
  "/shielded": {
    what: "The shielded pools: every value pool's total balance, the shielded share of supply, and where the Ironwood pool's balance came from.",
  },
  "/cross-chain": {
    what: "ZEC crossing to and from other chains through public swap venues, filterable by direction, venue, counterpart chain and value at swap.",
  },
  "/cross-chain/flows": {
    what: "The same crossings as a Sankey diagram per direction, with a per-chain table and trend, over a selectable window.",
  },
  "/cross-chain/protocols": {
    what: "The same crossings per protocol — NEAR Intents, Maya Protocol and THORChain side by side: swaps inbound and outbound, ZEC crossed, the venues' own swap-time dollars, each protocol's share, its counterpart chains with their volume and its largest swap, over a selectable window.",
  },
  "/compare": {
    what: "ZEC valued at another asset's market capitalisation: pick an asset and the page states what one ZEC would be worth if Zcash reached that asset's market cap. It is an arithmetic comparison, never a forecast, and it refuses stablecoins and any asset it will not compare against rather than silently substituting one.",
  },
  "/compare/all": {
    what: "The same comparison as /compare, for every asset larger than Zcash at once: one row per asset with its market capitalisation, how many times Zcash's that is, and what one ZEC would be worth at it. Each row links to that asset's full comparison. Arithmetic over published market caps, never a forecast or a price target.",
  },
  "/stats": {
    what: "The ZEC price on its own, as one large figure stamped with the block height and the instant it was read at, with a chart over 24 hours to all time. Built to be linked and screenshotted; the companion page /stats/shielded states the shielded supply the same way.",
  },
  "/stats/shielded": {
    what: "How much ZEC sits in the shielded pools, as one large figure, with its share of circulating supply, each pool's balance, and how much crossed into shielded today. The companion of /stats, which states the price the same way.",
  },
  "/halving": {
    what: "Every Zcash halving so far, with the block subsidy either side of it and the ZEC close on the day it landed. The page draws no line between a halving and a price in either direction — it states both and stops.",
  },
  "/mining-cost": {
    what: "What it costs in electricity alone to mine one ZEC in each of about 140 countries, on a zoomable world map: the country's published business or household tariff times the kilowatt-hours one Antminer Z15 Pro spends per ZEC at the current network solution rate, with the break-even tariff at today's price and a calculator for the reader's own tariff. Electricity only, so the real cost is higher — hardware, hosting, cooling and pool fees are excluded — and the tariffs are GlobalPetrolPrices.com's quarterly averages, re-read monthly with the read date printed.",
  },
  "/satoshi": {
    what: "A slot machine where every pull draws a real random Bitcoin key in the visitor's browser and compares its address to the genesis-block address; the key is printed on every pull as proof the attempt was real. The odds are about 1 in 2^160, and the page's point is that Zcash publishes no address, balance or history to aim at — the lock is the same size, the vault is invisible.",
  },
  "/fact-check": {
    what: "Common claims about Zcash answered one by one, each with a verdict — false, misleading, outdated, partly true or unfounded — a short answer and the primary sources it rests on: whether Zcash was premined, whether 20% of every block goes to insiders, whether its hidden inflation is unverifiable, what the trusted setup could and could not do, whether anyone uses shielding, whether the 2018 study broke its privacy, how it compares with Monero and why criminals favour Monero, what viewing keys are, who runs it, and the claim that it is an intelligence project. It concedes what is true — two counterfeiting bugs existed, in Sprout and in Orchard — and shows the live pool balances beside the answers they bear on.",
  },
  "/pulse": {
    what: "The chain as stocks and flows, live: each value pool and the transparent ledger drawn at the size of what it holds at one named block, ribbons for how much has crossed each boundary over a window, and a mark for every confirmed movement as its block lands — plus pending transactions from this node's mempool, a heartbeat of block arrival intervals and a replay of the last 24 hours. It states no conservation: a balance is a stock at a height and a ribbon is gross flow over a window, two different rulers, so a ribbon never touches a box.",
  },
  "/network/map": {
    what: `The Zcash network's listening nodes on a world map, measured by this explorer's own crawler: how many answered a peer-to-peer handshake in the last ${ANSWERING_WINDOW} (only nodes that accept connections can be counted — a node behind a router is invisible to any crawler, so the real network is bigger), how many addresses the network has ever advertised to it, and one mark per one-degree square of answering nodes — the software's own logo under the software lens, or a colour for hosting network or for the share of our crawls a node answered. Locations are a GeoIP database's claim about an address, never a measurement; no page names a node, only countries, network operators, cells and one-way hashes.`,
  },
  "/network/software": {
    what: "Which implementations the answering nodes run — Zebra, Zakura, zcashd — as a share of the answering set, how often each answers a crawl, which releases are out there with the newest SEEN tagged, and which protocol versions the handshake declared. Every figure is what a node said about itself; a user agent is not verified.",
  },
  "/network/upgrade": {
    what: `Whether the answering nodes run software that can follow NU7 on mainnet. A node counts as ready only when it declares protocol version 170190 or higher (ZIP 259's minimum) AND runs a release whose own notes set the mainnet activation height; the protocol version alone is not readiness, because Zakura 1.5.0 and later already declare 170190 while their notes leave NU7 unscheduled. Until the mainnet height is assigned (on October 20) no release can carry it, so the ready count is zero by construction. It also counts nodes behind our tip — the height a node declared against the height our own node had when it answered, the one measured figure on the tab — and draws all three as a share of the answering nodes, day by day, since the crawler began recording on 2026-10-03.`,
  },
  "/network": {
    what: "Who told us about whom: the gossip graph as a sky, answering nodes as hubs settled by a force layout and every advertised address that never answered hanging off the peers that advertised it. Every line is an advertisement ('this node told us about that address'), never a live connection — the crawl cannot see connections at all.",
  },
  "/network/health": {
    what: "How concentrated the answering nodes' hosting is (grouped by autonomous system, never clustered into operators, so the real concentration can only be higher), how often nodes answer our crawls (low for any node already connected to our own node, which turns the crawler away), and what a crawler cannot see said plainly — never-answered addresses, untried IPv6, nodes behind NAT. There is deliberately NO health score: each figure carries its own denominator.",
  },
  "/network/nodes": {
    what: `Every node that answered a handshake in the last ${ANSWERING_WINDOW}, one row each, most-answering first: software and version, GeoIP city and country, hosting network, handshake latency measured by our crawler, the share of our crawls it answered (low for any node already connected to our own node, which turns the crawler away because they share an address), and when it last answered. Filterable by software and by hosting network; a row is a one-way hash of the address and nothing on it can be reversed into one.`,
  },
  "/rich-list": {
    what: "The largest transparent ZEC holders, ranked by balance, with each address's transaction count, its share of supply and its balance in dollars where a price is measured — plus the distribution of holders across balance bands. TRANSPARENT ADDRESSES ONLY: a shielded balance is encrypted by design and no rich list can or should include one, so this is a ranking of the public part of the chain and never of Zcash's wealth.",
  },
  "/mempool": { what: "Unconfirmed transactions waiting to be mined, with their privacy mix." },
  "/reorgs": {
    what: "Chain rollbacks this explorer's own node observed, since a stated date — one node's view, not a network census.",
  },
  "/analytics": {
    what: "Network activity over time: transactions per month, shielded share, gross shielding and unshielding flows, and what a transaction costs by privacy kind.",
  },
  "/charts": { what: "The individual time-series charts, each with its own range control." },
  "/api-docs": {
    what: "The public API reference: every endpoint with its parameters, a pinned example, a runnable curl command and a try-it playground that calls the API from your browser.",
  },
  "/mcp": {
    what: "How to connect an AI assistant to this explorer's MCP server at api.shieldedscan.xyz/mcp: tools covering every public API endpoint plus a glossary and dated Zcash reference, keyless and read-only, with setup steps for Claude, Claude Code, ChatGPT, Cursor and VS Code, the full tool list and the rate limits.",
  },
  "/donate": { what: "The operator's donation address, with a copy button and a QR code." },
  "/learn": {
    what: "A beginner's guide from no ZEC to a first shielded transaction. A practice simulator with test ZEC walks through buying on an exchange (most only send to transparent addresses, so the reader withdraws to a t1 address and shields; an exchange that accepts shielded addresses is the second run), sending privately and unshielding, showing beside each step what anyone watching the chain can see and what the exchange knows. Then the real steps: the reader pastes their own address or transaction ID and the page shows what the blockchain publishes about it, telling them which steps they can skip. The address check runs in the browser; a transaction check asks this site's server and stores nothing. Zeno narrates the practice's guided run (a fixed script, not the model) and answers questions from a drawer on the page, with the same rules and disclosures as /ai-agent; its buttons ask, in one press, a question the page wrote — about a concept, a practice transaction, or an example transaction the page fetched from the chain (whose ID goes along) — never an address or transaction ID the reader pasted.",
  },
  "/zips": {
    what: "Every numbered Zcash Improvement Proposal — title, category and status as each ZIP's own header states them, refreshed from github.com/zcash/zips and linking to each proposal's canonical page on zips.z.cash.",
  },
  "/ecosystem": {
    what: "The projects that build on, carry or serve Zcash — wallets, exchanges and swaps, payments, mining pools, nodes and infrastructure, explorers and data, developer tools, organisations and community — as a map (2D or 3D, searchable) and a list, each linking to the project's own site. An editorial list with a check date: listing is not an endorsement or an audit, and a missing project can be reported to @0xfalcoo on X.",
  },
  "/about": { what: "What this explorer is and what it is trying to do differently." },
  "/brand": { what: "The site's palette, marks and downloadable brand assets." },
  "/privacy": {
    what: "What this site does and does not collect: no visitor logs, no cookies, no trackers, and the named third parties a request unavoidably passes through.",
  },
  "/terms": {
    what: "Terms of use: what this explorer provides, on what basis, and the limits of relying on it.",
  },
  "/ai-agent": {
    what: "This page — the conversational answerer, and what leaves the site when you ask it something.",
  },
};

/** Every catalogued endpoint, flattened out of its documentation groups. */
export const apiEndpoints = (): readonly ApiEndpoint[] => API_GROUPS.flatMap((g) => g.endpoints);

/**
 * One endpoint by path or by catalogue id, or null.
 *
 * Matched leniently: a visitor asks about "blocks" or "/v1/blocks/{heightOrHash}" or "the block
 * endpoint". A miss returns null and the caller lists what exists rather than guessing the nearest
 * one, because answering about the wrong endpoint is worse than answering about none.
 */
export function findApiEndpoint(query: string): ApiEndpoint | null {
  const q = query
    .trim()
    .toLowerCase()
    .replace(/^get\s+/, "");
  if (q === "") return null;
  const all = apiEndpoints();
  const path = (e: ApiEndpoint) => e.path.toLowerCase();
  return (
    all.find((e) => path(e) === q || e.id.toLowerCase() === q) ??
    all.find((e) => path(e) === `/v1/${q.replace(/^\/+/, "")}`) ??
    // Template-insensitive: "/v1/blocks/1234" should find "/v1/blocks/{heightOrHash}".
    all.find((e) => new RegExp(`^${path(e).replace(/\{[^}]+\}/g, "[^/]+")}$`).test(q)) ??
    null
  );
}

const paramLine = (p: ApiEndpoint["params"][number]): string =>
  `    - ${p.name} (${p.kind}, ${p.type}${p.required ? ", required" : ", optional"}): ${p.description}`;

/** One endpoint as the model reads it — the same facts `/api-docs` renders, from the same source. */
function renderApiEndpoint(endpoint: ApiEndpoint): string {
  const parts = [
    `${endpoint.method} ${endpoint.path} — ${endpoint.title}`,
    endpoint.description,
    endpoint.params.length === 0
      ? "  parameters: none"
      : `  parameters:\n${endpoint.params.map(paramLine).join("\n")}`,
    // Built by the catalogue's own helper, the string `/api-docs` puts on its copy button, so an agent
    // answer and the reference page hand a reader the same command. The docs e2e checks it with
    // `bash -n`.
    `  example request: ${curlCommand(endpoint)}`,
    `  example response:\n${endpoint.exampleResponse}`,
  ];
  if (endpoint.notes && endpoint.notes.length > 0) {
    parts.push(`  notes:\n${endpoint.notes.map((n) => `    - ${n}`).join("\n")}`);
  }
  return parts.join("\n");
}

const GUIDE_NOTICE = `These are this site's own committed facts about itself — its pages, its privacy policy and its published API contract — read from the same sources the site renders from, not from memory. State them plainly. For anything not here, say so and point at the page that would have it rather than describing a page or a parameter that may not exist.`;

/** The page guide: what this site publishes and where. */
export function renderPages(): string {
  const rows = STATIC_PATHS.filter((p) => p in SITE_PAGES)
    .map((p) => `- ${p} — ${SITE_PAGES[p]!.what}`)
    .join("\n");
  return (
    `<site-guide section="pages">\n${GUIDE_NOTICE}\n` +
    `These are the pages this explorer publishes. Link one as a relative path (\`/shielded\`), never as a full URL, and never name a page that is not on this list. When your answer is ABOUT one of these pages, link it in the answer itself — a reader asking where something is should be able to click through to it rather than be told a path to type.\n` +
    `${rows}\n- /ai-agent — ${SITE_PAGES["/ai-agent"]!.what}\n${DONATION_FACT}\n</site-guide>`
  );
}

/**
 * The donation address, given rather than withheld.
 *
 * It is a committed constant (`src/lib/donation.ts`), the same single source the page renders and
 * the QR generator round-trips before writing. Ours, frozen and reviewable in a diff, so there is
 * no reason to send a reader to `/donate` instead of answering.
 *
 * The failure mode is money, so there are two guards: the model is told to reproduce the address
 * exactly and never elide it (the usual `c860a7e8…` treatment would be catastrophic here), and to
 * link /donate in the same answer so the reader has a canonical copy, with a copy button and QR,
 * to check against.
 */
const DONATION_FACT =
  `- The donation address for this explorer is \`${DONATION_ADDRESS}\` — a unified address, committed in this site's own source and rendered on /donate. ` +
  `Give it in FULL and exactly as written when asked, never elided, abbreviated or re-typed from memory, and link /donate in the same answer so the reader can verify it against the copy button and QR code there. If you cannot reproduce it exactly, give the /donate link alone.`;

/**
 * The API reference detail for one endpoint, or the catalogue's index when the query matches none.
 *
 * A miss lists what exists, because "which endpoint gives me X" is the commonest form of the
 * question. It is also the honest answer to a made-up endpoint name: the reply contains only real
 * paths.
 */
export function renderApiEndpointSection(query: string | null): string {
  const found = query === null ? null : findApiEndpoint(query);
  const body =
    found !== null
      ? renderApiEndpoint(found)
      : `No catalogued endpoint matches ${query === null ? "(no endpoint given)" : `"${query}"`}. The full list, which is every endpoint that exists:\n` +
        apiEndpoints()
          .map((e) => `- ${e.method} ${e.path} — ${e.title}`)
          .join("\n");
  const conventions = API_CONVENTIONS.map((c) => `- ${c.title}: ${c.body}`).join("\n");
  return (
    `<site-guide section="api-endpoint">\n${GUIDE_NOTICE}\n${body}\n\n` +
    `Contract conventions, true of every endpoint:\n${conventions}\n` +
    `The full reference, with a runnable playground, is at /api-docs.\n</site-guide>`
  );
}

/**
 * What this site's privacy policy says, read from the page's own claims, never restated.
 *
 * Without the page's text the model answers a privacy question from memory, and it will invent
 * plausible claims — a retention window, "no third party sees your request" — on the one page
 * whose entire value is that it is true. Every claim here is the string the page itself renders
 * (`src/content/privacy-facts.ts`), and `privacy-facts.test.ts` fails if either side stops
 * carrying one.
 */
export function renderPrivacy(): string {
  const claim = (c: PrivacyClaim) => `- ${c.label} ${plainPrivacyText(c.body)}`;
  const lines = [
    plainPrivacyText(PRIVACY_SUMMARY),
    "",
    "What this site does NOT do:",
    ...PRIVACY_NOT_DONE.map(claim),
    "",
    "What is processed anyway:",
    plainPrivacyText(PRIVACY_PROCESSED_INTRO),
    ...PRIVACY_PROCESSED.map(claim),
    plainPrivacyText(PRIVACY_LEGAL_BASIS),
    "",
    "The providers that carry the request — the processors, named:",
    plainPrivacyText(PRIVACY_PROCESSORS_INTRO),
    ...PRIVACY_PROCESSORS.map(claim),
    plainPrivacyText(PRIVACY_PROCESSORS_OUTRO),
    "",
    // `true` rather than the frontend's flag: whoever reads this payload is talking to the agent, so
    // the agent's own flow is one of the places their data leaves the browser. The page derives the
    // same count from the same list, gated on the deployment instead.
    `The ${privacyEgressFor(true).length} places data leaves your browser:`,
    plainPrivacyText(PRIVACY_EGRESS_INTRO),
    ...privacyEgressFor(true).map(claim),
    "",
    "Your rights:",
    ...PRIVACY_RIGHTS.map(plainPrivacyText),
    "",
    "Who is responsible:",
    claim(PRIVACY_OPERATOR),
  ];
  return (
    `<site-guide section="privacy">\n${GUIDE_NOTICE}\n` +
    `${PRIVACY_RULES}\n${lines.join("\n")}\n` +
    `The full policy is at /privacy — link it in any answer about it.\n</site-guide>`
  );
}

/**
 * The three ways this answer goes wrong, stated where the facts are rather than in the prompt.
 *
 * The no-access-logs claim is scoped to this project's own servers, and dropping the scope turns a
 * disclosure into its opposite. The page states no retention window on purpose, so there is
 * nothing to round or estimate. And a privacy answer feels completable, so a gap tends to be filled
 * from memory instead of named.
 */
const PRIVACY_RULES = `Answer ONLY from the claims below — this is the policy's own text. Three rules, each from a wrong answer this section exists to prevent:
- NEVER say that no third party handles a request, or that a request never leaves this site's own servers. It is false and it inverts the disclosure below: Netlify serves the website and records every request with the IP it came from, and netcup runs the server. Name both when asked about logging, IP addresses or who sees a request.
- NEVER state a retention period, purge interval or log lifetime. The page deliberately states none, because the window is plan-dependent and a number here would go stale silently. "The page states no retention window" is the true answer.
- If a claim is not below, say the policy does not state it and link /privacy. Do not complete it from anything you know about how such sites usually work.
`;

/**
 * Every address this site names, grouped by name, with whose attribution each is and, when the read
 * succeeded, its current balance.
 *
 * Without this a label is reachable only by already knowing the address, so a question that starts
 * from a name (an exchange, an exploit) has nowhere to go. The balances ride along so that question
 * costs one read: an entity can hold twenty addresses, far more than a turn's lookups.
 *
 * Read from `ADDRESS_LABELS`, the table the pages render, so the guide cannot list a name the site
 * does not print or miss one it does. A flag's post URL is deliberately not rendered: the answer
 * sanitiser allowlists what may be linked, and the address page already links it.
 *
 * `balances` is null when the read failed. The table still renders, and the section says the
 * balances are unavailable rather than leaving them out silently.
 */
export function renderLabels(balances: LabelledBalances | null, retrievedAt: string): string {
  const byName = new Map<string, LabelGroup>();
  for (const [address, label] of Object.entries(ADDRESS_LABELS)) {
    const group = byName.get(label.name) ?? {
      addresses: [],
      source: label.source,
      ...(label.flag ? { flaggedBy: label.flag.by } : {}),
    };
    group.addresses.push(address);
    byName.set(label.name, group);
  }
  const byAddress = new Map(balances?.items.map((item) => [item.address, item]) ?? []);
  const flagged = [...byName].filter(([, g]) => g.flaggedBy !== undefined);
  const plain = [...byName].filter(([, g]) => g.flaggedBy === undefined);
  const row = ([name, g]: [string, LabelGroup]) => {
    const head = `- "${name}" (attribution: ${g.source}${
      g.flaggedBy
        ? `; the address page says it was flagged by ${g.flaggedBy} and links the post`
        : ""
    })`;
    if (balances === null) return `${head}: ${g.addresses.join(", ")}`;
    const lines = g.addresses.map((address) => {
      const item = byAddress.get(address);
      if (!item) return `  - ${address}: balance not read`;
      const rank = item.rank === null ? "" : `, rank ${item.rank} on the transparent rich list`;
      return `  - ${address}: ${formatZec(item.balanceZat)}${rank}`;
    });
    return `${head}\n${lines.join("\n")}`;
  };
  const balanceLine =
    balances === null
      ? `BALANCES UNAVAILABLE: the read of these addresses' balances failed this turn. Say so, give no balance from anywhere else, and look an address up for its figures.`
      : `Balances are current transparent balances from this explorer's index, read at ${retrievedAt}. Ranks are as of block ${balances.rankAsOfHeight}, when the hourly rich list was last built: quote that height beside a rank, never the tip.`;
  return (
    `<site-guide section="labels">\n${GUIDE_NOTICE}\n${LABEL_RULES}\n${balanceLine}\n\n` +
    `Addresses flagged in public investigations of thefts and exploits:\n${flagged.map(row).join("\n")}\n\n` +
    `Other named addresses (exchanges, custodians, funds):\n${plain.map(row).join("\n")}\n` +
    `${Object.keys(ADDRESS_LABELS).length} labelled addresses in all.\n</site-guide>`
  );
}

interface LabelGroup {
  addresses: string[];
  source: string;
  flaggedBy?: string;
}

/**
 * The balances payload, or null if it is not the shape the endpoint serves. A malformed payload
 * prints no balance at all, rather than whichever entries happened to parse.
 */
export function asLabelledBalances(parsed: unknown): LabelledBalances | null {
  const body = asRecord(parsed);
  if (body === null || !Number.isInteger(body.rankAsOfHeight) || !Array.isArray(body.items)) {
    return null;
  }
  const items: LabelledBalance[] = [];
  for (const raw of body.items) {
    const item = asRecord(raw);
    if (
      item === null ||
      typeof item.address !== "string" ||
      !Number.isSafeInteger(item.balanceZat) ||
      (item.balanceZat as number) < 0 ||
      !(item.rank === null || (Number.isInteger(item.rank) && (item.rank as number) > 0))
    ) {
      return null;
    }
    items.push({
      address: item.address,
      balanceZat: item.balanceZat as number,
      rank: item.rank as number | null,
    });
  }
  return { rankAsOfHeight: body.rankAsOfHeight as number, items };
}

/**
 * How a label may be used, stated beside the labels rather than in the prompt.
 *
 * The rules keep a name missing from the list from being read as "no data" or "it did not
 * happen", keep "one address is one address" (no clustering) true in an answer as on the page,
 * and keep a third party's attribution from being restated as something this explorer established.
 */
const LABEL_RULES = `This is the COMPLETE list of addresses this site names; each name is printed on that address's page. Use it for any question about an exchange, custodian, fund, theft, hack or exploit: if the entity or incident appears here, say this explorer labels those addresses and name them. Each address's current balance is listed with it: quote those, address by address, and look an address up only for what is not here, such as its history or transaction count. If it does not appear, say this explorer names no address for it — never that the explorer has no data about exchanges at all, and never answer "no" to whether an incident happened: an incident missing here is one this site has not labelled, not one that did not occur.
A label covers exactly the addresses listed with it. Never extend it to another address — not one that sent to or received from a labelled address, not one that looks related.
Every name is someone's attribution, given in brackets: repeat it as this site's label, attributed when asked, never as a fact this explorer verified. Say "labelled" or "flagged by", never that you identified anyone.
A balance here is a TRANSPARENT balance and a wallet's total: one exchange address holds many customers' coins, and anything the same party holds in shielded addresses cannot be enumerated by anyone.`;
