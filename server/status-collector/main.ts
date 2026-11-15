import { appendFile, mkdir, open, readdir, readFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { gunzip, gzip } from "node:zlib";

import { observeSeeder } from "./dns-seeders";
import { grpcUnary } from "./grpc";
import { parseBlockId, parseLightdInfo } from "./protobuf";
import { CEX, DEX_TOKENS, coingeckoTickers, geckoPools, hyperliquidZecBooks } from "./markets";
import { JSON_TARGETS, SEEDERS, WALLET_SERVERS, type JsonTarget } from "./targets";
import {
  HOLDINGS,
  SUPPLY_TOKENS,
  UNIT_ZCASH_RESERVE,
  readOmniReserve,
  readSupply,
} from "./wrapped";

/**
 * The ecosystem status collector. Once a minute it asks the services in `targets.ts` how they are
 * and appends what they answered, one JSON line per observation, to a file per UTC day. It
 * records observations only: whether a service counts as up, behind or paused is decided later
 * from these files, so a rule can change without losing history.
 *
 * It touches nothing else of this explorer: no database, no node, and of the API only the public
 * status route every visitor can read.
 */

const DATA_DIR = process.env.STATUS_DATA_DIR ?? "/data";
const FETCH_TIMEOUT_MS = 15_000;
const SEEDERS_EVERY_MINUTES = 5;
const USER_AGENT = "shieldedscan-status/1 (+https://shieldedscan.xyz)";

export interface Observation {
  /** ISO time the observation started. */
  t: string;
  kind:
    | "wallet"
    | "seeder"
    | "json"
    | "supply"
    | "holding"
    | "reserve"
    | "dex"
    | "cex"
    | "cex-daily"
    | "cex-aggregate";
  id: string;
  ok: boolean;
  ms: number;
  data?: unknown;
  error?: string;
}

/** Service health goes to `status-` files; ZEC on other chains and its markets to `markets-`. */
export type Stream = "status" | "markets";

const STATUS_KINDS: ReadonlySet<Observation["kind"]> = new Set(["wallet", "seeder", "json"]);

export function streamOf(kind: Observation["kind"]): Stream {
  return STATUS_KINDS.has(kind) ? "status" : "markets";
}

/** The day file an observation belongs to, by the UTC day it started. */
export function dayFile(t: Date, stream: Stream = "status"): string {
  return `${stream}-${t.toISOString().slice(0, 10)}.jsonl`;
}

async function record(o: Observation): Promise<void> {
  const file = dayFile(new Date(o.t), streamOf(o.kind));
  await appendFile(join(DATA_DIR, file), `${JSON.stringify(o)}\n`);
}

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

/**
 * Gzips every day that ended more than a day ago. Yesterday stays plain, because an observation
 * started before midnight can still be writing to it.
 *
 * Crash-safe: the result is written to a temporary file, flushed and renamed over the `.gz`, and
 * only then is the plain file removed. A plain file left beside a `.gz` is either a straggler
 * (appended as a new gzip member, which readers read as one file) or the remains of a crash after
 * the rename, recognised because the `.gz` already ends with it, and simply removed.
 */
export async function compressFinishedDays(now: Date): Promise<void> {
  const yesterday = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
  for (const name of await readdir(DATA_DIR)) {
    const m = /^(?:status|markets)-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(name);
    if (!m || m[1]! >= yesterday) continue;
    const path = join(DATA_DIR, name);
    const plain = await readFile(path);
    let existing: Buffer = Buffer.alloc(0);
    try {
      existing = await readFile(`${path}.gz`);
    } catch {
      // No archive yet.
    }
    if (existing.length > 0) {
      const archived = await gunzipAsync(existing);
      if (archived.subarray(archived.length - plain.length).equals(plain)) {
        await unlink(path);
        continue;
      }
    }
    const tmp = `${path}.gz.tmp`;
    const file = await open(tmp, "w");
    try {
      await file.write(Buffer.concat([existing, await gzipAsync(plain)]));
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(tmp, `${path}.gz`);
    await unlink(path);
  }
}

async function observeWallet(host: string, port: number): Promise<Observation> {
  const t = new Date().toISOString();
  const [info, tip] = await Promise.all([
    grpcUnary(host, port, "GetLightdInfo"),
    grpcUnary(host, port, "GetLatestBlock"),
  ]);
  const data: Record<string, unknown> = { infoMs: info.ms, tipMs: tip.ms };
  const errors: string[] = [];
  try {
    if (info.ok && info.body) data.info = parseLightdInfo(info.body);
    else errors.push(`info: ${info.error ?? "no body"}`);
  } catch (err) {
    errors.push(`info: ${(err as Error).message}`);
  }
  try {
    if (tip.ok && tip.body) data.tip = parseBlockId(tip.body);
    else errors.push(`tip: ${tip.error ?? "no body"}`);
  } catch (err) {
    errors.push(`tip: ${(err as Error).message}`);
  }
  return {
    t,
    kind: "wallet",
    id: `${host}:${port}`,
    ok: errors.length === 0,
    ms: Math.max(info.ms, tip.ms),
    data,
    ...(errors.length ? { error: errors.join("; ") } : {}),
  };
}

async function observeJson(target: JsonTarget): Promise<Observation> {
  const started = Date.now();
  const t = new Date(started).toISOString();
  try {
    const res = await fetch(target.url, {
      headers: { accept: "application/json", "user-agent": USER_AGENT },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      await res.body?.cancel();
      return {
        t,
        kind: "json",
        id: target.id,
        ok: false,
        ms: Date.now() - started,
        error: `http ${res.status}`,
      };
    }
    const data = target.keep(await res.json());
    return { t, kind: "json", id: target.id, ok: true, ms: Date.now() - started, data };
  } catch (err) {
    const e = err as Error;
    return {
      t,
      kind: "json",
      id: target.id,
      ok: false,
      ms: Date.now() - started,
      // `fetch failed` alone says nothing; its cause names the DNS or socket error.
      error:
        e.name === "TimeoutError"
          ? "timeout"
          : [e.message, (e.cause as { code?: string } | undefined)?.code]
              .filter(Boolean)
              .join(": "),
    };
  }
}

async function observeSeederLine(name: string): Promise<Observation> {
  const started = Date.now();
  const t = new Date(started).toISOString();
  const data = await observeSeeder(name);
  const answered = data.answers.some((a) => (a.a ?? 0) + (a.aaaa ?? 0) > 0);
  return {
    t,
    kind: "seeder",
    id: name,
    ok: answered,
    ms: Date.now() - started,
    data,
    ...(data.error ? { error: data.error } : {}),
  };
}

/** Targets still being observed from an earlier tick. */
const inFlight = new Set<string>();

/**
 * Runs one observation and records it, whatever happens. A target still busy from an earlier tick
 * is not asked again but is recorded as skipped, and an observer that throws is recorded as a
 * failure, so a gap in the files always means the collector itself was not running.
 */
function run(kind: Observation["kind"], id: string, observe: () => Promise<Observation>): void {
  const key = `${kind} ${id}`;
  const failed = (error: string): Observation => ({
    t: new Date().toISOString(),
    kind,
    id,
    ok: false,
    ms: 0,
    error,
  });
  if (inFlight.has(key)) {
    record(failed("skipped: previous observation still running")).catch(logWriteError);
    return;
  }
  inFlight.add(key);
  Promise.resolve()
    .then(observe)
    .catch((err: unknown) => failed(`observer threw: ${(err as Error).message}`))
    .then(record)
    .catch(logWriteError)
    .finally(() => inFlight.delete(key));
}

function logWriteError(err: unknown): void {
  console.error(`write: ${(err as Error).message}`);
}

/** One observation of `fn`, timed, with any failure recorded as the observation's error. */
async function observe(
  kind: Observation["kind"],
  id: string,
  fn: () => Promise<unknown>,
): Promise<Observation> {
  const started = Date.now();
  const t = new Date(started).toISOString();
  try {
    const data = await fn();
    return { t, kind, id, ok: true, ms: Date.now() - started, data };
  } catch (err) {
    const e = err as Error;
    const cause = (e.cause as { code?: string } | undefined)?.code;
    const error =
      e.name === "TimeoutError" ? "timeout" : [e.message, cause].filter(Boolean).join(": ");
    return { t, kind, id, ok: false, ms: Date.now() - started, error };
  }
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** GeckoTerminal allows about 30 calls a minute without a key: one token every four seconds. */
async function observeDexPools(): Promise<void> {
  for (const [id, network, address] of DEX_TOKENS) {
    await record(await observe("dex", `geckoterminal:${id}`, () => geckoPools(network, address)));
    await pause(4_000);
  }
}

/** Minute of the hour each markets job runs at, spread so they never start together. */
const AT = { supply: 7, reserve: 8, dex: 20, hyperliquid: 25, cex: 30, aggregate: 35 } as const;
/** Minute of the UTC day for the once-a-day jobs: closed daily candles and every reserve coin. */
const DAILY_AT = { candles: 15, reserveCoins: 9 } as const;

function marketsTick(minute: number): void {
  const ofHour = minute % 60;
  const ofDay = minute % 1440;
  if (ofHour === AT.supply) {
    for (const tok of SUPPLY_TOKENS)
      run("supply", tok.id, () => observe("supply", tok.id, () => readSupply(tok)));
    for (const h of HOLDINGS) run("holding", h.id, () => observe("holding", h.id, h.read));
  }
  if (ofHour === AT.reserve) {
    run("reserve", "near-omni", () =>
      observe("reserve", "near-omni", () => readOmniReserve(false)),
    );
    run("reserve", "hyperliquid-unit", () =>
      observe("reserve", "hyperliquid-unit", async () => {
        // Our own index, through the public API in-network: the same figure any visitor can read.
        const res = await fetch(
          `http://explorer-api-public:8080/v1/addresses/${UNIT_ZCASH_RESERVE}`,
          {
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          },
        );
        if (!res.ok) throw new Error(`http ${res.status}`);
        const o = (await res.json()) as { balanceZat?: unknown };
        if (typeof o.balanceZat !== "number") throw new Error("unexpected shape: balanceZat");
        return { address: UNIT_ZCASH_RESERVE, zat: String(o.balanceZat) };
      }),
    );
  }
  if (ofDay === DAILY_AT.reserveCoins)
    run("reserve", "near-omni:coins", () =>
      observe("reserve", "near-omni:coins", () => readOmniReserve(true)),
    );
  if (ofHour === AT.dex && !inFlight.has("dex geckoterminal")) {
    inFlight.add("dex geckoterminal");
    observeDexPools()
      .catch(logWriteError)
      .finally(() => inFlight.delete("dex geckoterminal"));
  }
  if (ofHour === AT.hyperliquid)
    run("dex", "hyperliquid", () => observe("dex", "hyperliquid", hyperliquidZecBooks));
  if (ofHour === AT.cex)
    for (const v of CEX) run("cex", v.id, () => observe("cex", v.id, v.ticker));
  if (ofDay === DAILY_AT.candles)
    for (const v of CEX) run("cex-daily", v.id, () => observe("cex-daily", v.id, v.candles));
  if (ofHour === AT.aggregate)
    run("cex-aggregate", "coingecko", () =>
      observe("cex-aggregate", "coingecko", coingeckoTickers),
    );
}

let lastDay = "";
let lastMinute = 0;
let compressing = false;

function tick(): void {
  const now = new Date();
  const minute = Math.round(now.getTime() / 60_000);
  // A timer can fire a millisecond early; rounding and this guard keep each minute to one tick.
  if (minute <= lastMinute) return;
  lastMinute = minute;
  const day = dayFile(now);
  if (day !== lastDay && !compressing) {
    lastDay = day;
    compressing = true;
    compressFinishedDays(now)
      .catch((err: unknown) => console.error(`compress: ${(err as Error).message}`))
      .finally(() => {
        compressing = false;
      });
  }
  for (const w of WALLET_SERVERS)
    run("wallet", `${w.host}:${w.port}`, () => observeWallet(w.host, w.port));
  for (const target of JSON_TARGETS) {
    if (minute % target.everyMinutes === 0) run("json", target.id, () => observeJson(target));
  }
  if (minute % SEEDERS_EVERY_MINUTES === 0) {
    for (const s of SEEDERS) run("seeder", s.name, () => observeSeederLine(s.name));
  }
  marketsTick(minute);
}

async function main(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  console.log(
    `status collector: ${WALLET_SERVERS.length} wallet servers, ${SEEDERS.length} seeders, ${JSON_TARGETS.length} JSON targets, ${SUPPLY_TOKENS.length} ZEC tokens, ${CEX.length} exchanges → ${DATA_DIR}`,
  );
  process.on("SIGTERM", () => process.exit(0));
  process.on("SIGINT", () => process.exit(0));
  const schedule = () => {
    // Fire just after the minute, so every service is asked at the same moment as our own tip.
    const wait = 60_000 - (Date.now() % 60_000) + 50;
    setTimeout(() => {
      tick();
      schedule();
    }, wait);
  };
  tick();
  schedule();
}

if (process.argv[1]?.endsWith("status-collector.mjs")) void main();
