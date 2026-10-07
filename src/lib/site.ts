import { TESTNET_SITE_URL, isTestnet } from "./network";

/**
 * Deployment-level configuration. Read from the environment so the same build can
 * run locally, as a private preview, and in production.
 *
 * On the testnet deployment the canonical URL is derived from the network flag, not from
 * NEXT_PUBLIC_SITE_URL: the shared `netlify.toml` pins that variable to the mainnet origin
 * for every production context, and file config outranks the dashboard, so the testnet
 * site could not set its own value even deliberately.
 */
export const siteUrl = isTestnet
  ? TESTNET_SITE_URL
  : (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000");

/** True only on the public stage. Preview deployments must stay un-indexable. */
export const isPublicStage = process.env.NEXT_PUBLIC_STAGE === "public";

/**
 * The public API's origin. One constant serving three consumers that must agree: the CSP's
 * `connect-src` (or the playground's requests are blocked by our own header), the docs
 * page's copy, and the try-it playground itself.
 */
export const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "https://api.shieldedscan.xyz";
