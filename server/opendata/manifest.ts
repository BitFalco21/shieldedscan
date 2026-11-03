import type { LedgerOutcome } from "./ledger-release";

/**
 * `manifest.json`, the one file that describes a release: its height and block hash, and every
 * data file with its row count and sha256. Written by the release (`opendata-main.ts`) and read
 * back by the self-host importer (`selfhost/`), which trusts no file whose hash differs from it.
 */

export interface ManifestFile {
  path: string;
  rows: number;
  bytes: number;
  sha256: string;
  contentSha256: string;
}

export type LedgerManifest =
  | { status: "withheld"; closedRanges: number; notCached: number }
  | {
      status: "published";
      closedRanges: number;
      openRange: [number, number];
      underclaimZat: string;
      underclaimedBlocks: number;
      skippedBlocks: number;
    };

export interface Manifest {
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
  ledger: LedgerManifest;
  /**
   * Files replaced whole by each release (`REPLACED` in history.ts), with the height they stand
   * at and the rich list's height they were rewound from.
   */
  snapshots: { path: string; height: number; rewoundFrom: number }[];
}

export function ledgerManifest(l: LedgerOutcome): LedgerManifest {
  if (l.status === "withheld") {
    return { status: "withheld", closedRanges: l.closed, notCached: l.notCached };
  }
  return {
    status: "published",
    closedRanges: l.carried + l.built.length,
    openRange: [l.open.start, l.open.end],
    underclaimZat: l.underclaimZat.toString(),
    underclaimedBlocks: l.underclaimedBlocks,
    skippedBlocks: l.skippedBlocks,
  };
}
