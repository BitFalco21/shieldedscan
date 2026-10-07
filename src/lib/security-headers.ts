import { apiBaseUrl } from "./site";

/**
 * The site's security headers, in one place.
 *
 * Emitted from `next.config.ts` because with `@netlify/plugin-nextjs` responses come from the
 * Next runtime function, where `netlify.toml` `[[headers]]` rules do not reliably apply. The
 * toml block is a mirror for purely static paths; `__tests__/security-headers.test.ts` pins
 * the two together. A header change is verified by curling the deployed site, not by reading
 * config.
 */

export interface SecurityHeader {
  key: string;
  value: string;
}

/**
 * `script-src 'unsafe-inline'` is a deliberate weakening: Next's App Router injects inline
 * bootstrap and streaming scripts, and a nonce would force dynamic rendering and lose the
 * immutable-page caching the site relies on. It is acceptable because there is no
 * user-generated content, no third-party script, and every dynamic value renders as escaped
 * React text. Re-verify that before relaxing anything else.
 *
 * `connect-src` keeps the API token out of the browser. Its one extra origin is the keyless
 * /v1 API for the docs playground: /v1 has no token, and the bearer-gated /chain/* on that
 * origin still answers 401 to any browser. It must never gain a third-party origin.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  `connect-src 'self' ${apiBaseUrl}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

/**
 * Everything except `X-Robots-Tag`, which is stage-dependent and therefore added by
 * `securityHeaders` rather than living in this constant. `netlify.toml` mirrors exactly
 * this list — it cannot express a condition, so it deliberately carries no robots header.
 */
export const BASE_SECURITY_HEADERS: readonly SecurityHeader[] = [
  // Two years. With `includeSubDomains`, `preload` binds every future subdomain to HTTPS, and
  // removal from the preload list takes months.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Site-wide default. The cross-chain venue links additionally carry rel="noreferrer",
  // because for those the origin alone is more than the venue needs.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Content-Security-Policy", value: CONTENT_SECURITY_POLICY },
];

/**
 * The full set for a given launch stage.
 *
 * `X-Robots-Tag: noindex, nofollow` is private-preview only, derived from the same stage flag
 * that flips `robots.ts`, so no manual launch step can leave a `noindex` on a public site.
 */
export function securityHeaders(isPublic: boolean): SecurityHeader[] {
  const headers = [...BASE_SECURITY_HEADERS];
  if (!isPublic) headers.push({ key: "X-Robots-Tag", value: "noindex, nofollow" });
  return headers;
}
