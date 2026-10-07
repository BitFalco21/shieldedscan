/**
 * The hero prompt.
 *
 *  - Focus lands on the prompt panel, not the input: the input's own ring is suppressed and
 *    `.prompt-focus` (`:focus-within`) brightens the panel's border and glow, so the terminal
 *    lights up as one object rather than nesting a second outline inside it. The indicator
 *    moved; it was not removed (WCAG 2.4.7).
 *  - A blinking block cursor instead of a `⌘K` badge. It still opens the palette: the block is
 *    a button carrying `data-command-palette-trigger`, which `CommandPalette` listens for.
 *
 * The input lives in `HeroSearchBox`, a client island. The `<form action="/search">` around it
 * stays here because it is the whole behaviour without JavaScript; the island only adds
 * suggestion rows under the field.
 */
import { HeroSearchBox } from "./HeroSearchBox";

export function HeroSearch() {
  return (
    <form action="/search" role="search" className="mx-auto mt-6 max-w-xl">
      <HeroSearchBox />
    </form>
  );
}
