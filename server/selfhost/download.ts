import { createHash } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
} from "node:fs";
import { stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ManifestFile } from "../opendata/manifest";
import { isSafePath, type ReleaseSource } from "./source";

/**
 * A release file on local disk, byte for byte the one the manifest describes. A file already in
 * the data directory is reused when its hash matches, so an interrupted import, or a dataset
 * fetched beforehand with the Hub's own tools, is not downloaded again.
 */

const ATTEMPTS = 3;

async function sha256OfFile(path: string): Promise<string> {
  const h = createHash("sha256");
  for await (const chunk of createReadStream(path)) h.update(chunk as Buffer);
  return h.digest("hex");
}

/** Streams to `<path>.part` while hashing, then renames: a partial file never has the real name. */
async function downloadOnce(
  source: ReleaseSource,
  commit: string,
  file: ManifestFile,
  dest: string,
): Promise<void> {
  const part = `${dest}.part`;
  const h = createHash("sha256");
  let bytes = 0;
  const tap = new Transform({
    transform(chunk: Buffer, _enc, done) {
      h.update(chunk);
      bytes += chunk.length;
      done(null, chunk);
    },
  });
  const body = await source.open(commit, file.path);
  await pipeline(
    Readable.fromWeb(body as import("node:stream/web").ReadableStream),
    tap,
    createWriteStream(part),
  );
  const sha = h.digest("hex");
  if (bytes !== file.bytes || sha !== file.sha256) {
    rmSync(part, { force: true });
    throw new Error(
      `${file.path}: downloaded ${bytes} bytes with sha256 ${sha}, expected ${file.bytes} bytes with ${file.sha256}`,
    );
  }
  renameSync(part, dest);
}

export async function fetchVerified(
  source: ReleaseSource,
  commit: string,
  file: ManifestFile,
  dataDir: string,
  log: (line: string) => void = () => {},
): Promise<string> {
  if (!isSafePath(file.path)) {
    throw new Error(`refusing an unsafe path: ${JSON.stringify(file.path)}`);
  }
  const dest = join(dataDir, file.path);
  mkdirSync(dirname(dest), { recursive: true });
  if (existsSync(dest)) {
    const size = (await stat(dest)).size;
    if (size === file.bytes && (await sha256OfFile(dest)) === file.sha256) return dest;
    log(`${file.path}: local copy does not match the manifest, downloading again`);
    rmSync(dest, { force: true });
  }
  let last: unknown;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      await downloadOnce(source, commit, file, dest);
      return dest;
    } catch (e) {
      last = e;
      if (attempt < ATTEMPTS) {
        log(`${file.path}: attempt ${attempt} failed (${String(e)}), retrying`);
      }
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}
