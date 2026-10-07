import type { ZipEntry, ZipIndex } from "@/domain";
import { ZIP_SOURCE_NAME, zipStatusKind } from "@/domain";
import { printableOnly } from "@/lib/printable";
import { readTextCapped } from "./body-limit";

/**
 * The ZIP index read from github.com/zcash/zips. Everything parsed here is text ZIP authors wrote,
 * so it is sanitised at this boundary once and rendered as text; an entry's number comes from the
 * filename, and links are built from that number alone in `domain/zips.ts`.
 *
 * Header format (captures in `__tests__/fixtures/zip-headers/`): an RFC-822-style `Key: Value`
 * block, indented after `::` in .rst or inside a ``` fence in .md, with indented continuation lines
 * (Owners) and possibly-empty values (Credits:). Created and Owners are optional, and a Status line
 * can carry several bracketed revision qualifiers, which are kept whole rather than split.
 */

/** Numbered ZIP documents only: anchored so zip-0032-*.svg and draft-*.md cannot match. */
export const ZIP_FILE_RE = /^zips\/zip-(\d{1,4})\.(?:rst|md)$/;

const TITLE_MAX = 200;
/**
 * A runaway bound, never the display grain. Real Status lines exceed 64 characters, so the cap sits
 * well above every observed field; a header that reaches it is anomalous, and `sanitizeField`
 * marks the cut with an ellipsis so it reads as elided rather than as text somebody wrote.
 */
const FIELD_MAX = 200;

/**
 * Third-party text made safe for a page: whitespace collapsed first (dropping a newline would fuse
 * two words), then anything unprintable removed via the site's single definition (`printableOnly`),
 * then trimmed, then capped.
 */
function sanitizeField(value: string, max: number): string {
  const out = printableOnly(value.replace(/\s+/g, " ")).trim();
  // A cut is marked with an ellipsis, so it cannot read as a value somebody wrote. The cap sits far
  // above every observed value, so this should never fire.
  return out.length > max ? `${out.slice(0, max)}\u2026` : out;
}

/** A YYYY-MM-DD that survives the round-trip; 2026-02-31 parses and is NOT a date. */
function validDayOrNull(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10) === value ? value : null;
}

/**
 * The tree API's `{ tree: [{path, type}] }`, filtered to numbered ZIP documents.
 *
 * Deduped by ZIP number after sorting, keeping the first path: an upstream rst→md conversion can
 * briefly carry both files for one ZIP.
 */
export function parseZipTree(body: unknown): string[] {
  const tree = (body as { tree?: unknown })?.tree;
  if (!Array.isArray(tree)) throw new Error("unrecognised github tree response shape");
  const paths: string[] = [];
  for (const node of tree) {
    const path = (node as { path?: unknown })?.path;
    const type = (node as { type?: unknown })?.type;
    if (typeof path === "string" && type === "blob" && ZIP_FILE_RE.test(path)) {
      paths.push(path);
    }
  }
  paths.sort();

  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const path of paths) {
    const zip = ZIP_FILE_RE.exec(path)![1]!;
    if (seen.has(zip)) continue;
    seen.add(zip);
    deduped.push(path);
  }
  return deduped;
}

/**
 * Extract the header block: from the first line whose trimmed form starts `ZIP:` until a
 * blank line, a fence, or any line that is neither a `Key: Value` at the block's indent
 * nor a deeper-indented continuation.
 */
function extractHeader(body: string): Map<string, string> | null {
  const lines = body.split("\n");
  const startIdx = lines.findIndex((l) => /^\s*ZIP:\s*\d/.test(l));
  if (startIdx === -1) return null;
  const indent = /^(\s*)/.exec(lines[startIdx]!)![1]!.length;

  const fields = new Map<string, string>();
  let currentKey: string | null = null;
  for (let i = startIdx; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (line.trim() === "" || line.trim().startsWith("```")) break;
    const lineIndent = /^(\s*)/.exec(line)![1]!.length;
    const keyMatch = /^([A-Za-z][A-Za-z-]*):(.*)$/.exec(line.slice(indent));
    if (lineIndent === indent && keyMatch) {
      currentKey = keyMatch[1]!;
      fields.set(currentKey, keyMatch[2]!.trim());
    } else if (lineIndent > indent && currentKey !== null) {
      // Continuation line (Owners' second address). Appended so it cannot bleed into the
      // NEXT field; we keep no multi-value field, so the joined value is simply longer.
      fields.set(currentKey, `${fields.get(currentKey)} ${line.trim()}`.trim());
    } else {
      break;
    }
  }
  return fields.size > 0 ? fields : null;
}

