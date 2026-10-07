const BASE = "https://same-origin.invalid";

/**
 * Whether a relative href stays on this site when a browser follows it.
 *
 * "Starts with `/` and not `//`" is not enough: browsers treat `\` as `/` in http(s) URLs and
 * strip tabs and newlines, so `/\evil.example` and `/<TAB>/evil.example` both leave the site.
 * Any backslash, whitespace or control character is refused, and the href must resolve to the
 * same origin it started from.
 */
export function isSameOriginPath(href: string): boolean {
  if (!href.startsWith("/") || href.startsWith("//")) return false;
  if (/[\\\s\u0000-\u001f\u007f]/.test(href)) return false;
  try {
    return new URL(href, BASE).origin === BASE;
  } catch {
    return false;
  }
}
