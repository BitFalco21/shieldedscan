import Link from "@/components/Link";
import { HeartIcon } from "@/components/HeartIcon";

/**
 * The nav's donate key: an outline that fills on hover, the same grammar as the hero's search
 * key. The label shows only from `xl`; below that the heart alone carries it, because the bar
 * has no room for the word. Below `sm` the menu carries the entry instead. Mainnet only, like
 * the page: the caller decides.
 */
export function NavDonate() {
  return (
    <Link
      href="/donate"
      aria-label="Donate"
      title="Donate"
      className="hidden h-[30px] items-center gap-2 rounded-xs border border-green px-2 text-xs text-green transition-colors hover:bg-green hover:text-bg sm:flex xl:pr-3 xl:pl-2.5"
    >
      <HeartIcon />
      <span aria-hidden className="hidden xl:inline">
        donate
      </span>
    </Link>
  );
}
