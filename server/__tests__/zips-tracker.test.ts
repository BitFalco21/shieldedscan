// server/__tests__/zips-tracker.test.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ZipIndexTracker } from "../zips";
import { ZIP_INDEX_PATH, zipsRoutes } from "../zips-routes";

const capture = (name: string): string =>
  readFileSync(join(__dirname, "fixtures", "zip-headers", name), "utf8");

const TREE = {
  tree: [
    { path: "zips/zip-0002.rst", type: "blob" },
    { path: "zips/zip-0213.rst", type: "blob" },
    { path: "zips/zip-0234.md", type: "blob" },
  ],
};

const BODIES: Record<string, string> = {
  "zips/zip-0002.rst": capture("zip-0002.rst.head"),
  "zips/zip-0213.rst": capture("zip-0213.rst.head"),
  "zips/zip-0234.md": capture("zip-0234.md.head"),
};

interface Harness {
  tracker: ZipIndexTracker;
  calls: () => number;
  urls: string[];
}

function harness(responder: (url: string, call: number) => Response | Promise<Response>): Harness {
  let calls = 0;
  const urls: string[] = [];
  const tracker = new ZipIndexTracker({
    githubApiBase: "https://gh.example",
    rawBase: "https://raw.example",
    log: () => undefined,
    now: () => 1_788_000_000_000,
    fetch: ((input: RequestInfo | URL) => {
      calls += 1;
      const url = String(input);
      urls.push(url);
      return Promise.resolve(responder(url, calls));
    }) as typeof globalThis.fetch,
  });
  return { tracker, calls: () => calls, urls };
}

const ok = (body: BodyInit, status = 200) => new Response(body, { status });

/** Answers the tree from the configured API base and each file from the raw base. */
const healthyResponder = (url: string): Response => {
  if (url.startsWith("https://gh.example/")) return ok(JSON.stringify(TREE));
  const path = url.replace("https://raw.example/zcash/zips/main/", "");
  const body = BODIES[path];
  return body === undefined ? ok("missing", 404) : ok(body);
};

describe("ZipIndexTracker", () => {
  it("serves nothing before the first successful refresh", () => {
    const h = harness(healthyResponder);
    expect(h.tracker.current()).toBeNull();
  });

  it("refreshes from the configured hosts, never hardcoded ones", async () => {
    const h = harness(healthyResponder);
    await h.tracker.refresh();
    expect(h.urls[0]).toBe("https://gh.example/repos/zcash/zips/git/trees/main?recursive=1");
    expect(h.urls).toContain("https://raw.example/zcash/zips/main/zips/zip-0213.rst");
    const index = h.tracker.current();
    expect(index?.zips.map((z) => z.zip)).toEqual([2, 213, 234]);
    expect(index?.asOf).toBe(1_788_000_000);
    expect(index?.source).toBe("github.com/zcash/zips");
    expect(index?.skippedFiles).toBe(0);
  });

  it("reader traffic costs zero upstream calls after the fill", async () => {
    const h = harness(healthyResponder);
    await h.tracker.refresh();
    const after = h.calls();
    h.tracker.current();
    h.tracker.current();
    expect(h.calls()).toBe(after);
  });

  it("keeps the old snapshot when ANY file fetch fails — a partial index that looks whole is the worse failure", async () => {
    // One harness whose responder is phased: a good refresh seeds the snapshot, then a
    // refresh with one failing file must leave it byte-identical.
    let failing = false;
    const h = harness((url) =>
      failing && url.endsWith("zip-0213.rst") ? ok("nope", 500) : healthyResponder(url),
    );
    await h.tracker.refresh();
    const good = h.tracker.current();
    expect(good).not.toBeNull();

    failing = true;
    await h.tracker.refresh();
    expect(h.tracker.current()).toEqual(good);
  });

  it("treats zero parsed rows as a failure, never an empty index", async () => {
    // Tree succeeds but names no ZIP files at all: ambiguous between a broken filter and
    // an upstream restructure — either way, an empty list would claim Zcash has no ZIPs.
    const h = harness((url) =>
      url.startsWith("https://gh.example/") ? ok(JSON.stringify({ tree: [] })) : ok(""),
    );
    await h.tracker.refresh();
    expect(h.tracker.current()).toBeNull();
  });

  it("counts an unparseable file as skipped without failing the refresh", async () => {
    const h = harness((url) =>
      url.endsWith("zip-0234.md") ? ok("garbage with no header") : healthyResponder(url),
    );
    await h.tracker.refresh();
    const index = h.tracker.current();
    expect(index?.zips.map((z) => z.zip)).toEqual([2, 213]);
    expect(index?.skippedFiles).toBe(1);
  });
});

describe("GET /chain/zips", () => {
  it("answers 503 while the tracker is cold, never an empty list", async () => {
    const h = harness(healthyResponder);
    const app = zipsRoutes(h.tracker);
    const res = await app.request(ZIP_INDEX_PATH);
    expect(res.status).toBe(503);
  });

  it("serves the snapshot verbatim once filled", async () => {
    const h = harness(healthyResponder);
    await h.tracker.refresh();
    const app = zipsRoutes(h.tracker);
    const res = await app.request(ZIP_INDEX_PATH);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { zips: unknown[]; asOf: number };
    expect(body.zips).toHaveLength(3);
    expect(body.asOf).toBe(1_788_000_000);
  });
});
