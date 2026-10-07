/**
 * Sorts an enriched candidate into one of three buckets for a maintainer's review. A bucket is a
 * SUGGESTION: nothing is included or excluded by this function, and every candidate — "likely
 * out" included — reaches the review sheet with the reasons that put it there.
 *
 * The rules separate two questions that are easy to conflate: is this about ZCASH, and is it
 * ALIVE. A ZecHub catalogue entry is strong evidence of the first and none at all of the second;
 * a live page is the reverse.
 */

const STALE_DAYS = 730;

/**
 * @param {{ sources: string[], strongest: string, possibleGrants?: unknown[],
 *   page?: { verdict: string, zcashCount: number, redirectsTo?: string | null } | null,
 *   repo?: { archived: boolean, pushedAt: string | null, zcashCount?: number, fork?: boolean } | null }} c
 * @param {number} nowMs
 * @returns {{ bucket: "likely-in" | "needs-look" | "likely-out", reasons: string[] }}
 */
export function triage(c, nowMs) {
  const reasons = [];
  const verdict = c.page?.verdict ?? null;

  const dead = verdict === "dead" || verdict === "parked" || verdict === "soft-404";
  const unreachable = verdict === "unreachable";
  if (dead) reasons.push(`page ${verdict}`);
  if (unreachable) reasons.push("page unreachable");
  // A site that now answers from an unrelated host was often sold or abandoned — or simply
  // rebranded. Only a person can tell which, so it never lands in likely-in on its own.
  const redirected = Boolean(c.page?.redirectsTo);
  if (redirected) reasons.push(`redirects to ${c.page?.redirectsTo}`);

  const pushedMs = c.repo?.pushedAt ? Date.parse(c.repo.pushedAt) : null;
  const ageDays = pushedMs ? (nowMs - pushedMs) / 86_400_000 : null;
  const archived = c.repo?.archived === true;
  const stale = archived || (ageDays !== null && ageDays > STALE_DAYS);
  if (archived) reasons.push("repo archived");
  else if (ageDays !== null && ageDays > STALE_DAYS) {
    reasons.push(`no push for ${Math.round(ageDays / 365)}y`);
  }

  // A fork inherits every signal of the project it copied, so it is a person's call.
  const fork = c.repo?.fork === true;
  if (fork) reasons.push("fork of another repo");

  const grants = (c.possibleGrants ?? []).length;
  const zcashOnPage = (c.page?.zcashCount ?? 0) > 0;
  const zcashInRepo = (c.repo?.zcashCount ?? 0) > 0;
  const zcashByListing = c.strongest === "entry" || c.strongest === "dependent";
  const zcashEvidence =
    zcashOnPage || zcashInRepo || zcashByListing || c.sources.includes("github");
  if (zcashOnPage) reasons.push("page mentions Zcash");
  if (zcashInRepo && !zcashOnPage) reasons.push("repo mentions Zcash");
  if (c.strongest === "entry") reasons.push("ZecHub catalogue entry");
  if (c.strongest === "dependent") reasons.push("depends on a Zcash crate");
  if (grants > 0) reasons.push(`${grants} possible ZCG grant match${grants > 1 ? "es" : ""}`);
  if (c.sources.length > 1) reasons.push(`${c.sources.length} sources`);

  const corroborated = c.sources.length > 1 || zcashByListing || grants > 0;

  if (dead) return { bucket: "likely-out", reasons };
  if (stale && !corroborated) return { bucket: "likely-out", reasons };
  if (!zcashEvidence && (c.strongest === "mention" || c.strongest === "topic")) {
    reasons.push("no Zcash evidence");
    return { bucket: "likely-out", reasons };
  }
  if (
    zcashEvidence &&
    corroborated &&
    !stale &&
    !unreachable &&
    !redirected &&
    !fork &&
    verdict !== "blocked"
  ) {
    return { bucket: "likely-in", reasons };
  }
  if (!corroborated) reasons.push("one source, not a catalogue entry");
  return { bucket: "needs-look", reasons };
}