/**
 * One file → one entry, or null when the file is not a parseable numbered ZIP.
 *
 * Null is a skip, counted by the tracker, never a refresh failure: a malformed header is
 * permanent, and failing on it would brick the index until the upstream file changes. A transient
 * fetch failure, by contrast, does fail the refresh.
 */
export function parseZipFile(path: string, body: string): ZipEntry | null {
  const match = ZIP_FILE_RE.exec(path);
  if (match === null) return null;
  const zip = Number(match[1]);

  const fields = extractHeader(body);
  if (fields === null) return null;

  const title = sanitizeField(fields.get("Title") ?? "", TITLE_MAX);
  const status = sanitizeField(fields.get("Status") ?? "", FIELD_MAX);
  if (title === "" || status === "") return null;

  const rawCategory = sanitizeField(fields.get("Category") ?? "", FIELD_MAX);
  const rawCreated = fields.get("Created") ?? "";

  return {
    zip,
    title,
    status,
    statusKind: zipStatusKind(status),
    category: rawCategory === "" ? null : rawCategory,
    created: validDayOrNull(rawCreated.trim()),
  };
}

/** Statuses move on the order of weeks; 6 hours is generous and ~4 tree calls a day. */
const ZIPS_REFRESH_MS = 6 * 60 * 60_000;
/** The header block is inside the first kilobyte; 4 KiB leaves margin. */
const HEAD_BYTES = 4096;
/** Bounded fan-out: never an unbounded Promise.all against a third party. */
const FETCH_CONCURRENCY = 8;

export interface ZipTrackerDeps {
  /** e.g. https://api.github.com — env ZIPS_GITHUB_API_URL. */
  githubApiBase: string;
  /** e.g. https://raw.githubusercontent.com — env ZIPS_RAW_URL. */
  rawBase: string;
  log: (m: string) => void;
  now: () => number;
  fetch: typeof globalThis.fetch;
}

async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      results[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Holds the last good ZIP index in memory and refreshes it on an interval.
 *
 * No max-age withholding, unlike MarketCapTracker: a ZIP status changes over weeks, and the `asOf`
 * travels with the payload, so a stale snapshot is visibly dated. No Postgres: a cold boot pays one
 * refresh.
 *
 * Failure model:
 *  - a transient fetch failure (tree or any file) fails the whole refresh and keeps the old
 *    snapshot, because a partial index that looks whole is worse than a stale one;
 *  - an unparseable file is skipped and counted (a malformed header is permanent);
 *  - zero parsed rows fails the refresh: indistinguishable from a broken parser, and an empty list
 *    would claim Zcash has no improvement proposals.
 */
export class ZipIndexTracker {
  #index: ZipIndex | null = null;
  #timer: NodeJS.Timeout | null = null;

  constructor(private readonly deps: ZipTrackerDeps) {}

  current(): ZipIndex | null {
    return this.#index;
  }

  async #fetchText(url: string, headers?: Record<string, string>): Promise<string> {
    const res = await this.deps.fetch(url, {
      headers: { accept: "*/*", ...headers },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return readTextCapped(res);
  }

  async refresh(): Promise<void> {
    try {
      const treeUrl = `${this.deps.githubApiBase}/repos/zcash/zips/git/trees/main?recursive=1`;
      const treeBody: unknown = JSON.parse(
        await this.#fetchText(treeUrl, { accept: "application/vnd.github+json" }),
      );
      const paths = parseZipTree(treeBody);
      if (paths.length === 0) throw new Error("tree named no ZIP files");

      const entries = await mapLimit(paths, FETCH_CONCURRENCY, async (path) => {
        const head = await this.#fetchText(`${this.deps.rawBase}/zcash/zips/main/${path}`, {
          range: `bytes=0-${HEAD_BYTES - 1}`,
        });
        return parseZipFile(path, head);
      });

      const zips = entries
        .filter((e): e is NonNullable<typeof e> => e !== null)
        .sort((a, b) => a.zip - b.zip);
      const skippedFiles = entries.length - zips.length;
      if (zips.length === 0) throw new Error("no ZIP header parsed — refusing an empty index");

      this.#index = {
        asOf: Math.floor(this.deps.now() / 1000),
        source: ZIP_SOURCE_NAME,
        skippedFiles,
        zips,
      };
      this.deps.log(`[zips] index refreshed: ${zips.length} ZIPs, ${skippedFiles} skipped`);
    } catch (error) {
      // Keep the previous snapshot; a failure is never stored.
      this.deps.log(`[zips] refresh failed: ${String(error)}`);
    }
  }

  start(): () => void {
    void this.refresh();
    const timer = setInterval(() => void this.refresh(), ZIPS_REFRESH_MS);
    timer.unref();
    this.#timer = timer;
    return () => {
      if (this.#timer !== null) clearInterval(this.#timer);
    };
  }
}
