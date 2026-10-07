#!/usr/bin/env node
/**
 * Which committed in-flight reference facts are old enough to be worth re-reading?
 *
 * `zcash_reference` 'roadmap' holds the state of processes that are still running — NU7's unset
 * activation height, which ZIPs are candidates for it, the coinholder vote, Project Tachyon.
 * For most corpus entries `verifiedOn` means "somebody opened this document on this day" and
 * re-reading changes nothing; for "ZIP 234 is a Draft", re-reading is the point.
 *
 * A script, not a test: a test that failed once an entry passed N days would redden the build on
 * a clock rather than a change, break `git bisect`, and invite bumping the date without opening
 * the document — the one act `verifiedOn` exists to prevent. The enforcement lives elsewhere:
 *
 *  - the payload says how old each reading is, computed at request time from `verifiedOn`
 *    (`renderEntry`), so a reader is always told;
 *  - `reference.test.ts` runs a falsifier: the day the committed upgrade order names NU7, the
 *    "no activation height" entry fails and the message says what to rewrite.
 *
 * It does not fetch: deciding whether a document still says what we transcribed is a person's
 * job, and a fetch that failed silently would look like a green check.
 *
 *   node scripts/check-reference-freshness.mjs            # report, always exit 0
 *   node scripts/check-reference-freshness.mjs --strict    # exit 1 if anything is stale
 *   node scripts/check-reference-freshness.mjs --days 14   # a different threshold
 *
 * Not part of `npm run verify`.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.join(HERE, "..", "server", "agent", "reference.ts");
const DAY_MS = 86_400_000;

const args = process.argv.slice(2);
const strict = args.includes("--strict");
const daysArg = args.indexOf("--days");
const threshold = daysArg === -1 ? 30 : Number(args[daysArg + 1]);
if (!Number.isFinite(threshold) || threshold < 0) {
  console.error(`--days needs a non-negative number, got ${String(args[daysArg + 1])}`);
  process.exit(2);
}

/*
 * The corpus is read as text rather than imported: importing it would need
 * `--experimental-strip-types` (Node 22.6+), and this repo supports Node 20. The scan is
 * deliberately simple, and its brittleness is converted into a loud failure below — "found
 * nothing" and "cannot read the file any more" must not look the same.
 */
const src = readFileSync(SOURCE, "utf8");
const entries = [];
const idRe = /\bid: "([a-z0-9-]+)",/g;
for (let m = idRe.exec(src); m !== null; m = idRe.exec(src)) {
  idRe.lastIndex = m.index + m[0].length;
  const next = new RegExp(idRe.source, "g");
  next.lastIndex = idRe.lastIndex;
  const following = next.exec(src);
  const block = src.slice(m.index, following === null ? src.length : following.index);
  if (!/\binFlight: true\b/.test(block)) continue;
  const day = /\bverifiedOn: "(\d{4}-\d{2}-\d{2})",/.exec(block);
  const href = /\bhref: "([^"]+)",/.exec(block);
  entries.push({ id: m[1], verifiedOn: day?.[1] ?? null, href: href?.[1] ?? null });
}

if (entries.length === 0) {
  console.error(
    "no in-flight entries found in server/agent/reference.ts.\n" +
      "Either every roadmap entry has settled — in which case delete this script's npm alias — or\n" +
      "the file's shape changed and this scan is no longer reading it. It is NOT evidence that\n" +
      "everything is fresh.",
  );
  process.exit(2);
}

const now = Date.now();
const aged = entries
  .map((e) => {
    const read = e.verifiedOn === null ? NaN : Date.parse(`${e.verifiedOn}T00:00:00Z`);
    return { ...e, days: Number.isNaN(read) ? null : Math.floor((now - read) / DAY_MS) };
  })
  .sort((a, b) => (b.days ?? Infinity) - (a.days ?? Infinity));

const stale = aged.filter((e) => e.days === null || e.days > threshold);

console.log(`${entries.length} in-flight reference entries; threshold ${threshold} days.\n`);
for (const e of aged) {
  const age = e.days === null ? "UNDATED" : `${e.days}d`;
  const flag = e.days === null || e.days > threshold ? "STALE " : "  ok  ";
  console.log(
    `${flag} ${age.padStart(7)}  ${e.id}\n${" ".repeat(16)}${e.href ?? "(named, not linked)"}`,
  );
}

if (stale.length === 0) {
  console.log(`\nNothing past ${threshold} days.`);
  process.exit(0);
}

console.log(
  `\n${stale.length} entr${stale.length === 1 ? "y" : "ies"} past ${threshold} days. For each one:\n` +
    "  1. open the href and read what it says NOW (the entry with no href is the forum\n" +
    "     announcement — find it by the venue and date in its `source`);\n" +
    "  2. update `fact` AND `verifiedOn` together — the prose states the day inside itself, and\n" +
    "     `reference.test.ts` fails if the two disagree;\n" +
    "  3. if it has SETTLED, drop `inFlight` and rewrite the fact as the settled statement it now\n" +
    "     is. The payload's staleness warning disappears on its own once the last one goes.\n" +
    "Never bump the date without opening the document.",
);
process.exit(strict ? 1 : 0);
