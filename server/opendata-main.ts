import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  openAsBlob,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { datasetCard } from "./opendata/card";
import { compareHistory, type PublishedFile } from "./opendata/history";
import { publishRelease } from "./opendata/publish";
import { readRelease } from "./opendata/read";

/**
 * The open dataset's daily release: ShieldedScan's chain index as Parquet files on Hugging Face.
 *
 *   docker run --rm … <opendata-image> node opendata.mjs --out /out [--publish] [--accept-history-change]
 *
 * Without `--publish` it is a dry run: the release is read, checked and written to `/out/staging`,
 * and nothing leaves the machine. With it, the release is committed to Hugging Face, read back,
 * and kept in `/out/published` as the base the next run is compared with.
 *
 * Its own entrypoint, never the API's or the follower's: it applies no schema, and its database
 * role can read the `opendata` views and nothing else.
 *
 * Env: PGHOST, PGUSER, PGPASSWORD, PGDATABASE (libpq); HF_TOKEN and OPENDATA_REPO with --publish;
 * OPENDATA_GIT_SHA, baked in at build. Exits 0 on success, 1 on any failure; `/out/status.json`
 * says which.
 */

const { values: args } = parseArgs({
  options: {
    out: { type: "string" },
    publish: { type: "boolean", default: false },
    "accept-history-change": { type: "boolean", default: false },
  },
});
const OUT = args.out;
if (!OUT) {
  console.error("--out is required");
  process.exit(1);
}

const STAGING = join(OUT, "staging");
const PUBLISHED = join(OUT, "published");
const startedAt = new Date().toISOString();

/** Anything shaped like a credential is removed from what this process prints or stores. */
function redact(text: string): string {
  return text
    .replace(/hf_[A-Za-z0-9]{8,}/g, "hf_[redacted]")
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@]*@/gi, "$1[redacted]@")
    .replace(/(password|token|secret)=\S+/gi, "$1=[redacted]");
}

const log = (line: string) => console.log(`${new Date().toISOString()} ${redact(line)}`);
const sha256 = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");

function writeStatus(status: Record<string, unknown>) {
  mkdirSync(OUT!, { recursive: true });
  const body = JSON.stringify(
    { startedAt, finishedAt: new Date().toISOString(), ...status },
    null,
    2,
  );
  writeFileSync(join(OUT!, "status.json.tmp"), body + "\n");
  renameSync(join(OUT!, "status.json.tmp"), join(OUT!, "status.json"));
}

function fail(reason: string, details: string[] = []): never {
  const safe = details.map(redact);
  log(`FAILED: ${reason}`);
  for (const d of safe) log(`  ${d}`);
  writeStatus({ ok: false, reason: redact(reason), details: safe });
  process.exit(1);
}

interface ManifestFile {
  path: string;
  rows: number;
  bytes: number;
  sha256: string;
  contentSha256: string;
}

interface Manifest {
  format: 1;
  network: "mainnet";
  height: number;
  hash: string;
  finalDay: string;
  generatedAt: string;
  indexerCommit: string;
  files: ManifestFile[];
  fills: { path: string; column: string; cells: number }[];
  acceptedHistoryChanges: string[];
  checks: { underClaimedHeights: number; alerts: string[] };
}

/** The last published release, every file verified against its manifest before it is trusted. */
function loadPublished(): { manifest: Manifest; files: PublishedFile[]; commit: string } | null {
  if (!existsSync(join(PUBLISHED, "manifest.json"))) return null;
  const manifest = JSON.parse(readFileSync(join(PUBLISHED, "manifest.json"), "utf8")) as Manifest;
  const commit = readFileSync(join(PUBLISHED, "COMMIT"), "utf8").trim();
  const files = manifest.files.map((f) => {
    const read = () => new Uint8Array(readFileSync(join(PUBLISHED, f.path)));
    if (sha256(read()) !== f.sha256) fail(`local copy of ${f.path} does not match its manifest`);
    return { path: f.path, sha256: f.sha256, read };
  });
  return { manifest, files, commit };
}

