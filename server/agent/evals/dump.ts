/**
 * A run's output as a reviewable artifact. A run whose value is that someone reads it must persist.
 *
 * Answers are stored whole: a truncated refusal may be missing the clause that makes it a refusal,
 * which makes it useless as a judge fixture.
 */

export interface DumpCase {
  id: string;
  category: string;
  passed: boolean;
  failures: string[];
  answer: string;
  /**
   * The model's own text, recorded only when the sanitiser changed something (otherwise it would
   * duplicate `answer`). A forbid can fail on this channel alone — an exfiltration payload the
   * sanitiser deleted — and a dump without it would show a clean answer beside a failure with no
   * visible cause.
   */
  rawAnswer?: string;
  toolsCalled: string[];
  tokens: number;
}

export interface DumpMeta {
  model: string;
  promptVersion: number;
  v1BaseUrl: string;
  ranAt: string;
}

export interface DumpFile extends DumpMeta {
  cases: DumpCase[];
}

export function buildDump(meta: DumpMeta, results: readonly DumpCase[]): DumpFile {
  return { ...meta, cases: results.map((r) => ({ ...r })) };
}
