import type { NextConfig } from "next";
import { securityHeaders } from "./src/lib/security-headers";

/**
 * A relative import, not the `@/` alias: `next.config.ts` is loaded before the tsconfig
 * path mapping is available. `NEXT_PUBLIC_STAGE` and `NEXT_PUBLIC_NETWORK` are read directly for
 * the same reason; both are baked in at build time, like `robots.ts`, so changing either is a
 * redeploy.
 */
const nextConfig: NextConfig = {
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
        headers: securityHeaders(
          process.env.NEXT_PUBLIC_STAGE === "public" &&
            process.env.NEXT_PUBLIC_NETWORK !== "testnet",
        ),
      },
    ];
  },
};

export default nextConfig;
