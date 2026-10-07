/**
 * Number checks for payloads read off the wire. `typeof x === "number"` admits `NaN` and
 * `Infinity`, which would render as "$NaN" or size a chart mark, so every check here requires a
 * finite value.
 */

/** A measured number. */
export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** A measured number or an explicit `null`. `undefined` fails: an absent key is not a null. */
export function isFiniteOrNull(value: unknown): value is number | null {
  return value === null || isFiniteNumber(value);
}

/** The value if it is a measured number, otherwise `null`. Never a substituted zero. */
export function finiteOrNull(value: unknown): number | null {
  return isFiniteNumber(value) ? value : null;
}

/**
 * A decimal string as a number, or `null`. A blank string is `null`, not the `0` that
 * `Number("")` returns: an empty field is a missing figure, not a measured zero.
 */
export function parseFiniteOrNull(raw: string | undefined | null): number | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  return finiteOrNull(Number(raw));
}
