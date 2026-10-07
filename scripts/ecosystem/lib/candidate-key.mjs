/**
 * Turns any URL a source hands us into the key two sources would agree on for one project.
 *
 * A project's own site keys by its registrable-looking host (`www.` dropped, lowercased), so
 * `https://www.zingolabs.org/` and `http://zingolabs.org/about` meet. A code host or a social
 * platform is shared by thousands of projects, so there the key keeps the owner (and repo)
 * path segments — `github.com/zingolabs/zingolib` is a project, `github.com` is not.
 *
 * `kind` says what the key is evidence OF: a `site` or a `repo` can stand for a project, a
 * `social` or `store` link only points at one, and `doc` is a page ABOUT something. Nothing
 * here decides inclusion — it only makes two mentions of one project land on one row.
 */

/** Hosts where the first path segment is the owner, and the second (if any) the repo. */
const CODE_HOSTS = new Set(["github.com", "gitlab.com", "codeberg.org", "bitbucket.org"]);

/** Hosts where one path segment names the account. */
const SOCIAL_HOSTS = new Set([
  "x.com",
  "twitter.com",
  "t.me",
  "youtube.com",
  "youtu.be",
  "medium.com",
  "discord.gg",
  "discord.com",
  "linktr.ee",
  "instagram.com",
  "reddit.com",
  "facebook.com",
  "tiktok.com",
  "warpcast.com",
  "mirror.xyz",
]);

/** App stores: the key is the listing, never the store. */
const STORE_HOSTS = new Set([
  "apps.apple.com",
  "play.google.com",
  "chrome.google.com",
  "f-droid.org",
]);

/**
 * Pages ABOUT Zcash rather than projects IN it. A link here is context, not a candidate —
 * the forum, the spec, a ZIP, the wiki that lists projects. Keyed by full path so two docs
 * never merge into one "project".
 */
const DOC_HOSTS = new Set([
  "forum.zcashcommunity.com",
  "zips.z.cash",
  "zcash.readthedocs.io",
  "zechub.wiki",
  "wiki.zechub.xyz",
  "en.wikipedia.org",
  "docs.google.com",
  "drive.google.com",
]);

/** @returns {{ key: string, kind: "site" | "repo" | "social" | "store" | "doc", host: string } | null} */
export function candidateKey(raw) {
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const segments = url.pathname.split("/").filter(Boolean);

  if (CODE_HOSTS.has(host)) {
    if (segments.length === 0) return null;
    const [owner, repo] = segments;
    const cleanRepo = repo?.replace(/\.git$/, "");
    return {
      key: [host, owner.toLowerCase(), cleanRepo?.toLowerCase()].filter(Boolean).join("/"),
      kind: "repo",
      host,
    };
  }
  if (SOCIAL_HOSTS.has(host)) {
    // youtu.be/<id> and youtube.com/watch?v= are videos about something, not an account.
    if (host === "youtu.be" || segments[0] === "watch") {
      return { key: `${host}${url.pathname}${url.search}`, kind: "doc", host };
    }
    if (segments.length === 0) return null;
    return { key: `${host}/${segments[0].toLowerCase()}`, kind: "social", host };
  }
  if (STORE_HOSTS.has(host)) {
    return { key: `${host}${url.pathname}${url.search}`.toLowerCase(), kind: "store", host };
  }
  if (DOC_HOSTS.has(host)) {
    return { key: `${host}${url.pathname}`.replace(/\/$/, ""), kind: "doc", host };
  }
  return { key: host, kind: "site", host };
}
