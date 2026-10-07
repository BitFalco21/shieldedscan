import { timingSafeEqual } from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";

/**
 * The private API's bearer check, in one place.
 *
 * Shared by the middleware and by in-process callers (the agent dispatches at the private
 * `/chain/*` and `/crosschain/*` routes, and its test harness mounts this same gate), so no copy
 * of the check can drift from the one that guards the routes.
 *
 * The comparison is constant-time. `timingSafeEqual` throws on a length mismatch, so the length
 * is checked first; that reveals the token's length, which is not secret, rather than its bytes.
 */

export interface BearerAuth {
  /** Whether this request carries the token. Used by /health to decide what it may reveal. */
  isAuthorized(c: Context): boolean;
  /** 401s a request that does not. */
  requireToken: MiddlewareHandler;
  /**
   * The exact header value a caller must send: the same buffer `isAuthorized` compares against,
   * so an in-process caller cannot drift from the check it has to pass.
   */
  header(): string;
}

export function bearerAuth(token: string): BearerAuth {
  const expected = Buffer.from(`Bearer ${token}`, "utf8");

  const isAuthorized = (c: Context): boolean => {
    const supplied = Buffer.from(c.req.header("authorization") ?? "", "utf8");
    if (supplied.length !== expected.length) return false;
    return timingSafeEqual(supplied, expected);
  };

  return {
    isAuthorized,
    requireToken: async (c, next) => {
      if (!isAuthorized(c)) return c.json({ error: "unauthorized" }, 401);
      await next();
    },
    header: () => expected.toString("utf8"),
  };
}
