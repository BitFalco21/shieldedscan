/**
 * Whether a request path contains a `.` or `..` segment, plain or percent-encoded.
 *
 * Paths built from a caller's identifier (`/addresses/${encodeURIComponent(id)}/…`) keep a
 * literal `..`, because `encodeURIComponent` does not encode dots, and the router then
 * normalises it away and serves a different route. Every in-process and server-to-API request
 * refuses such a path, so no identifier can climb out of the route it was put in.
 */
export function hasDotSegment(path: string): boolean {
  const pathname = path.split(/[?#]/, 1)[0] ?? "";
  return pathname.split("/").some((segment) => /^(?:\.|%2e){1,2}$/i.test(segment));
}
