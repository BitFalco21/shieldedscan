import type { Pool, PoolClient } from "pg";

/**
 * Advisory lock keys for the rollups, distinct from the API's `PRIMARY_LOCK_KEY`.
 *
 * `ROLLUP_PASS_LOCK` serialises everything that writes rollup tables: the follower's pass, the
 * paced fill and the swap. It is a session lock taken BEFORE the writer's transaction begins and
 * released after it commits, so the next holder's snapshot always contains the previous holder's
 * commit and an older recompute can never overwrite a newer one.
 *
 * `MATVIEW_REFRESH_LOCK` is held shared by each transitional `REFRESH` of a not-yet-swapped view
 * and exclusively by the swap, so the swap never waits behind a long refresh with API reads queued
 * behind it.
 */
export const ROLLUP_PASS_LOCK = 0x726f_6c6c; // "roll"
export const MATVIEW_REFRESH_LOCK = 0x6d76_7266; // "mvrf"

export interface LockOptions {
  /** Wait for the lock rather than give up at once. */
  wait?: boolean;
  shared?: boolean;
}

/**
 * Run `work` on a dedicated connection holding a session advisory lock, or return `null` when the
 * lock is taken and `wait` is false.
 *
 * The lock is released in `finally`. If anything failed, the connection is destroyed rather than
 * returned to the pool: a session lock left on a pooled connection would outlive the failure and
 * lock every later pass out, silently.
 */
export async function withSessionLock<T>(
  pool: Pool,
  key: number,
  options: LockOptions,
  work: (client: PoolClient) => Promise<T>,
): Promise<T | null> {
  const client = await pool.connect();
  // A backend terminated while checked out raises an `error` event; unlistened, it kills the process.
  const onError = () => undefined;
  client.on("error", onError);
  const kind = options.shared ? "_shared" : "";
  let failure: Error | undefined;
  let locked = false;
  try {
    if (options.wait) {
      await client.query(`SELECT pg_advisory_lock${kind}($1)`, [key]);
      locked = true;
    } else {
      const { rows } = await client.query<{ ok: boolean }>(
        `SELECT pg_try_advisory_lock${kind}($1) AS ok`,
        [key],
      );
      locked = rows[0]?.ok === true;
      if (!locked) return null;
    }
    return await work(client);
  } catch (error) {
    failure = error instanceof Error ? error : new Error(String(error));
    throw error;
  } finally {
    if (locked && failure === undefined) {
      await client
        .query(`SELECT pg_advisory_unlock${kind}($1)`, [key])
        .catch((e: unknown) => (failure = e instanceof Error ? e : new Error(String(e))));
    }
    client.off("error", onError);
    client.release(failure);
  }
}
