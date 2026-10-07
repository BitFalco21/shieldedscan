import type { ZipIndex } from "@/domain";
import { ZIP_SOURCE_NAME, zipStatusKind } from "@/domain";

/**
 * A small but shape-complete ZIP index: every section populated, the multi-revision
 * status (ZIP 214's real line), an unrecognised status, a Reserved row with no dates.
 * Titles and statuses match the real ZIPs where a real one is used.
 */
const entry = (
  zip: number,
  title: string,
  status: string,
  category: string | null,
  created: string | null,
) => ({ zip, title, status, statusKind: zipStatusKind(status), category, created });

const ZIPS = [
  entry(0, "ZIP Process", "Active", "Process", "2019-02-16"),
  entry(2, "Design Considerations for Network Upgrades", "Reserved", "Informational", null),
  entry(
    32,
    "Shielded Hierarchical Deterministic Wallets",
    "Final",
    "Standards / Wallet",
    "2018-05-22",
  ),
  entry(200, "Network Upgrade Mechanism", "Final", "Consensus", "2018-01-08"),
  entry(213, "Shielded Coinbase", "Final", "Consensus", "2019-03-30"),
  entry(
    214,
    "Consensus rules for a Zcash Development Fund",
    "[Revision 0: Canopy, Revision 1: NU6] Final, [Revision 2: NU6.1] Proposed",
    "Consensus",
    "2020-02-28",
  ),
  entry(218, "25-second Block Target Spacing", "Draft", "Consensus", "2025-05-14"),
  entry(
    234,
    "Network Sustainability Mechanism: Issuance Smoothing",
    "Draft",
    "Consensus",
    "2023-08-23",
  ),
  entry(271, "Deferred Dev Fund Lockbox Disbursement", "Proposed", "Consensus", "2024-11-24"),
  entry(
    305,
    "Best Practices for Hardware Wallets supporting Sapling",
    "Obsolete",
    "Informational",
    "2018-11-05",
  ),
  entry(
    320,
    "Defining an Address Type to which funds can only be sent from Transparent Addresses",
    "Withdrawn",
    "Standards / Wallet",
    "2024-01-12",
  ),
  entry(347, "A future protocol idea", "Percolating", null, null),
];

export function getZipIndex(): ZipIndex {
  return {
    asOf: 1_753_390_000,
    source: ZIP_SOURCE_NAME,
    skippedFiles: 0,
    zips: [...ZIPS],
  };
}
