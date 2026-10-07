/**
 * Step 2 of ecosystem discovery: check every site and repository candidate against the thing
 * itself. Reads out/candidates.json, writes out/enriched.json and a review sheet
 * (out/review.csv, out/review.md) grouped into likely-in / needs-look / likely-out.
 *
 * Three passes:
 *   1. gather — probe each candidate's site and GitHub repository (liveness, title, how often
 *      the page names Zcash, archive state, last commit);
 *   2. fold — candidates whose sites land on the same host after redirects are one project
 *      (free2z.com → free2z.cash), so their evidence is combined into one row;
 *   3. judge — name, last activity and a suggested bucket with its reasons.
 *
 * Nothing here includes or excludes anything — the buckets order a maintainer's review.
 *
 *   node scripts/ecosystem/enrich.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { probe } from "./lib/probe.mjs";
import {
  pageDescription,
  pageTitle,
  pageVerdict,
  visibleText,
  zcashMentions,
} from "./lib/evidence.mjs";
import { isArchivedRepoPage, isForkRepoPage, latestCommitFromAtom } from "./lib/repo-activity.mjs";
import { isGenericLabel } from "./lib/merge.mjs";
import { triage } from "./lib/triage.mjs";
import { draftCategory } from "./lib/category.mjs";

const OUT = "scripts/ecosystem/out";
const WORKERS = 8;
const STRENGTH_ORDER = ["entry", "dependent", "topic", "mention"];

const input = JSON.parse(readFileSync(`${OUT}/candidates.json`, "utf8"));
const candidates = input.candidates.filter((c) => c.kind === "site" || c.kind === "repo");

const bareHost = (url) => new URL(url).hostname.toLowerCase().replace(/^www\./, "");

/** GitHub keys: `github.com/owner/repo` and, failing any, the organisation `github.com/owner`. */
function githubKeys(c) {
  const all = c.keys.filter((k) => k.startsWith("github.com/"));
  const repos = all.filter((k) => k.split("/").length === 3);
  return repos.length ? repos : all;
}

/** What GitHub search already told us, keyed by lowercased `owner/repo`. */
function searchMetadata(c) {
  const byRepo = new Map();
  for (const m of c.mentions) {
    if (m.source !== "github" || !m.repo) continue;
    byRepo.set(new URL(m.repo).pathname.slice(1).toLowerCase(), m);
  }
  return byRepo;
}

async function readPage(url) {
  const answer = await probe(url);
  const { verdict, detail } = pageVerdict(answer);
  const text = answer.body ? visibleText(answer.body) : "";
  const mentions = zcashMentions(text);
  return {
    url,
    status: answer.status,
    finalUrl: answer.finalUrl,
    finalHost: answer.finalUrl ? bareHost(answer.finalUrl) : null,
    verdict,
    detail,
    title: answer.body ? pageTitle(answer.body) : null,
    description: answer.body ? pageDescription(answer.body) : null,
    zcashCount: mentions.count,
    zcashSnippet: mentions.snippet,
    archivedBanner: answer.body ? isArchivedRepoPage(answer.body) : false,
    forkBanner: answer.body ? isForkRepoPage(answer.body) : false,
  };
}

/**
 * One GitHub repository (or organisation): its page supplies liveness, archive state and
 * README evidence; search metadata or the commits feed supplies the last push.
 */
async function readRepo(key, known) {
  const url = `https://${key}`;
  const page = await readPage(url);
  if (page.status === 404) return { key, url, missing: true };
  const slug = key.slice("github.com/".length);
  const meta = known.get(slug);
  let pushedAt = meta?.pushedAt ?? null;
  let via = meta ? "github-search" : "web";
  if (!meta && key.split("/").length === 3) {
    const feed = await probe(`${url}/commits.atom`);
    pushedAt = feed.status === 200 ? latestCommitFromAtom(feed.body) : null;
  }
  if (key.split("/").length === 2) via = "organisation";
  return {
    key,
    url,
    missing: false,
    archived: meta ? meta.archived === true : page.archivedBanner,
    // An organisation is never a fork; its page lists forks it holds, which says nothing.
    fork: meta ? meta.fork === true : key.split("/").length === 3 && page.forkBanner,
    stars: meta?.stars ?? null,
    pushedAt,
    via,
    // A repo is named by its own slug: GitHub's page title is "GitHub - owner/repo: …".
    title: key.split("/").at(-1) ?? null,
    verdict: page.verdict,
    zcashCount: page.zcashCount,
    zcashSnippet: page.zcashSnippet,
  };
}

