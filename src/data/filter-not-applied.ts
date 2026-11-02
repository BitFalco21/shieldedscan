/**
 * The API answered a narrowed question without proving it narrowed: its echo of the applied
 * filter is missing (a deployment older than the filter) or names something else.
 *
 * Thrown rather than returned, so a caller that does not expect it shows an error page instead of
 * the unfiltered rows. A caller that does expect it can say the filter is unavailable.
 */
export class FilterNotAppliedError extends Error {
  /** The query parameter that was not applied, e.g. "pool". */
  readonly filter: string;
  constructor(filter: string, message: string) {
    super(message);
    this.name = "FilterNotAppliedError";
    this.filter = filter;
  }
}
