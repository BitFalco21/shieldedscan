import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { build } from "esbuild";

/**
 * The API as a self-hosted copy runs it: the production bundle, built from `server/index.ts` as
 * the image builds it, started against the imported database with no node and the external
 * sources off, then asked a few `/v1` questions, and the caller's own (`extra`, by name).
 */

const ROOT = join(__dirname, "../../../..");
const TOKEN = "selfhost-test-token-0123456789abcdef";

export interface Answer {
  code: number;
  body: unknown;
}

type Core = "status" | "richList" | "transactions" | "reorgs" | "health" | "blocks" | "block";

export async function smokeApi<K extends string>(
  databaseUrl: string,
  dir: string,
  extra: Record<K, string> = {} as Record<K, string>,
): Promise<Record<Core | K, Answer>> {
  mkdirSync(dir, { recursive: true });
  const bundle = join(dir, "server.mjs");
  await build({
    entryPoints: [join(ROOT, "server/index.ts")],
    outfile: bundle,
    bundle: true,
    platform: "node",
    target: "node22",
    format: "esm",
    banner: {
      js: "import{createRequire}from'module';const require=createRequire(import.meta.url);",
    },
    logLevel: "error",
  });
  const child = spawn(process.execPath, [bundle], {
    cwd: dir,
    env: {
      NODE_ENV: "production",
      PATH: process.env.PATH,
      DATABASE_URL: databaseUrl,
      EXPLORER_API_TOKEN: TOKEN,
      PUBLIC_API_ENABLED: "1",
      EXTERNAL_SOURCES: "0",
      SCHEMA_PATH: join(ROOT, "server/schema.sql"),
      PORT: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stderr.on("data", (d: Buffer) => (output += d.toString()));
  try {
    const port = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`the API did not start:\n${output}`)),
        30_000,
      );
      child.stdout.on("data", (d: Buffer) => {
        output += d.toString();
        const m = /api listening on :(\d+)/.exec(output);
        if (m) {
          clearTimeout(timer);
          resolve(Number(m[1]));
        }
      });
      child.on("exit", (code) => reject(new Error(`the API exited with ${code}:\n${output}`)));
    });
    const get = async (path: string): Promise<Answer> => {
      const res = await fetch(`http://127.0.0.1:${port}${path}`);
      const text = await res.text();
      let body: unknown = text;
      try {
        body = JSON.parse(text);
      } catch {
        // Kept as text: a non-JSON answer is part of what the caller asserts on.
      }
      return { code: res.status, body };
    };
    const asked = {} as Record<K, Answer>;
    for (const [name, path] of Object.entries(extra) as [K, string][]) {
      asked[name] = await get(path);
    }
    return {
      ...asked,
      status: await get("/v1/status"),
      richList: await get("/v1/rich-list"),
      transactions: await get("/v1/transactions"),
      reorgs: await get("/v1/reorgs"),
      health: await get("/health"),
      blocks: await get("/v1/blocks?limit=3"),
      block: await get("/v1/blocks/1"),
    };
  } finally {
    child.kill("SIGTERM");
  }
}
