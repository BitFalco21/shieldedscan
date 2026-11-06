// @vitest-environment node
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { chromium, type Browser } from "@playwright/test";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Manifest } from "../../opendata/manifest";
import { MINER } from "../../opendata/__tests__/support/chain";
import { DEFAULT_REPO } from "../source";
import { serveRelease, type Hub } from "./support/hub";
import { buildRelease } from "./support/release";

/**
 * `selfhost/compose.yml --profile full`, end to end, on a release of the export suites' small chain
 * instead of the real dataset: the images built from this checkout, the importer reading the
 * release from a local stand-in for the Hub, and then the read-only role, the API and the website
 * each asked what a self-hoster would ask. No node, so what needs one must say "unavailable".
 *
 * Slow (it builds five images) and needs Docker, so it runs only with SELFHOST_SMOKE=1, plus
 * TEST_DATABASE_URL to write the release. Everything it starts is removed afterwards: containers,
 * volumes, and the images it built.
 */
const ADMIN_URL = process.env.TEST_DATABASE_URL;
const ENABLED = process.env.SELFHOST_SMOKE === "1" && Boolean(ADMIN_URL);
const ROOT = join(__dirname, "../../..");
const PROJECT = `shieldedscan-smoke-${process.pid}`;
const COMMIT = "5ca1ab1e".padEnd(40, "0");
const run = promisify(execFile);

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function waitFor(what: string, ms: number, ok: () => Promise<boolean>): Promise<void> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await ok().catch(() => false)) return;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(`timed out waiting for ${what}`);
}

