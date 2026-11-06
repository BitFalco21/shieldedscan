import type { TurnTiming } from "../timing";

/**
 * What an eval run records about speed, and the summary it prints. Pure, so the arithmetic is tested
 * without a model.
 */

/** One case's turn, as the dump stores it: whole milliseconds, tokens as the provider reported them. */
export interface CaseLatency {
  wallMs: number;
  modelCalls: number;
  toolRounds: number;
  tools: { name: string; ms: number; call: number }[];
  calls: {
    ttfeMs: number | null;
    firstDataMs: number | null;
    ms: number;
    in: number | null;
    cached: number | null;
    out: number | null;
    tools: number;
  }[];
}

const whole = (ms: number | null): number | null => (ms === null ? null : Math.round(ms));

export function caseLatency(t: TurnTiming): CaseLatency {
  return {
    wallMs: Math.round(t.totalMs),
    modelCalls: t.modelCalls,
    toolRounds: t.toolRounds,
    tools: t.tools.map((x) => ({ name: x.name, ms: Math.round(x.ms), call: x.call })),
    calls: t.calls.map((c) => ({
      ttfeMs: whole(c.ttfeMs),
      firstDataMs: whole(c.firstDataMs),
      ms: Math.round(c.ms),
      in: c.promptTokens,
      cached: c.cachedTokens,
      out: c.completionTokens,
      tools: c.toolCalls,
    })),
  };
}

/** Nearest-rank percentile of a non-empty list; `p` in (0, 100]. */
export function percentile(values: readonly number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1]!;
}

const mean = (values: readonly number[]): number =>
  values.reduce((s, v) => s + v, 0) / values.length;

const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;

/**
 * The prompt tokens served from cache, as a share of the prompt tokens of the calls that reported
 * both — or null when none did, which is "not reported", never 0%.
 */
function cachedShare(calls: CaseLatency["calls"]): string {
  const reported = calls.filter((c) => c.in !== null && c.cached !== null && c.in > 0);
  if (reported.length === 0) return "not reported";
  const cached = reported.reduce((s, c) => s + c.cached!, 0);
  const total = reported.reduce((s, c) => s + c.in!, 0);
  return `${((cached / total) * 100).toFixed(1)}% of ${reported.length} calls`;
}

/**
 * The latency table: per category, wall time p50/p90, mean model calls and tool rounds, and the
 * slowest single first-data wait; then how much of the prompt came from cache on a turn's first
 * call against its later ones, which is what says whether the provider keeps the fixed prefix.
 */
export function latencySummary(
  rows: readonly { category: string; latency: CaseLatency | null }[],
): string[] {
  const measured = rows.filter(
    (r): r is { category: string; latency: CaseLatency } => r.latency !== null,
  );
  if (measured.length === 0) return ["no turn was timed"];
  const byCategory = new Map<string, CaseLatency[]>();
  for (const r of measured)
    byCategory.set(r.category, [...(byCategory.get(r.category) ?? []), r.latency]);
  const lines = [
    `${"category".padEnd(20)} ${"runs".padStart(4)} ${"p50".padStart(7)} ${"p90".padStart(7)} ${"calls".padStart(6)} ${"rounds".padStart(6)} ${"1st data p50".padStart(13)}`,
  ];
  for (const [category, list] of [...byCategory].sort(([a], [b]) => a.localeCompare(b))) {
    const walls = list.map((l) => l.wallMs);
    const firstData = list
      .flatMap((l) => l.calls.map((c) => c.firstDataMs))
      .filter((v): v is number => v !== null);
    lines.push(
      `${category.padEnd(20)} ${String(list.length).padStart(4)} ${seconds(percentile(walls, 50)).padStart(7)} ${seconds(percentile(walls, 90)).padStart(7)} ${mean(
        list.map((l) => l.modelCalls),
      )
        .toFixed(1)
        .padStart(6)} ${mean(list.map((l) => l.toolRounds))
        .toFixed(1)
        .padStart(
          6,
        )} ${(firstData.length === 0 ? "—" : seconds(percentile(firstData, 50))).padStart(13)}`,
    );
  }
  const all = measured.map((r) => r.latency);
  const firstCalls = all.flatMap((l) => l.calls.slice(0, 1));
  const laterCalls = all.flatMap((l) => l.calls.slice(1));
  const prompts = all
    .flatMap((l) => l.calls.map((c) => c.in))
    .filter((v): v is number => v !== null);
  lines.push(
    `prompt tokens per call: ${prompts.length === 0 ? "not reported" : `p50 ${percentile(prompts, 50).toLocaleString("en-US")}`}`,
    `cached prompt, first call of a turn: ${cachedShare(firstCalls)}`,
    `cached prompt, later calls:          ${cachedShare(laterCalls)}`,
  );
  return lines;
}
