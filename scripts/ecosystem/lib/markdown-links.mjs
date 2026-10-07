/**
 * Markdown link extraction for list-shaped wiki pages.
 *
 * Two shapes matter and they are kept apart, because they are different strengths of
 * evidence. An ENTRY is a heading whose text is a link (`## [Zingo!](https://…)`), which on
 * ZecHub is how a page lists the things it catalogues — followed by `- Key: a | b` bullets
 * that describe it. A MENTION is any other inline link, which is as often an article, a tweet
 * or a doc as it is a project.
 */

const HEADING = /^(#{1,6})\s+(.*)$/;
const LINK = /(!?)\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;
const PROP = /^\s*[-*]\s+([A-Za-z][\w ]{0,40}):\s*(.+)$/;

/** Strips markdown emphasis and code ticks from a label so "**Zingo!**" reads "Zingo!". */
function cleanLabel(text) {
  return text.replace(/[*_`]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * @param {string} markdown
 * @returns {{ entries: { name: string, url: string, section: string | null, props: Record<string, string[]> }[],
 *             mentions: { text: string, url: string, section: string | null }[] }}
 */
export function extractLinks(markdown) {
  const entries = [];
  const mentions = [];
  let section = null;
  let current = null;

  for (const line of markdown.split(/\r?\n/)) {
    const heading = HEADING.exec(line);
    if (heading) {
      current = null;
      const links = [...heading[2].matchAll(LINK)].filter((m) => m[1] !== "!");
      if (links.length === 1) {
        const [, , text, url] = links[0];
        current = { name: cleanLabel(text), url, section, props: {} };
        entries.push(current);
      } else {
        section = cleanLabel(heading[2].replace(LINK, "$2"));
      }
      continue;
    }

    const prop = current ? PROP.exec(line) : null;
    if (prop) {
      current.props[prop[1].trim()] = prop[2]
        .split("|")
        .map((v) => cleanLabel(v))
        .filter(Boolean);
      continue;
    }

    for (const match of line.matchAll(LINK)) {
      const [, bang, text, url] = match;
      if (bang === "!") continue;
      mentions.push({ text: cleanLabel(text), url, section });
    }
  }
  return { entries, mentions };
}