try {
  rmSync(STAGING, { recursive: true, force: true });
  const release = await readRelease({ connection: {}, log, outDir: STAGING });
  if (release.failures.length > 0) fail("checks failed", release.failures);
  for (const a of release.alerts) log(`alert: ${a}`);

  const previous = loadPublished();
  const history = compareHistory(
    previous?.files ?? [],
    release.files.map((f) => ({
      path: f.path,
      sha256: f.sha256,
      read: () => new Uint8Array(readFileSync(join(STAGING, f.path))),
    })),
  );
  if (history.failures.length > 0 && !args["accept-history-change"]) {
    fail("published data would change", history.failures);
  }

  const card = new TextEncoder().encode(datasetCard());
  const manifest: Manifest = {
    format: 1,
    network: "mainnet",
    height: release.height,
    hash: release.hash,
    finalDay: release.finalDay,
    generatedAt: new Date().toISOString(),
    indexerCommit: process.env.OPENDATA_GIT_SHA ?? "unknown",
    files: release.files.map((f) => ({
      path: f.path,
      rows: f.rows,
      bytes: f.size,
      sha256: f.sha256,
      contentSha256: f.contentSha256,
    })),
    fills: history.fills,
    acceptedHistoryChanges: args["accept-history-change"] ? history.failures : [],
    checks: { underClaimedHeights: release.underClaimed, alerts: release.alerts },
  };
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest, null, 2) + "\n");

  // The data files are already in staging, written as they were built.
  writeFileSync(join(STAGING, "README.md"), card);
  writeFileSync(join(STAGING, "manifest.json"), manifestBytes);

  // Only what changed goes up, with the manifest and the card always together with it.
  const before = new Map(previous?.manifest.files.map((f) => [f.path, f.sha256]) ?? []);
  const changed = release.files.filter((f) => before.get(f.path) !== f.sha256);
  log(
    `release ${release.height}: ${release.files.length} files, ${changed.length} changed, ` +
      `${history.fills.length} filled columns, ${release.underClaimed} under-claimed heights`,
  );

  if (!args.publish) {
    writeStatus({
      ok: true,
      dryRun: true,
      height: release.height,
      changed: changed.map((f) => f.path),
    });
    log(`dry run: release written to ${STAGING}, nothing uploaded`);
    process.exit(0);
  }

  const token = process.env.HF_TOKEN;
  const repo = process.env.OPENDATA_REPO;
  if (!token || !repo) fail("HF_TOKEN and OPENDATA_REPO are required with --publish");
  const commit = await publishRelease({
    repo,
    token,
    title: `Release at block ${release.height}`,
    parentCommit: previous?.commit ?? null,
    files: [
      ...(await Promise.all(
        changed.map(async (f) => ({
          path: f.path,
          content: await openAsBlob(join(STAGING, f.path)),
          sha256: f.sha256,
        })),
      )),
      { path: "README.md", content: new Blob([card]), sha256: sha256(card) },
      { path: "manifest.json", content: new Blob([manifestBytes]), sha256: sha256(manifestBytes) },
    ],
  });
  writeFileSync(join(STAGING, "COMMIT"), commit + "\n");
  rmSync(`${PUBLISHED}.old`, { recursive: true, force: true });
  if (existsSync(PUBLISHED)) renameSync(PUBLISHED, `${PUBLISHED}.old`);
  renameSync(STAGING, PUBLISHED);
  rmSync(`${PUBLISHED}.old`, { recursive: true, force: true });
  writeStatus({ ok: true, height: release.height, commit, changed: changed.map((f) => f.path) });
  log(`published release ${release.height} as commit ${commit}`);
  process.exit(0);
} catch (e) {
  // Some errors carry no message (a refused connection is an AggregateError with only a code):
  // a failure must always say something.
  const code = (e as { code?: unknown }).code;
  const name = e instanceof Error ? e.name : "Error";
  const message = e instanceof Error ? e.message : String(e);
  fail(message || `${name}${typeof code === "string" ? ` ${code}` : ""}`);
}
