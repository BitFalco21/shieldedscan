/**
 * Ecosystem discovery, step 1 of 3: gather CANDIDATES from independent sources and merge
 * them onto one row per project. Nothing here decides inclusion — enrichment (step 2) checks
 * each candidate is live and about Zcash, and a maintainer approves every entry before it ships
 * (step 3). A candidate is a lead, never a claim.
 *
 *   node scripts/ecosystem/discover.mjs
 *
 * Writes scripts/ecosystem/out/candidates.json (gitignored). Responses are cached under
 * out/cache, so a re-run is free; delete the cache to read the sources again.
 *
 * A source that fails is RECORDED as failed in the output and the run is marked partial —
 * never silently dropped, because a missing source reads exactly like a smaller ecosystem.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { attachGrantMatches, mergeItems } from "./lib/merge.mjs";
import { discoverCrates } from "./sources/crates.mjs";
import { discoverGitHub } from "./sources/github.mjs";
import { discoverZcg } from "./sources/zcg.mjs";
import { discoverZecHub } from "./sources/zechub.mjs";

const OUT = "scripts/ecosystem/out/candidates.json";

const SOURCES = {
  zechub: discoverZecHub,
  zcg: discoverZcg,
  crates: discoverCrates,
  github: discoverGitHub,
};

async function runSources() {
  const results = {};
  for (const [name, run] of Object.entries(SOURCES)) {
    const started = Date.now();
    process.stdout.write(`${name}: reading… `);
    try {
      results[name] = { ok: true, ...(await run()) };
      console.log(`done in ${Math.round((Date.now() - started) / 1000)}s`);
    } catch (error) {
      results[name] = { ok: false, error: String(error?.message ?? error) };
      console.log(`FAILED — ${results[name].error}`);
    }
  }
  return results;
}

const results = await runSources();
const items = Object.values(results).flatMap((r) => (r.ok ? (r.items ?? []) : []));
const { candidates, internal, unkeyable, umbrellas } = mergeItems(items);
attachGrantMatches(candidates, results.zcg?.ok ? results.zcg.grants : []);
const report = {
  generatedAt: new Date().toISOString(),
  complete: Object.values(results).every((r) => r.ok),
  sources: Object.fromEntries(
    Object.entries(results).map(([name, r]) => [
      name,
      r.ok
        ? {
            ok: true,
            items: r.items?.length ?? 0,
            ...(r.pagesRead ? { pagesRead: r.pagesRead } : {}),
            ...(r.cratesRead ? { cratesRead: r.cratesRead } : {}),
            ...(r.truncated?.length ? { truncated: r.truncated } : {}),
            ...(r.grants ? { grants: r.grants.length } : {}),
          }
        : { ok: false, error: r.error },
    ]),
  ),
  candidates: candidates.sort(
    (a, b) => b.sources.length - a.sources.length || a.key.localeCompare(b.key),
  ),
  grants: results.zcg?.ok ? results.zcg.grants : [],
  umbrellas,
  internalLinks: internal,
  unkeyable,
};

mkdirSync("scripts/ecosystem/out", { recursive: true });
writeFileSync(OUT, JSON.stringify(report, null, 2));

const byKind = {};
for (const c of candidates) byKind[c.kind] = (byKind[c.kind] ?? 0) + 1;
const matched = candidates.filter((c) => c.possibleGrants.length > 0).length;
console.log(`\n${candidates.length} candidates`, byKind);
console.log(
  `${internal} internal wiki links set aside · ${unkeyable.length} unkeyable · ${umbrellas.length} umbrella sites`,
);
console.log(`${matched} candidates with a possible ZCG grant match`);
console.log(report.complete ? "all sources answered" : "PARTIAL: at least one source failed");
console.log(`wrote ${OUT}`);
