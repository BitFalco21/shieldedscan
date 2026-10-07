import type { Pool, PoolClient } from "pg";

/**
 * Which part this API process plays.
 *
 * `primary` (the default) runs everything: the routes and every background job (venue pollers,
 * price, market, ZIP, name and Kraken trackers, the mempool tracker, price and rate history, and
 * the backfills).
 *
 * `replica` serves routes and runs no background job. It reads the database like the primary,
 * and the little state the primary holds only in memory (the live price and the 24-hour counts)
 * from the primary itself (`live-state.ts`). This lets a public surface run in its own process,
 * sharing no heap or event loop with the site's API, without a second set of pollers: two
 * pollers on one NEAR Intents key would exceed its one-request-per-five-seconds limit.
 *
 * Parsed strictly: a typo must not silently mean primary, because a second primary duplicates
 * every poller.
 */
export type ApiRole = { role: "primary" } | { role: "replica"; primaryUrl: string };

export function apiRoleFromEnv(env: Readonly<Record<string, string | undefined>>): ApiRole {
  const raw = env.API_ROLE;
  if (raw === undefined || raw === "" || raw === "primary") return { role: "primary" };
  if (raw !== "replica") {
    throw new Error(
      `API_ROLE must be "primary" or "replica" (got ${JSON.stringify(raw)}) — refusing to start ` +
        `rather than guess, because a second primary would run every background job twice`,
    );
  }
  const url = env.PRIMARY_API_URL?.trim().replace(/\/$/, "");
  if (!url || !/^https?:\/\/[^/]+/.test(url)) {
    throw new Error(
      "API_ROLE=replica needs PRIMARY_API_URL (e.g. http://explorer-api:8080), the primary it " +
        "reads the live price and 24-hour counts from",
    );
  }
  return { role: "replica", primaryUrl: url };
}

/**
 * The advisory lock only a primary holds, so a second primary on the same database is refused at
 * boot instead of doubling every poller and backfill (for example, a replica created by copying
 * the primary's environment without `API_ROLE`).
 *
 * Session-level and held on a dedicated connection for the life of the process; it is released
 * when the process exits, so a recreate (old container stopped, new one started) passes. It
 * guards the boot, not the run: if the connection drops later, the jobs carry on.
 */
export const PRIMARY_LOCK_KEY = 0x7a63_6170; // "zcap"

export async function claimPrimary(
  pool: Pool,
  log: (m: string) => void,
  // A stopped primary's backend can take a moment to go, so a recreate is not refused for it.
  attempts = 10,
  waitMs = 1_000,
): Promise<PoolClient> {
  const client = await pool.connect();
  try {
    for (let attempt = 1; ; attempt += 1) {
      const { rows } = await client.query<{ claimed: boolean }>(
        "SELECT pg_try_advisory_lock($1) AS claimed",
        [PRIMARY_LOCK_KEY],
      );
      if (rows[0]?.claimed) break;
      if (attempt >= attempts) {
        throw new Error(
          "another primary API holds this database's primary lock — set API_ROLE=replica on " +
            "this container, or stop the other primary first",
        );
      }
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  } catch (error) {
    client.release();
    throw error;
  }
  // An idle connection the process keeps; an error on it later must not crash the API.
  client.on("error", (error) => log(`primary lock connection: ${String(error)}`));
  return client;
}