async function gather(c) {
  const siteKey = c.keys.find((k) => !k.includes("/")) ?? null;
  const page = siteKey ? await readPage(`https://${siteKey}/`) : null;
  const known = searchMetadata(c);
  const repos = [];
  for (const key of githubKeys(c)) repos.push(await readRepo(key, known));
  return { c, siteKey, page, repos };
}

/**
 * Candidates whose sites end on the same host are one project. The row keyed by that host
 * wins if there is one; otherwise the first. A redirect to a host no candidate holds is kept
 * on the row and reported, since it may mean a sold domain rather than a rebrand.
 */
function foldByFinalHost(facts) {
  const byHost = new Map();
  for (const f of facts) {
    const host = f.page?.verdict !== "unreachable" ? f.page?.finalHost : null;
    if (!host) continue;
    if (!byHost.has(host)) byHost.set(host, []);
    byHost.get(host).push(f);
  }
  const absorbed = new Set();
  for (const [host, group] of byHost) {
    if (group.length < 2) continue;
    const target = group.find((f) => f.siteKey === host) ?? group[0];
    for (const f of group) {
      if (f === target) continue;
      target.c = {
        ...target.c,
        keys: [...new Set([...target.c.keys, ...f.c.keys])].sort(),
        sources: [...new Set([...target.c.sources, ...f.c.sources])].sort(),
        strongest:
          STRENGTH_ORDER.find((s) => s === target.c.strongest || s === f.c.strongest) ??
          target.c.strongest,
        mentions: [...target.c.mentions, ...f.c.mentions],
        possibleGrants: dedupeGrants([
          ...(target.c.possibleGrants ?? []),
          ...(f.c.possibleGrants ?? []),
        ]),
        name: target.c.name ?? f.c.name,
      };
      target.repos = [...target.repos, ...f.repos];
      target.aliases = [...(target.aliases ?? []), f.siteKey];
      absorbed.add(f);
    }
  }
  return facts.filter((f) => !absorbed.has(f));
}

function dedupeGrants(grants) {
  const seen = new Set();
  return grants.filter((g) => (seen.has(g.grant) ? false : seen.add(g.grant)));
}

function newest(...stamps) {
  const ms = stamps.map((s) => (s ? Date.parse(s) : NaN)).filter(Number.isFinite);
  return ms.length ? new Date(Math.max(...ms)).toISOString() : null;
}

function judge({ c, siteKey, page, repos, aliases }) {
  const live = repos.filter((r) => !r.missing);
  const best =
    [...live].sort(
      (a, b) => (Date.parse(b.pushedAt ?? "") || 0) - (Date.parse(a.pushedAt ?? "") || 0),
    )[0] ?? null;
  const crateUpdated = c.mentions
    .filter((m) => m.source === "crates")
    .map((m) => m.updatedAt)
    .reduce((a, b) => newest(a, b), null);
  const lastActivity = newest(best?.pushedAt, crateUpdated);
  const repoZcash = Math.max(0, ...live.map((r) => r.zcashCount ?? 0));
  const repoMissing = repos.length > 0 && live.length === 0;

  // A redirect to a sibling of the same site (a subdomain either way) is housekeeping.
  const redirectsTo =
    page?.finalHost &&
    siteKey &&
    page.finalHost !== siteKey &&
    !page.finalHost.endsWith(`.${siteKey}`) &&
    !siteKey.endsWith(`.${page.finalHost}`) &&
    !(aliases ?? []).length
      ? page.finalHost
      : null;

  const pageForTriage = page
    ? { verdict: page.verdict, zcashCount: page.zcashCount, redirectsTo }
    : repoMissing
      ? { verdict: "dead", zcashCount: 0 }
      : null;
  const repoForTriage =
    best || lastActivity
      ? {
          archived: best?.archived === true,
          pushedAt: lastActivity,
          zcashCount: repoZcash,
          // Only when every repo we hold is a fork — a project with its own repo and a fork
          // of a dependency is still its own project.
          fork: live.length > 0 && live.every((r) => r.fork === true),
        }
      : null;
  const t = triage({ ...c, page: pageForTriage, repo: repoForTriage }, Date.now());
  if (repoMissing && !page) t.reasons[0] = "repository gone (404)";
  if (aliases?.length) t.reasons.push(`also at ${aliases.join(", ")}`);

  const sourceName = c.name && !isGenericLabel(c.name) ? c.name : null;
  const titleName = page?.title ?? best?.title ?? null;
  return {
    key: c.key,
    keys: c.keys,
    kind: c.kind,
    category: draftCategory(c),
    name: sourceName ?? titleName,
    nameSource: sourceName ? "source" : titleName ? "page-title" : null,
    sources: c.sources,
    strongest: c.strongest,
    umbrellas: c.umbrellas,
    possibleGrants: c.possibleGrants ?? [],
    where: [...new Set(c.mentions.map((m) => m.where))].slice(0, 3),
    section: c.mentions.find((m) => m.section)?.section ?? null,
    aliases: aliases ?? [],
    page: page ? { ...page, redirectsTo } : null,
    repo: best,
    lastActivity,
    bucket: t.bucket,
    reasons: t.reasons,
  };
}

