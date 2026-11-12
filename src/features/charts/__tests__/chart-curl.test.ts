import { describe, expect, it } from "vitest";
import { API_GROUPS } from "@/api-catalogue";
import { CHARTS } from "../catalog";
import { chartCurl } from "../chart-curl";

const ENDPOINTS = new Map(API_GROUPS.flatMap((g) => g.endpoints).map((e) => [e.id, e]));
const WITH_API = CHARTS.filter((c) => c.api);

describe("chartCurl", () => {
  it("gives every chart with an endpoint a command for that same endpoint", () => {
    for (const chart of WITH_API) {
      const endpoint = ENDPOINTS.get(chart.api!.docsId);
      expect(endpoint, `${chart.slug}: docsId names no endpoint`).toBeDefined();
      expect(endpoint!.path, chart.slug).toBe(chart.api!.path);
      expect(chartCurl(chart), chart.slug).toContain(chart.api!.path);
    }
  });

  // A bare path is a 400 on the windowed endpoints; the copied command must run as pasted.
  it("carries every required query parameter", () => {
    for (const chart of WITH_API) {
      const curl = chartCurl(chart)!;
      const required = ENDPOINTS.get(chart.api!.docsId)!.params.filter(
        (p) => p.kind === "query" && p.required,
      );
      for (const p of required) {
        expect(p.example, `${chart.slug}: ${p.name} has no pinned example`).toBeDefined();
        expect(curl, `${chart.slug} misses ${p.name}`).toContain(`${p.name}=`);
      }
    }
  });

  it("is null for a chart with no public endpoint", () => {
    const without = CHARTS.find((c) => !c.api);
    if (without) expect(chartCurl(without)).toBeNull();
  });
});
