/**
 * Everything on crates.io that depends on a core Zcash crate.
 *
 * This finds what no list mentions: a wallet, indexer or tool someone built on the Rust
 * stack without ever writing it up. crates.io asks crawlers for one request a second and an
 * identifying User-Agent (https://crates.io/data-access); http.mjs does both.
 *
 * A reverse dependency is a CRATE, and one project publishes several (librustzcash alone is a
 * dozen), so crates are grouped by the repository they declare — that is what merges them.
 */
import { fetchJson } from "../lib/http.mjs";

/** The crates a Zcash integration has to reach for. Adding one here widens the net. */
const CORE_CRATES = [
  "zcash_primitives",
  "zcash_protocol",
  "zcash_address",
  "zcash_keys",
  "zcash_client_backend",
  "zcash_client_sqlite",
  "zcash_proofs",
  "zcash_note_encryption",
  "orchard",
  "sapling-crypto",
  "zebra-chain",
  "zebra-rpc",
  "zip32",
];

async function reverseDependents(crate) {
  const names = new Set();
  for (let page = 1; ; page++) {
    const body = await fetchJson(
      `https://crates.io/api/v1/crates/${crate}/reverse_dependencies?per_page=100&page=${page}`,
    );
    for (const version of body.versions) names.add(version.crate);
    if (body.versions.length < 100) break;
  }
  return names;
}

export async function discoverCrates() {
  const dependsOn = new Map();
  for (const core of CORE_CRATES) {
    for (const name of await reverseDependents(core)) {
      if (!dependsOn.has(name)) dependsOn.set(name, new Set());
      dependsOn.get(name).add(core);
    }
  }

  const items = [];
  for (const [name, cores] of [...dependsOn].sort(([a], [b]) => a.localeCompare(b))) {
    const { crate } = await fetchJson(`https://crates.io/api/v1/crates/${name}`);
    const url = crate.repository || crate.homepage;
    items.push({
      source: "crates",
      strength: "dependent",
      name,
      url: url ?? `https://crates.io/crates/${name}`,
      repo: crate.repository ?? null,
      homepage: crate.homepage ?? null,
      where: `https://crates.io/crates/${name}`,
      description: crate.description ?? null,
      dependsOn: [...cores].sort(),
      updatedAt: crate.updated_at,
      downloads: crate.downloads,
    });
  }
  return { items, cratesRead: dependsOn.size };
}
