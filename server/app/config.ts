import { midgardVenuesFromEnv } from "@/data/crosschain/venues";
import { apiRoleFromEnv } from "../api-role";
import { parseNetworkEnv } from "../entrypoint";

/**
 * The API's configuration, read from the environment once at boot. Every value that can be wrong
 * is checked here, so a misconfigured container refuses to start rather than serving under a
 * guessed setting.
 */

export const PORT = Number(process.env.PORT ?? 8080);
export const DATABASE_URL = process.env.DATABASE_URL;
/** Either form configures Postgres; PG* avoids URL-escaping the password. */
export const USE_POSTGRES = Boolean(DATABASE_URL ?? process.env.PGHOST);
export const SCHEMA_PATH = process.env.SCHEMA_PATH ?? "./schema.sql";
export const NODE_RPC_URL = process.env.NODE_RPC_URL;

const token = process.env.EXPLORER_API_TOKEN;
if (!token) {
  console.error("EXPLORER_API_TOKEN is required — refusing to start an unauthenticated API");
  process.exit(1);
}
if (token.length < 32) {
  // A warning rather than a refusal, so an existing deployment keeps starting; rotate it.
  console.error(
    "EXPLORER_API_TOKEN is shorter than 32 characters — rotate it to a longer random value",
  );
}
/** The bearer token every private route and in-process caller uses. */
export const TOKEN: string = token;

/**
 * Which chain this API serves. Network-specific behaviour hangs off this flag: a testnet API must
 * not poll mainnet venues (cross-chain is mainnet-only, and venue base URLs have mainnet defaults)
 * and must not track a ZEC price (TAZ has no market), or mainnet data would be served under
 * testnet.
 */
export const NETWORK = parseNetworkEnv();
export const IS_TESTNET = NETWORK === "testnet";

/**
 * Primary or replica (`api-role.ts`): a primary runs every background job, a replica serves routes
 * and reads the primary's in-memory state from it. Absent means primary, so a single-container
 * deployment is unchanged; a second primary on one database is refused at boot.
 */
export const ROLE = apiRoleFromEnv(process.env);
export const IS_PRIMARY = ROLE.role === "primary";

/**
 * The public, keyless `/v1` surface. The agent dispatches its tools in-process through the same
 * sub-app, so the sub-app is built whenever either flag is set, and the two stay independent: the
 * agent can run with `/v1` dark, and it only ever sees what the public API would serve a stranger.
 */
export const PUBLIC_API_ENABLED = process.env.PUBLIC_API_ENABLED === "1";
export const AGENT_ENABLED = process.env.AGENT_ENABLED === "1";

/**
 * Cross-chain is a mainnet-only dataset: no venue bridges testnet ZEC. Empty on testnet means the
 * pollers never start, the routes never mount, and `/health` reports no venues.
 */
export const MIDGARD_VENUES = IS_TESTNET ? {} : midgardVenuesFromEnv();
export const INTENTS_JWT = IS_TESTNET ? undefined : process.env.NEAR_INTENTS_API_KEY;
