import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BASE_SECURITY_HEADERS, securityHeaders } from "../security-headers";

/**
 * These pin two things:
 *  - the content of the policy, so a directive cannot be dropped in a refactor;
 *  - that `netlify.toml`'s mirror still matches the module, so the two cannot drift.
 *
 * Neither proves the headers are actually sent; only a request against a deployed build does.
 */

const netlifyToml = readFileSync(join(process.cwd(), "netlify.toml"), "utf8");

const valueOf = (key: string): string | undefined =>
  BASE_SECURITY_HEADERS.find((h) => h.key === key)?.value;

describe("securityHeaders", () => {
  it("carries every directive the launch-readiness spec depends on", () => {
    const csp = valueOf("Content-Security-Policy") ?? "";
    // frame-ancestors and X-Frame-Options are both required: the header for older agents,
    // the directive because it is the one browsers still honour inside CSP.
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("default-src 'self'");
    expect(valueOf("X-Frame-Options")).toBe("DENY");
  });

  it("keeps connect-src at 'self' plus ONLY the keyless API origin", () => {
    // A page that could reach the bearer-gated API would need the token in browser-visible
    // JavaScript. The one extra origin is the keyless /v1 (for the docs playground): it has
    // no token to leak, and /chain/* there still answers 401 to a browser. A third origin
    // here would be a tracking vector.
    const csp = valueOf("Content-Security-Policy") ?? "";
    const connect = csp.split("; ").find((d) => d.startsWith("connect-src"));
    expect(connect).toBe("connect-src 'self' https://api.shieldedscan.xyz");
  });

  it("adds X-Robots-Tag in preview and removes it in public", () => {
    const preview = securityHeaders(false);
    const live = securityHeaders(true);
    expect(preview.find((h) => h.key === "X-Robots-Tag")?.value).toBe("noindex, nofollow");
    // Derived from the stage, so nobody has to remember to delete it.
    expect(live.find((h) => h.key === "X-Robots-Tag")).toBeUndefined();
  });

  it("never lets a noindex escape into a public build, whatever else changes", () => {
    expect(
      securityHeaders(true)
        .map((h) => h.value)
        .join(" "),
    ).not.toContain("noindex");
  });
});

describe("netlify.toml mirror", () => {
  it.each(BASE_SECURITY_HEADERS.map((h) => [h.key, h.value]))(
    "declares %s with the same value as the module",
    (key, value) => {
      // Netlify's TOML wants the raw value in double quotes on one line.
      expect(netlifyToml).toContain(`${key} = "${value}"`);
    },
  );

  it("does NOT declare X-Robots-Tag, which TOML cannot make conditional", () => {
    // A stale `noindex` on a launched site is a worse failure than the header being absent
    // from a static font file, so the conditional one lives only in next.config.ts.
    expect(netlifyToml).not.toMatch(/^\s*X-Robots-Tag\s*=/m);
  });
});
