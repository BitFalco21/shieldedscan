import { useCallback, useSyncExternalStore } from "react";

/** Fired after this hook rewrites the URL: `replaceState` raises no event of its own. */
const CHANGE = "shieldedscan:querychange";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("popstate", onChange);
  window.addEventListener(CHANGE, onChange);
  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener(CHANGE, onChange);
  };
}

/**
 * One query parameter as client state: read from the URL, written back with `replaceState`.
 *
 * For prerendered pages, where reading `searchParams` on the server would make the route dynamic.
 * The server renders the default (null) and the client reads the real value once hydrated, through
 * `useSyncExternalStore`, so there is no hydration mismatch and no effect setting state. Replacing
 * rather than pushing keeps a range toggle out of the Back button's history.
 */
export function useQueryParam(name: string): [string | null, (value: string | null) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => new URLSearchParams(window.location.search).get(name),
    () => null,
  );
  const set = useCallback(
    (next: string | null) => {
      const url = new URL(window.location.href);
      if (next === null) url.searchParams.delete(name);
      else url.searchParams.set(name, next);
      window.history.replaceState(window.history.state, "", url);
      window.dispatchEvent(new Event(CHANGE));
    },
    [name],
  );
  return [value, set];
}
