/**
 * ZecHub's wiki (github.com/ZecHub/zechub), English pages only.
 *
 * `site/` holds the English originals; `site/zechubglobal/` and `translations/` are ~4,000
 * translated copies of the same pages, which would only repeat the same links. Read from
 * raw.githubusercontent.com, which is not counted against the GitHub API's 60/hour — the
 * one API call is the tree listing.
 */
import { extractLinks } from "../lib/markdown-links.mjs";
import { fetchJson, fetchText } from "../lib/http.mjs";

const REPO = "ZecHub/zechub";
const BRANCH = "main";

export async function discoverZecHub() {
  const tree = await fetchJson(
    `https://api.github.com/repos/${REPO}/git/trees/${BRANCH}?recursive=1`,
  );
  if (tree.truncated)
    throw new Error("ZecHub tree listing is truncated; the page set would be partial");

  const pages = tree.tree
    .filter((node) => node.type === "blob" && node.path.endsWith(".md"))
    .map((node) => node.path)
    .filter((path) => path.startsWith("site/") && !path.startsWith("site/zechubglobal/"));

  const items = [];
  for (const path of pages) {
    const markdown = await fetchText(
      `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${encodeURI(path)}`,
    );
    const where = `https://github.com/${REPO}/blob/${BRANCH}/${path}`;
    const { entries, mentions } = extractLinks(markdown);
    for (const entry of entries) {
      items.push({
        source: "zechub",
        strength: "entry",
        name: entry.name,
        url: entry.url,
        where,
        section: entry.section,
        props: entry.props,
      });
    }
    for (const mention of mentions) {
      items.push({
        source: "zechub",
        strength: "mention",
        name: mention.text,
        url: mention.url,
        where,
        section: mention.section,
      });
    }
  }
  return { items, pagesRead: pages.length };
}
