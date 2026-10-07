/**
 * Activity for a GitHub repository without spending the API's 60-an-hour unauthenticated
 * budget: the repo's own commit Atom feed carries the newest commit's timestamp, and the repo
 * page says whether it is archived. Both are ordinary web pages, and both answers are pure
 * functions of their text so they can be tested against a captured copy.
 */

/** The newest `<updated>` in a commits.atom feed, or null when the feed has no entries. */
export function latestCommitFromAtom(xml) {
  const stamps = [...xml.matchAll(/<entry>[\s\S]*?<updated>([^<]+)<\/updated>/g)]
    .map((m) => Date.parse(m[1]))
    .filter(Number.isFinite);
  return stamps.length === 0 ? null : new Date(Math.max(...stamps)).toISOString();
}

/** GitHub states an archive in a banner with fixed wording. */
export function isArchivedRepoPage(html) {
  return /This repository has been archived by the owner/i.test(html);
}

/**
 * GitHub prints "forked from <owner/repo>" under a fork's name, linked through a repository
 * hovercard. A fork of a Zcash crate that was published to crates.io depends on Zcash crates
 * by construction, so without this a copy reads exactly like an independent project.
 *
 * Matched on the hovercard link, not the words: an organisation page lists its repos with
 * "Forked from …" beside each fork (no hovercard), and a README may say the phrase in prose.
 * Only meaningful on a repository page — the caller never asks it of an organisation.
 */
export function isForkRepoPage(html) {
  return /forked from\s*<a[^>]*data-hovercard-type="repository"/i.test(html);
}
