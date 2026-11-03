import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Client, Pool } from "pg";
import { computeTransparentDay } from "../../../transparent-daily";
import { readAddresses } from "../../../opendata/addresses";
import { releaseLedger } from "../../../opendata/ledger-release";
import { ledgerManifest, type Manifest } from "../../../opendata/manifest";
import { readRelease } from "../../../opendata/read";
import { MINER, seedChain, SPACING, START, TIP } from "../../../opendata/__tests__/support/chain";
import { OPENDATA_ROLE_LOCK } from "../../../opendata/__tests__/support/role-lock";

/**
 * A real release of the export suites' small chain, written by the exporter itself into `outDir`
 * with its manifest, as the daily job would publish it: the input the importer is tested on.
 */

const ROOT = join(__dirname, "../../../..");

export async function buildRelease(
  adminUrl: string,
  db: string,
  outDir: string,
): Promise<Manifest> {
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${db}`);
  await admin.query(`CREATE DATABASE ${db}`);
  const url = new URL(adminUrl);
  url.pathname = `/${db}`;
  const owner = new Client({ connectionString: url.toString() });
  await owner.connect();
  try {
    for (const f of ["server/schema-chain.sql", "server/schema.sql", "server/schema-net.sql"]) {
      await owner.query(readFileSync(join(ROOT, f), "utf8"));
    }
    // The views only: this release is read as the database owner, like ledger-release.test.ts, as
    // `opendata_reader` allows two connections in the whole cluster and read.test.ts (which proves
    // the role's confinement) runs alongside. The role block runs under the shared lock.
    await admin.query("SELECT pg_advisory_lock($1)", [OPENDATA_ROLE_LOCK]);
    try {
      await owner.query(readFileSync(join(ROOT, "server/schema-opendata.sql"), "utf8"));
    } finally {
      await admin.query("SELECT pg_advisory_unlock($1)", [OPENDATA_ROLE_LOCK]);
    }
    await seedChain(owner, url);
    // The transparent tracker's days, by its own function, as the API keeps them.
    const tracker = new Pool({ connectionString: url.toString(), max: 1 });
    try {
      for (let d = 0; d < 75; d++) await computeTransparentDay(tracker, START + d * 86_400, 0);
    } finally {
      await tracker.end();
    }
    // The ledger's one address made a real t-address, and the rich list built at the tip, as the
    // follower keeps it.
    await owner.query("UPDATE tx_transparent_io SET address = $1 WHERE address = 't1coinbase'", [
      MINER,
    ]);
    await owner.query(
      `INSERT INTO chain_address_balance (address, balance_zat, received_zat, first_height, last_height, tx_count)
       SELECT address, SUM(CASE WHEN io = 'out' THEN value_zat ELSE -value_zat END),
              SUM(CASE WHEN io = 'out' THEN value_zat ELSE 0 END), MIN(block_height),
              MAX(block_height), COUNT(DISTINCT txid)
         FROM tx_transparent_io GROUP BY address`,
    );
    await owner.query(
      "INSERT INTO chain_rich_list_meta (id, unattributed_zat, computed_height) VALUES (true, 0, $1)",
      [TIP],
    );

    const release = await readRelease({
      connection: { connectionString: url.toString() },
      outDir,
      now: () => START + (TIP + 8) * SPACING,
      ledger: (ctx) =>
        releaseLedger(ctx, {
          cacheDir: join(outDir, "..", "ledger-cache"),
          outDir,
          trusted: () => false,
        }),
      addresses: (ctx) => readAddresses(ctx, { outDir }),
    });
    if (release.failures.length > 0) throw new Error(release.failures.join("; "));
    if (!release.ledger || !release.addresses?.file) throw new Error("no ledger or addresses");

    const files = release.files;
    const manifest: Manifest = {
      format: 1,
      network: "mainnet",
      height: release.height,
      hash: release.hash,
      finalDay: release.finalDay,
      generatedAt: new Date(0).toISOString(),
      indexerCommit: "test",
      files: files.map((f) => ({
        path: f.path,
        rows: f.rows,
        bytes: f.size,
        sha256: f.sha256,
        contentSha256: f.contentSha256,
      })),
      fills: [],
      acceptedHistoryChanges: [],
      checks: { underClaimedHeights: release.underClaimed, alerts: release.alerts },
      ledger: ledgerManifest(release.ledger),
      snapshots: [
        {
          path: "addresses.parquet",
          height: release.addresses.height,
          rewoundFrom: release.addresses.rewoundFrom ?? 0,
        },
      ],
    };
    writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
    return manifest;
  } finally {
    await owner.end();
    await admin.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
    await admin.end();
  }
}
