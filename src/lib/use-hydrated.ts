import { useSyncExternalStore } from "react";

const emptySubscribe = () => () => {};

/**
 * True only after hydration — false on the server and for a reader without JavaScript.
 *
 * The progressive-enhancement switch: render the complete, readable page first (every tab's
 * content stacked, every tool listed), and only once this is true collapse it into tabs or offer a
 * filter. Same mechanism as `DecryptDemo`, without an effect that sets state.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}
