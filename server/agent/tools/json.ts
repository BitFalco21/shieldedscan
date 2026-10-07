/**
 * Total helpers for untrusted input: nothing here throws on a malformed upstream body or on a
 * model's argument.
 */

/** `value` as a plain JSON object, or null for anything else — an array, a scalar or null. */
export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Whether `value` is one of a closed set, narrowing it to that set's type. */
export function isOneOf<T extends string>(values: readonly T[], value: string): value is T {
  return (values as readonly string[]).includes(value);
}

/** A closed set as prose for an error message: "a, b or c", or `"a", "b" or "c"` when quoted. */
export function orList(values: readonly string[], quoted = false): string {
  const items = quoted ? values.map((v) => `"${v}"`) : [...values];
  return items.length < 2
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} or ${items.at(-1)}`;
}

/** What `parseJson` returns for a body that is not JSON, distinct from every JSON value. */
export const NOT_JSON: unique symbol = Symbol("not JSON");

/** A response body parsed, or `NOT_JSON`; never throws, since an upstream can send anything. */
export function parseJson(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return NOT_JSON;
  }
}

/**
 * A JSON body reshaped for the model, or the body unchanged when it does not parse. Tool results
 * are read by a model, so two-space indentation is tokens well spent.
 */
export function reshapeJson(body: string, shape: (parsed: unknown) => unknown): string {
  const parsed = parseJson(body);
  return parsed === NOT_JSON ? body : JSON.stringify(shape(parsed), null, 2);
}
