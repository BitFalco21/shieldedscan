import { getMinerSeries, getMinersOverview, getMiningPoolBlocks } from "@/fixtures/miners";
import { getNsmOverview } from "@/fixtures/nsm";
import { getBlockArrival } from "@/fixtures/block-arrival";
import { TIP_TIME } from "@/fixtures/ids";
import type { MinersReader } from "../../miners-routes";

/**
 * The `/miners` reads over the fixture chain, for the routes that read them without a database.
 * The fixtures sit on their own clock: pair them with `MINERS_FIXTURE_NOW_MS`.
 */
export const MINERS_FIXTURE_NOW_MS = TIP_TIME * 1000;

export function fixtureMinersReader(): MinersReader {
  return {
    overview: async (window) => getMinersOverview(window),
    series: async (interval) => getMinerSeries(interval),
    poolBlocks: async (id, page = {}) =>
      getMiningPoolBlocks(id)
        .filter((b) => page.beforeHeight === undefined || b.height < page.beforeHeight)
        .slice(0, page.limit ?? 20),
    nsm: async () => getNsmOverview(),
    arrival: async () => getBlockArrival(),
  };
}
