/**
 * Appends the arrival transition to a row's own classes when the row just arrived: the one
 * treatment for a row that arrived while the reader was watching.
 *
 * Deliberately almost nothing: a row appearing at the top of a list already says it is new.
 * A persistent "new" chip or accent rule would restate that, and a chip takes width that can
 * wrap a hash onto a second line and resize the panel on every arrival.
 *
 * What is left is a brief fade as the row takes its place, so an arrival does not read as the
 * list teleporting. `prefers-reduced-motion` removes even that; no meaning is lost.
 *
 * Shared so every live list behaves the same way.
 */
export function liveRowClass(base: string, fresh: boolean): string {
  return fresh ? `${base} live-new` : base;
}
