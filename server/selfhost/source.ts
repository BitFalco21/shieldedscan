/**
 * Where a release is read from: a Hugging Face dataset over plain HTTP, with no token, since the
 * dataset is public. The base URL is configurable (`HF_ENDPOINT`, as the Hub's own tools name it)
 * so a mirror, or a test serving a local directory, stands in for the Hub.
 *
 * Everything is read at one commit: a release is a single Hub commit, and a branch name would let
 * a file come from the next release halfway through an import.
 */

export interface ReleaseSource {
  /** The commit a revision (branch, tag or commit) points at now. */
  resolve(revision: string): Promise<string>;
  /** One file of the dataset at `commit`. The caller checks its hash. */
  open(commit: string, path: string): Promise<ReadableStream<Uint8Array>>;
}

export const DEFAULT_ENDPOINT = "https://huggingface.co";
export const DEFAULT_REPO = "Shieldedscanxyz/zcash-mainnet";

const COMMIT = /^[0-9a-f]{40}$/;
/** Dataset paths are ours, but a manifest is still input: nothing may climb out of the data dir. */
const SAFE_PATH = /^(?!.*\.\.)[A-Za-z0-9_][A-Za-z0-9_./-]*$/;

export function isSafePath(path: string): boolean {
  return SAFE_PATH.test(path);
}

export function huggingFaceSource(opts: {
  repo: string;
  endpoint?: string;
  fetch?: typeof fetch;
}): ReleaseSource {
  const base = (opts.endpoint ?? DEFAULT_ENDPOINT).replace(/\/$/, "");
  const get = opts.fetch ?? globalThis.fetch;
  const repo = opts.repo
    .split("/")
    .map((p) => encodeURIComponent(p))
    .join("/");
  return {
    async resolve(revision) {
      if (COMMIT.test(revision)) return revision;
      const url = `${base}/api/datasets/${repo}/revision/${encodeURIComponent(revision)}`;
      const res = await get(url);
      if (!res.ok) throw new Error(`could not resolve ${revision}: HTTP ${res.status}`);
      const sha = ((await res.json()) as { sha?: unknown }).sha;
      if (typeof sha !== "string" || !COMMIT.test(sha)) {
        throw new Error(`the Hub answered no commit for ${revision}`);
      }
      return sha;
    },
    async open(commit, path) {
      if (!COMMIT.test(commit)) throw new Error(`not a commit: ${commit}`);
      if (!isSafePath(path)) throw new Error(`refusing an unsafe path: ${JSON.stringify(path)}`);
      // The Hub redirects large files to its storage; fetch follows the redirect.
      const res = await get(`${base}/datasets/${repo}/resolve/${commit}/${path}`);
      if (!res.ok || !res.body) throw new Error(`${path}: HTTP ${res.status}`);
      return res.body;
    },
  };
}
