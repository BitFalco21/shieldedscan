import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { CRAWL_WINDOW_MS, RateLimiter, crawlVerdict } from "@/lib/crawl-guard";

/**
 * Edge proxy (Next 16's name for middleware): the crawl guard, then an optional
 * private-preview password gate.
 *
 * The gate is active only when `SITE_PASSWORD` is set, so local development, CI and e2e
 * run ungated. It uses HTTP Basic rather than a login page: no cookie, no client or server
 * state, no JavaScript. Any username is accepted; only the password is checked. It is a
 * "not yet public" gate, not an identity system.
 */

// ASCII only: header values are ByteStrings, and a non-latin1 character throws while
// building the response, turning every 401 into a 500.
const REALM = 'Basic realm="shieldedscan preview", charset="UTF-8"';

/** Compares without an early exit, so a wrong password cannot be found byte by byte. */
function constantTimeEquals(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let i = 0; i < left.length; i += 1) difference |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return difference === 0;
}

/**
 * Exported for tests: the whole decision, as a pure function of the header and the
 * expected password. `atob` rather than `Buffer` — middleware runs on the edge runtime.
 */
export function isAuthorized(authorizationHeader: string | null, password: string): boolean {
  if (!authorizationHeader?.startsWith("Basic ")) return false;

  let decoded: string;
  try {
    // `atob` yields one char per byte. Browsers send the credential UTF-8 encoded
    // (RFC 7617 `charset="UTF-8"`), so decode the bytes as UTF-8 or non-ASCII passwords fail.
    const binary = atob(authorizationHeader.slice("Basic ".length).trim());
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    decoded = new TextDecoder().decode(bytes);
  } catch {
    // Malformed base64 is a failed attempt, not a server error.
    return false;
  }

  // `user:pass`, where the password may itself contain colons.
  const separator = decoded.indexOf(":");
  if (separator === -1) return false;
  return constantTimeEquals(decoded.slice(separator + 1), password);
}

/** One counter per edge isolate; see `lib/crawl-guard.ts` for what it remembers and why. */
const crawlLimiter = new RateLimiter();

/**
 * Netlify reports the client address in `x-nf-client-connection-ip`; the first hop of
 * `x-forwarded-for` is the generic fallback. Neither is stored anywhere but the limiter's
 * in-memory window. Absent both, the request is not limited.
 */
function clientId(request: NextRequest): string | null {
  // The e2e suite is one address making hundreds of requests a minute, and `next start`
  // supplies a forwarded-for header even on localhost. This knob disables only the
  // per-address throttle; the agent block still applies. Set by the e2e config and CI only.
  if (process.env.CRAWL_GUARD_DISABLED === "1") return null;
  const nf = request.headers.get("x-nf-client-connection-ip");
  if (nf) return nf.trim();
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() || null;
  return null;
}

export function proxy(request: NextRequest): NextResponse {
  // The crawl guard runs first on every deployment: it exists to avoid paying for renders,
  // and a private preview is as billable as the public site.
  const verdict = crawlVerdict(
    {
      pathname: request.nextUrl.pathname,
      userAgent: request.headers.get("user-agent"),
      clientId: clientId(request),
    },
    crawlLimiter,
  );
  if (verdict === "blocked-agent") {
    return new NextResponse("Automated bulk crawling of this explorer is not permitted.", {
      status: 403,
      headers: { "Cache-Control": "no-store" },
    });
  }
  if (verdict === "throttled") {
    return new NextResponse("Too many requests from this address. Slow down and retry.", {
      status: 429,
      headers: {
        "Retry-After": String(Math.ceil(CRAWL_WINDOW_MS / 1000)),
        "Cache-Control": "no-store",
      },
    });
  }

  const password = process.env.SITE_PASSWORD;
  if (!password) return NextResponse.next();

  if (isAuthorized(request.headers.get("authorization"), password)) {
    return NextResponse.next();
  }

  return new NextResponse("Authentication required.", {
    status: 401,
    headers: {
      "WWW-Authenticate": REALM,
      // A gated page must never be cached by the CDN and handed to the next visitor.
      "Cache-Control": "no-store",
    },
  });
}

export const config = {
  /**
   * Pages, detail routes and `/api/resolve` — nothing the CDN answers on its own.
   *
   * The proxy is an edge invocation that runs before the CDN cache, so every matched request
   * pays for it. Static assets and the CDN-cached polling endpoints (`/api/live`,
   * `/api/stats`, `/api/pulse/*`, `/api/network/*`) are excluded: the crawl guard does not
   * apply to them and their flat cost depends on the CDN answering. `/api/resolve` stays
   * matched because each distinct query is a real function call.
   */
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/(?:live|stats|pulse|network)|fonts/|hero-city/|brand/|og.png|icon.png|icon-|apple-icon.png|donate-qr.svg|robots.txt|sitemap.xml).*)",
  ],
};
