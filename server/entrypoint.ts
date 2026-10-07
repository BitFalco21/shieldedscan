/**
 * Shared plumbing for the server's process entrypoints (the API, the follower, the crawler and
 * the one-shot `*-main.ts` jobs), so each states only what is particular to it.
 */

/** One timestamped line to stdout: the container log is every process's only output. */
export function log(message: string): void {
  console.log(`${new Date().toISOString()} ${message}`);
}

/**
 * A numeric environment variable, or undefined when it is unset or empty. A value that is set but
 * not a finite number throws: a typo in a job's tuning must stop the job, not silently become NaN.
 */
export function envNumber(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${name} must be a number, got ${raw}`);
  return value;
}

/**
 * Exit unless Postgres is configured, by either `DATABASE_URL` or the `PG*` variables. `reason`
 * is appended to the message, for a process that has no in-memory mode to say so.
 */
export function requirePostgres(reason?: string): void {
  if (process.env.PGHOST || process.env.DATABASE_URL) return;
  console.error(`PGHOST or DATABASE_URL is required${reason ? ` — ${reason}` : ""}`);
  process.exit(1);
}

/**
 * Which chain this process serves, from `ZCASH_NETWORK`: `mainnet` when unset. Parsed strictly,
 * matching `src/lib/network.ts`: an unrecognised value refuses to start rather than meaning
 * mainnet, which would serve or record mainnet data under testnet.
 */
export function parseNetworkEnv(
  raw: string | undefined = process.env.ZCASH_NETWORK,
): "mainnet" | "testnet" {
  if (raw === undefined || raw === "" || raw === "mainnet") return "mainnet";
  if (raw === "testnet") return "testnet";
  throw new Error(
    `ZCASH_NETWORK must be "mainnet" or "testnet" (got ${JSON.stringify(raw)}) — refusing to ` +
      `start rather than guess, because guessing mainnet would serve mainnet money data on testnet`,
  );
}