async function pool(items, worker) {
  const results = new Array(items.length);
  let next = 0;
  let done = 0;
  await Promise.all(
    Array.from({ length: WORKERS }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await worker(items[i]);
        if (++done % 100 === 0) console.log(`  ${done}/${items.length}`);
      }
    }),
  );
  return results;
}

console.log(`gathering evidence for ${candidates.length} site/repo candidates`);
const facts = await pool(candidates, gather);
const folded = foldByFinalHost(facts);
const enriched = folded.map(judge);

const order = { "likely-in": 0, "needs-look": 1, "likely-out": 2 };
enriched.sort(
  (a, b) =>
    order[a.bucket] - order[b.bucket] ||
    b.sources.length - a.sources.length ||
    (a.name ?? a.key).localeCompare(b.name ?? b.key),
);

writeFileSync(
  `${OUT}/enriched.json`,
  JSON.stringify(
    { generatedAt: new Date().toISOString(), from: input.generatedAt, enriched },
    null,
    2,
  ),
);

const link = (e) => e.page?.url ?? e.repo?.url ?? `https://${e.key}`;
const csvCell = (v) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const header = [
  "bucket",
  "name",
  "url",
  "kind",
  "draft_category",
  "category_basis",
  "sources",
  "evidence",
  "page",
  "zcash_mentions",
  "last_activity",
  "reasons",
  "possible_grants",
  "found_in",
];
const rows = enriched.map((e) => [
  e.bucket,
  e.name ?? "",
  link(e),
  e.kind,
  e.category.category,
  e.category.basis,
  e.sources.join(" "),
  e.strongest,
  e.page?.verdict ?? e.repo?.verdict ?? "",
  e.page?.zcashCount ?? e.repo?.zcashCount ?? "",
  e.lastActivity?.slice(0, 10) ?? "",
  e.reasons.join("; "),
  e.possibleGrants.map((g) => g.grant).join(" | "),
  e.where.join(" "),
]);
writeFileSync(
  `${OUT}/review.csv`,
  [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\n") + "\n",
);

const counts = Object.fromEntries(
  Object.keys(order).map((b) => [b, enriched.filter((e) => e.bucket === b).length]),
);
const md = [
  "# Zcash ecosystem — review sheet",
  "",
  `Generated ${new Date().toISOString().slice(0, 10)} from ${candidates.length} site/repo candidates (${enriched.length} after folding redirects).`,
  "",
  ...Object.keys(order).flatMap((bucket) => [
    `## ${bucket} (${counts[bucket]})`,
    "",
    "| name | category | link | page | zcash | active | reasons |",
    "|---|---|---|---|---|---|---|",
    ...enriched
      .filter((e) => e.bucket === bucket)
      .map(
        (e) =>
          `| ${[
            e.name ?? "—",
            e.category.category,
            link(e),
            e.page?.verdict ?? e.repo?.verdict ?? "—",
            e.page?.zcashCount ?? e.repo?.zcashCount ?? "—",
            e.lastActivity?.slice(0, 10) ?? "—",
            e.reasons.join("; "),
          ]
            .map((v) => String(v).replace(/\|/g, "/"))
            .join(" | ")} |`,
      ),
    "",
  ]),
].join("\n");
writeFileSync(`${OUT}/review.md`, md);

const verdicts = {};
for (const e of enriched) {
  const v = e.page?.verdict ?? (e.repo ? `repo:${e.repo.verdict}` : "none");
  verdicts[v] = (verdicts[v] ?? 0) + 1;
}
console.log(`folded ${facts.length - folded.length} duplicate sites`);
console.log("buckets", counts);
console.log("verdicts", verdicts);
console.log(`named from a title: ${enriched.filter((e) => e.nameSource === "page-title").length}`);
console.log(`still unnamed: ${enriched.filter((e) => !e.name).length}`);
const byCategory = {};
for (const e of enriched.filter((x) => x.bucket !== "likely-out")) {
  byCategory[e.category.category] = (byCategory[e.category.category] ?? 0) + 1;
}
console.log("draft categories (likely-in + needs-look)", byCategory);
