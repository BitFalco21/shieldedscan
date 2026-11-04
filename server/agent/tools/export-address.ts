import { classifyZcashAddress, type DataExportCard } from "@/domain";
import {
  ADDRESS_EXPORT_CAP,
  addressExportFileName,
  tooLargeMessage,
} from "../../v1/export/address-route";
import { ADDRESS_EXPORT_COLUMNS } from "../../v1/export/address-columns";
import type { ExportPreviewCache } from "./export-cache";
import type { ExportReader } from "./export-preview";
import type { ExportRefusal } from "./export-refusal";
import { addressTarget } from "./export-targets";
import { asRecord, parseJson } from "./json";

/**
 * One transparent address's whole history as a file, for an address the reader typed.
 *
 * Zeno never walks the history: the walk runs once, when the reader downloads the file, behind the
 * export route's own cap, admission gate and Caddy zones. What Zeno checks first is cheap and is the
 * route's own bound: the address's lifetime transaction count, read from `/v1/addresses/{address}`
 * (the same `lifetimeTxCount` reader the route caps on), so a card is never offered for a file the
 * route would refuse with its 422.
 */

/** What the address lookup said, as far as the export needs it. */
export type AddressRead = { found: false } | { found: true; txCount: number | null };

/** The address lookup moves with every block, like a list. */
export const ADDRESS_TTL_MS = 10_000;

const refuse = (
  reason: ExportRefusal["reason"],
  message: string,
  extra: Partial<ExportRefusal> = {},
): ExportRefusal => ({ reason, message, ...extra });

export async function readAddress(
  read: ExportReader,
  address: string,
): Promise<AddressRead | null> {
  const res = await read(`/v1/addresses/${encodeURIComponent(address)}`);
  if (res.status === 404) return { found: false };
  if (res.status !== 200) return null;
  const body = asRecord(parseJson(res.body));
  if (body === null || body.kind !== "transparent" || body.address !== address) return null;
  const count = body.txCount;
  if (count === null) return { found: true, txCount: null };
  return typeof count === "number" && Number.isSafeInteger(count) && count >= 0
    ? { found: true, txCount: count }
    : null;
}

export interface AddressExport {
  card: DataExportCard;
  /** What the model may say about the file. */
  columns: { name: string; type: string; description: string }[];
  hint: string;
}

/**
 * The card, or why there is none. `userText` is everything the reader typed in this conversation:
 * an address that is not in it came from somewhere else (a tool's data, an injected instruction),
 * and a file of its history is not offered.
 */
export async function addressExport(
  address: string,
  userText: string,
  read: ExportReader,
  cache: ExportPreviewCache<AddressRead>,
): Promise<AddressExport | ExportRefusal> {
  const kind = classifyZcashAddress(address);
  if (kind === "sapling" || kind === "unified") {
    return refuse(
      "per-address",
      "a shielded address has no public history: its transactions are encrypted on-chain by design, so there is no file to make",
    );
  }
  if (kind !== "transparent") {
    return refuse(
      "per-address",
      "that is not a transparent Zcash address; ask the reader to paste the t1… or t3… address itself",
    );
  }
  if (!userText.includes(address)) {
    return refuse(
      "per-address",
      "an address's history is exported only for an address the reader typed in this conversation; ask them to paste the t1… or t3… address",
    );
  }
  const target = addressTarget(address);
  const lookup = await cache.get(target.path, ADDRESS_TTL_MS, () => readAddress(read, address));
  if (lookup === null) {
    return refuse(
      "unavailable",
      "the address could not be read just now, so no file was offered — say so, and give no figure in its place",
    );
  }
  if (!lookup.found || lookup.txCount === 0) {
    return refuse(
      "not-exportable",
      "no transactions are recorded for this address, so there is no file to make",
    );
  }
  if (lookup.txCount === null) {
    return refuse(
      "unavailable",
      "this address's transaction count cannot be read right now, so the file cannot be bounded and none was offered; retry later",
    );
  }
  if (lookup.txCount > ADDRESS_EXPORT_CAP) {
    return refuse("too-large", tooLargeMessage(lookup.txCount, ADDRESS_EXPORT_CAP), {
      openDataset: true,
    });
  }
  return {
    card: {
      v: 1,
      dataset: "address-transactions-history",
      path: target.path,
      query: target.query,
      fileName: addressExportFileName(address, "csv"),
      rows: lookup.txCount,
      paged: false,
      truncated: false,
      readOnDownload: true,
      columns: ADDRESS_EXPORT_COLUMNS.map(({ name, type }) => ({ name, type })),
      through: null,
      height: null,
      coverage: null,
      preview: [],
    },
    columns: ADDRESS_EXPORT_COLUMNS.map(({ name, type, description }) => ({
      name,
      type,
      description,
    })),
    hint: target.hint,
  };
}
