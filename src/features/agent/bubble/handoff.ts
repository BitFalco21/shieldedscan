import type { Exchange } from "../exchange";

/**
 * The bubble's conversation on its way into `/ai-agent`, when the reader presses ↗.
 *
 * A module-scoped slot rather than storage: a client-side navigation keeps this module alive, so
 * the turns cross with no copy written anywhere, and a reload loses them exactly as the console
 * promises ("nothing you type is saved"). The console peeks in its first render and clears after
 * mounting, so React's double render in development reads the same turns twice.
 */
let carried: readonly Exchange[] | null = null;

export function handOff(exchanges: readonly Exchange[]): void {
  carried = exchanges.length > 0 ? exchanges : null;
}

export function peekHandoff(): readonly Exchange[] | null {
  return carried;
}

export function clearHandoff(): void {
  carried = null;
}
