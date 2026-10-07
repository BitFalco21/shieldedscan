/**
 * What a fetched page says about itself — pure functions over its HTML, so every rule here is
 * testable against a captured page without touching the network.
 *
 * The scraped text is EVIDENCE for a reviewer and never copy for the site: a project's own
 * marketing prose is a third party's words (licensing), and anything that ever reaches the agent
 * from here would be an injection carrier. Only short labels and one bounded snippet are kept.
 */

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

function decode(text) {
  return text
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === "#") {
        const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1));
        return Number.isFinite(code) && code > 0 && code < 0x110000
          ? String.fromCodePoint(code)
          : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, " ")
    .trim();
}

/** Collapses control characters and caps length: these become labels, never markup. */
function label(text, max = 160) {
  if (!text) return null;
  const clean = decode(text).replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e]/g, "");
  if (!clean) return null;
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function meta(html, attr, name) {
  const tag = new RegExp(`<meta[^>]+${attr}=["']${name}["'][^>]*>`, "i").exec(html)?.[0];
  return tag ? (/content=["']([^"']*)["']/i.exec(tag)?.[1] ?? null) : null;
}

/** Site names a platform stamps on every page it hosts — they name the host, not the project. */
const PLATFORM_SITE_NAMES = new Set([
  "github",
  "gitlab",
  "codeberg",
  "my site",
  "my website",
  "home",
]);

export function pageTitle(html) {
  const siteName = label(meta(html, "property", "og:site_name"));
  const usable = siteName && !PLATFORM_SITE_NAMES.has(siteName.toLowerCase()) ? siteName : null;
  return (
    usable ??
    label(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? null) ??
    label(meta(html, "property", "og:title"))
  );
}

export function pageDescription(html) {
  return label(meta(html, "name", "description") ?? meta(html, "property", "og:description"), 240);
}

/** The text a visitor would read: scripts, styles and tags removed. */
export function visibleText(html) {
  return decode(
    html
      .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " "),
  );
}

/**
 * Words that only a Zcash-related page uses. Deliberately NOT "orchard", "sapling" or "sprout":
 * those are ordinary English words, and a word match alone is not evidence (YZCASH is not Zcash).
 */
const ZCASH_WORDS = /\b(zcash|zec|zashi|zcashd|zebrad|lightwalletd|ywallet|zingo|zodl)\b/gi;

/** @returns {{ count: number, snippet: string | null }} */
export function zcashMentions(text) {
  const matches = [...text.matchAll(ZCASH_WORDS)];
  if (matches.length === 0) return { count: 0, snippet: null };
  const at = matches[0].index ?? 0;
  return {
    count: matches.length,
    snippet: label(text.slice(Math.max(0, at - 60), at + 80), 150),
  };
}

const PARKED =
  /(domain (is )?for sale|buy this domain|this domain (may be|is) for sale|parked (free|domain)|domain parking)/i;
const SOFT_404 = /\b(404|page not found|not found)\b/i;

/**
 * Classifies a probe's answer. `client-rendered` is its own verdict, NOT "no Zcash mention": a
 * page that ships an empty shell and renders in the browser (z.cash/wallets is one) says nothing
 * to a fetch, and reading that silence as "not about Zcash" would discard real projects.
 */
export function pageVerdict(probeResult) {
  const { status, error, body } = probeResult;
  if (error) return { verdict: "unreachable", detail: error };
  if (status === 403 || status === 429 || status === 503) {
    return { verdict: "blocked", detail: `HTTP ${status}` };
  }
  if (status !== null && status >= 400) return { verdict: "dead", detail: `HTTP ${status}` };
  if (!body) return { verdict: "not-html", detail: probeResult.contentType ?? "no body" };

  const text = visibleText(body);
  const title = pageTitle(body) ?? "";
  if (PARKED.test(text.slice(0, 4000)) || PARKED.test(title)) {
    return { verdict: "parked", detail: title || null };
  }
  if (SOFT_404.test(title)) return { verdict: "soft-404", detail: title };
  if (text.length < 200) return { verdict: "client-rendered", detail: `${text.length} chars` };
  return { verdict: "live", detail: null };
}
