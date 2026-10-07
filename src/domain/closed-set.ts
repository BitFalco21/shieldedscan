/**
 * Whether `value` is a member of a closed list, narrowing it to the list's union. The list is
 * the `as const` array its type derives from, so the runtime check and the type cannot drift.
 */
export function isOneOf<T extends string>(
  values: readonly T[],
  value: string | null | undefined,
): value is T {
  return value != null && (values as readonly string[]).includes(value);
}
