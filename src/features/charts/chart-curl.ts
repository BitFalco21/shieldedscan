import { API_GROUPS, curlCommand } from "@/api-catalogue";
import type { ChartEntry } from "./catalog";

const ENDPOINTS = new Map(API_GROUPS.flatMap((g) => g.endpoints).map((e) => [e.id, e]));

/**
 * The curl a chart page offers to copy. It is built by the same function as the API reference,
 * from the endpoint's pinned examples, so it carries every required parameter. A bare path is a
 * 400 on the windowed endpoints ("from is required"). Null when the chart has no public endpoint,
 * or its docs anchor names none.
 */
export function chartCurl(chart: ChartEntry): string | null {
  const endpoint = chart.api ? ENDPOINTS.get(chart.api.docsId) : undefined;
  return endpoint ? curlCommand(endpoint) : null;
}
