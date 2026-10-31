import { createHash } from "node:crypto";
import { commit, downloadFile, type CommitOperation } from "@huggingface/hub";

/**
 * One release as one Hugging Face commit, then read back.
 *
 * The commit carries the changed data files, the manifest and the card together, so visitors see
 * the previous release or this one, never a mix. `parentCommit` makes the Hub refuse it if the
 * dataset moved since our last release (a second run, a hand edit): we never overwrite what we
 * have not seen. After it lands, every file it carried is downloaded at the new commit and its
 * hash compared with what was sent.
 */

export interface UploadFile {
  path: string;
  /** Read from disk as it uploads: a first release is larger than the memory we run in. */
  content: Blob;
  sha256: string;
}

export interface PublishOptions {
  /** `Owner/name` of the dataset. */
  repo: string;
  token: string;
  title: string;
  files: readonly UploadFile[];
  /** The commit our last release created; null only for the first release. */
  parentCommit: string | null;
  fetch?: typeof fetch;
}

const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

export async function publishRelease(opts: PublishOptions): Promise<string> {
  const repo = { type: "dataset" as const, name: opts.repo };
  const operations: CommitOperation[] = opts.files.map((f) => ({
    operation: "addOrUpdate",
    path: f.path,
    content: f.content,
  }));
  const out = await commit({
    repo,
    accessToken: opts.token,
    title: opts.title,
    operations,
    branch: "main",
    ...(opts.parentCommit ? { parentCommit: opts.parentCommit } : {}),
    useXet: true,
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
  });
  const oid = out?.commit.oid;
  if (!oid) throw new Error("the Hub returned no commit");

  const mismatched: string[] = [];
  for (const f of opts.files) {
    const blob = await downloadFile({
      repo,
      path: f.path,
      revision: oid,
      accessToken: opts.token,
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
    });
    const got = blob ? sha256(new Uint8Array(await blob.arrayBuffer())) : "missing";
    if (got !== f.sha256) mismatched.push(f.path);
  }
  if (mismatched.length > 0) {
    throw new Error(
      `commit ${oid} landed, but these files read back differently: ${mismatched.join(", ")}. ` +
        "Restore the previous revision by hand before the next run.",
    );
  }
  return oid;
}
