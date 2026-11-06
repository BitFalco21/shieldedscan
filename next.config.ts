import type { NextConfig } from "next";
import { EDGE_CACHE_POLICIES, edgeCacheHeaders } from "./src/lib/edge-cache";
import { securityHeaders } from "./src/lib/security-headers";

/**
 * A relative import, not the `@/` alias: `next.config.ts` is loaded before the tsconfig
 * path mapping is available. `NEXT_PUBLIC_STAGE` and `NEXT_PUBLIC_NETWORK` are read directly for
 * the same reason; both are baked in at build time, like `robots.ts`, so changing either is a
 * redeploy.
 */
const nextConfig: NextConfig = {
  // A self-contained server for the self-host image (`selfhost/Dockerfile.web`). Netlify never
  // sets the variable: its adapter makes its own standalone build (see netlify.toml).
  ...(process.env.NEXT_STANDALONE === "1" ? { output: "standalone" as const } : {}),
  experimental: {
    // Turbopack's persistent build cache serialises the server's environment, secrets
    // included, into .next/cache. Builds stay correct without it; they are only slower.
    turbopackFileSystemCacheForBuild: false,
  },
  async headers() {
    return [
      {
        // Every path, including the not-found boundary and metadata routes. `netlify.toml`
        // mirrors these for the CDN's static layer.
        source: "/:path*",
        // Indexable only when public and mainnet: testnet runs with NEXT_PUBLIC_STAGE=public
        // but is never indexed. Same rule as robots.ts and the layout metadata.
        // Plain http only when the origin says so: unset (local work, CI) keeps every header.
        headers: securityHeaders(
          process.env.NEXT_PUBLIC_STAGE === "public" &&
            process.env.NEXT_PUBLIC_NETWORK !== "testnet",
          { plainHttp: process.env.NEXT_PUBLIC_SITE_URL?.startsWith("http://") === true },
        ),
      },
      // After the security headers, which they add to rather than replace.
      ...EDGE_CACHE_POLICIES.map((policy) => ({
        source: policy.source,
        headers: edgeCacheHeaders(policy),
      })),
    ];
  },
};

export default nextConfig;
