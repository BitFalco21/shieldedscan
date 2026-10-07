import { readTextCapped } from "../body-limit";
/**
 * The Tor Project's published clearnet exit list — keyless, so no credential and no third
 * party learns our queries. A node whose IP appears here is a Tor exit; combined with the
 * torv3 nodes (Tor by construction, from addrv2), this is the whole of the Tor count.
 *
 * `check.torproject.org/torbulkexitlist` returns one IPv4 per line. A failed fetch leaves the
 * previous list in place — a stale exit list is milder than none, and the crawler simply does
 * not refresh on that pass.
 */

export const TOR_EXIT_LIST_URL =
  process.env.TOR_EXIT_LIST_URL ?? "https://check.torproject.org/torbulkexitlist";

export function parseTorExitList(body: string): string[] {
  const out: string[] = [];
  for (const line of body.split("\n")) {
    const ip = line.trim();
    // The list is plain IPv4s; a comment or a blank line is skipped, never stored.
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) out.push(ip);
  }
  return out;
}

export async function fetchTorExitList(url = TOR_EXIT_LIST_URL): Promise<string[]> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`tor exit list HTTP ${res.status}`);
  return parseTorExitList(await readTextCapped(res));
}
