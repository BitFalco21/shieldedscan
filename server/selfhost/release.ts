import type { Manifest } from "../opendata/manifest";
import { isSafePath, type ReleaseSource } from "./source";

/**
 * A release's manifest, read at its commit and checked for the shape the importer relies on. The
 * commit pins it (a Hub commit hash covers every file in it), and every data file is then held to
 * the hash written here.
 */

const HEX64 = /^[0-9a-f]{64}$/;

export async function readManifest(source: ReleaseSource, commit: string): Promise<Manifest> {
  const body = await source.open(commit, "manifest.json");
  const text = await new Response(body).text();
  const m = JSON.parse(text) as Manifest;
  const bad = (why: string): never => {
    throw new Error(`manifest.json at ${commit}: ${why}`);
  };
  if (m.format !== 1) bad(`format ${String(m.format)} is not one this importer reads`);
  if (m.network !== "mainnet") bad(`network ${String(m.network)}`);
  if (!Number.isSafeInteger(m.height) || m.height < 0) bad("no release height");
  if (typeof m.hash !== "string" || !HEX64.test(m.hash)) bad("no release block hash");
  if (!Array.isArray(m.files) || m.files.length === 0) bad("no files");
  for (const f of m.files) {
    if (typeof f.path !== "string" || !isSafePath(f.path)) {
      bad(`unsafe path ${JSON.stringify(f.path)}`);
    }
    if (!HEX64.test(f.sha256)) bad(`${f.path} has no sha256`);
    if (!Number.isSafeInteger(f.rows) || !Number.isSafeInteger(f.bytes)) {
      bad(`${f.path} has no size`);
    }
  }
  // Releases from before the transparent ledger was published have neither section.
  if (!m.ledger || !Array.isArray(m.snapshots)) {
    bad("it has no transparent ledger yet, which a self-hosted index needs; use a later release");
  }
  return m;
}