describe.skipIf(!ENABLED)("self-host compose, full profile", () => {
  let work: string;
  let hub: Hub;
  let manifest: Manifest;
  let browser: Browser | undefined;
  const ports = { postgres: 0, api: 0, web: 0 };
  const secrets = {
    postgres: randomBytes(18).toString("hex"),
    reader: randomBytes(18).toString("hex"),
    token: randomBytes(24).toString("hex"),
  };
  let envFile: string;

  const composeAs = async (profile: string, ...args: string[]) =>
    run(
      "docker",
      ["compose", "-p", PROJECT, "-f", join(ROOT, "selfhost/compose.yml"), "--env-file", envFile]
        .concat(["--profile", profile])
        .concat(args),
      { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 },
    );
  const compose = (...args: string[]) => composeAs("full", ...args);
  const api = (path: string, init?: RequestInit) =>
    fetch(`http://127.0.0.1:${ports.api}${path}`, init);
  const site = (path: string) => fetch(`http://127.0.0.1:${ports.web}${path}`);

  /** The page's text as a reader sees it, once the client has rendered. */
  async function rendered(path: string): Promise<{ status: number; text: string; csp: string[] }> {
    browser ??= await chromium.launch();
    const page = await browser.newPage();
    const csp: string[] = [];
    page.on("console", (m) => {
      if (/Content Security Policy/i.test(m.text())) csp.push(m.text());
    });
    try {
      const res = await page.goto(`http://localhost:${ports.web}${path}`, {
        waitUntil: "networkidle",
      });
      return { status: res?.status() ?? 0, text: await page.innerText("body"), csp };
    } finally {
      await page.close();
    }
  }

  beforeAll(async () => {
    work = mkdtempSync(join(tmpdir(), "selfhost-smoke-"));
    manifest = await buildRelease(ADMIN_URL!, `selfhost_smoke_src_${process.pid}`, join(work, "r"));
    // On every interface: the importer reaches it from a container, through the host gateway.
    hub = await serveRelease({
      dir: join(work, "r"),
      repo: DEFAULT_REPO,
      commit: COMMIT,
      host: "0.0.0.0",
    });
    ports.postgres = await freePort();
    ports.api = await freePort();
    ports.web = await freePort();
    envFile = join(work, "smoke.env");
    writeFileSync(
      envFile,
      [
        `POSTGRES_PASSWORD=${secrets.postgres}`,
        `EXPLORER_API_TOKEN=${secrets.token}`,
        `POSTGRES_READONLY_PASSWORD=${secrets.reader}`,
        `HF_ENDPOINT=http://host.docker.internal:${new URL(hub.endpoint).port}`,
        `POSTGRES_PORT=${ports.postgres}`,
        `API_PORT=${ports.api}`,
        `WEB_PORT=${ports.web}`,
        "PG_SHARED_BUFFERS=128MB",
        "SELFHOST_MAINTENANCE_WORK_MEM=64MB",
        "",
      ].join("\n"),
      { mode: 0o600 },
    );
    await compose("up", "-d", "--build");
    await waitFor("the website", 15 * 60_000, async () => (await site("/terms")).ok);
  }, 45 * 60_000);

  afterAll(async () => {
    await browser?.close();
    if (envFile) await compose("down", "-v", "--rmi", "local", "--remove-orphans").catch(() => {});
    await hub?.close();
    if (work) rmSync(work, { recursive: true, force: true });
  }, 10 * 60_000);

  it("adds one surface per profile", async () => {
    const services = async (profile: string) =>
      (await composeAs(profile, "config", "--services")).stdout.trim().split("\n").sort();
    const db = ["follower", "importer", "postgres"];
    expect(await services("db")).toEqual(db);
    expect(await services("api")).toEqual([...db, "api"].sort());
    expect(await services("full")).toEqual([...db, "api", "web"].sort());
  });

  it("imported the release, and the follower stood down without a node", async () => {
    const { stdout } = await compose("logs", "--no-color", "importer", "follower");
    expect(stdout).toMatch(new RegExp(`done in .* block ${manifest.height} `));
    expect(stdout).toContain("read-only role shieldedscan_reader: login enabled");
    expect(stdout).toContain("NODE_RPC_URL is not set: no follower");
    // Its password never reaches a log.
    expect(stdout).not.toContain(secrets.reader);
  });

  it("gives your own apps a login that reads every table and writes none", async () => {
    const reader = new Client({
      host: "127.0.0.1",
      port: ports.postgres,
      user: "shieldedscan_reader",
      password: secrets.reader,
      database: "shieldedscan",
    });
    await reader.connect();
    try {
      const { rows } = await reader.query<{ n: number }>("SELECT count(*)::int AS n FROM block");
      expect(rows[0]!.n).toBe(manifest.height + 1);
      await reader.query("SELECT 1 FROM chain_day_rollup LIMIT 1");
      await reader.query("SET default_transaction_read_only = off");
      await expect(reader.query("DELETE FROM block")).rejects.toThrow(/permission denied/);
      await expect(reader.query("CREATE TABLE mine (x int)")).rejects.toThrow(/permission denied/);
    } finally {
      await reader.end();
    }
  });

  it("serves the keyless /v1 API and MCP to any origin, from the release", async () => {
    const catalogue = (await (await api("/v1")).json()) as { endpoints: string[] };
    expect(catalogue.endpoints).toContain("GET /v1/blocks");

    const blocks = await api("/v1/blocks?limit=3", { headers: { origin: "https://example.org" } });
    expect(blocks.status).toBe(200);
    expect(blocks.headers.get("access-control-allow-origin")).toBe("*");
    const { items } = (await blocks.json()) as { items: { height: number; hash: string }[] };
    expect(items[0]).toMatchObject({ height: manifest.height, hash: manifest.hash });

    expect(JSON.stringify(await (await api("/v1/rich-list")).json())).toContain(MINER);
    // A block's header is the node's alone: an outage, never a 404 or a guess.
    expect((await api("/v1/blocks/1")).status).toBe(503);

    const mcp = await api("/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "chain_info", arguments: {} },
      }),
    });
    expect(mcp.status).toBe(200);
    expect(await mcp.text()).toContain(`\\"height\\":${manifest.height}`);

    // The private routes stay behind the token.
    expect((await api("/chain/info")).status).toBe(401);
  });

  it("serves the website from the local API, with headers that work over plain http", async () => {
    const home = await site("/");
    expect(home.status).toBe(200);
    const csp = home.headers.get("content-security-policy") ?? "";
    expect(csp).not.toContain("upgrade-insecure-requests");
    expect(csp).toContain(`connect-src 'self' http://127.0.0.1:${ports.api}`);
    expect(home.headers.get("strict-transport-security")).toBeNull();

    const blocks = await rendered("/blocks");
    expect(blocks.status).toBe(200);
    expect(blocks.text).toContain(manifest.height.toLocaleString("en-US"));
    expect(blocks.csp).toEqual([]);

    const richList = await rendered("/rich-list");
    expect(richList.text).toContain(MINER.slice(0, 8));
  }, 120_000);

  it("says what needs a node or a collector is unavailable, never a figure", async () => {
    for (const path of [`/block/${manifest.height}`, `/address/${MINER}`, "/cross-chain"]) {
      const page = await rendered(path);
      expect(page.text, path).toMatch(/unavailable|didn.t load|could not be read/i);
    }
  }, 120_000);
});
