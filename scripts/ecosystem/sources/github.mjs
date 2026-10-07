/**
 * GitHub repositories tagged with a Zcash topic.
 *
 * Unauthenticated search allows 10 requests a minute and returns at most 1,000 results per
 * query, so each topic is paged to exhaustion or to that ceiling — and a query that hits the
 * ceiling is REPORTED as truncated rather than presented as complete.
 *
 * Forks and archived repositories are kept but marked: an archived wallet is still evidence
 * that the project existed, and triage — not discovery — decides whether it is still alive.
 */
import { fetchJson } from "../lib/http.mjs";

/**
 * Only topics that NAME Zcash. `zebra`, `orchard` and `halo2` were tried and returned 428
 * repositories that are mostly zebra printers, other Orchard frameworks and ZK projects on other
 * chains: a word match is not evidence. Zcash's own repositories carry
 * `zcash` too, so nothing real is lost by leaving the ambiguous words out.
 */
const TOPICS = ["zcash", "zec", "zcash-wallet", "lightwalletd"];
const SEARCH_CEILING = 1000;

export async function discoverGitHub() {
  const items = [];
  const truncated = [];
  for (const topic of TOPICS) {
    let total = 0;
    for (let page = 1; page <= 10; page++) {
      const body = await fetchJson(
        `https://api.github.com/search/repositories?q=topic:${topic}&sort=updated&per_page=100&page=${page}`,
        { bucket: "github-search", gapMs: 6500 },
      );
      total = body.total_count;
      for (const repo of body.items) {
        items.push({
          source: "github",
          strength: "topic",
          name: repo.name,
          url: repo.homepage?.trim() || repo.html_url,
          repo: repo.html_url,
          where: `https://github.com/topics/${topic}`,
          description: repo.description,
          topic,
          fork: repo.fork,
          archived: repo.archived,
          pushedAt: repo.pushed_at,
          stars: repo.stargazers_count,
        });
      }
      if (body.items.length < 100) break;
    }
    if (total > SEARCH_CEILING) truncated.push({ topic, total });
  }
  return { items, truncated };
}
