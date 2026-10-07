import NextLink from "next/link";
import type { ComponentProps } from "react";

export type LinkProps = ComponentProps<typeof NextLink>;

/**
 * `next/link` with prefetching off by default. The only `Link` this codebase may use.
 *
 * Next prefetches every `<Link>` that scrolls into view, and almost every link here points at
 * a dynamic route — a block, a transaction, an address — so each prefetch is a full server
 * render. One visit to a list page would otherwise fire a render per visible row before the
 * reader clicks anything, and multiply any browser-driven crawler.
 *
 * `prefetch={false}` still prefetches on hover, so a reader about to click loses nothing
 * perceptible. The default is site-wide rather than a per-link judgement; a caller that wants
 * eager prefetch says so explicitly. `eslint` forbids importing `next/link` anywhere else, and
 * `src/components/__tests__/Link.test.ts` counts the imports.
 */
export default function Link({ prefetch = false, ...rest }: LinkProps) {
  return <NextLink prefetch={prefetch} {...rest} />;
}
