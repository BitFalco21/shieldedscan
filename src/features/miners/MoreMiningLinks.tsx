import Link from "@/components/Link";
import { Panel } from "@/components/Panel";

const LINKS = [
  { href: "/charts/difficulty", label: "difficulty" },
  { href: "/charts/blocks-per-day", label: "blocks per day" },
  { href: "/charts/miner-concentration", label: "largest miners' share" },
  { href: "/mining-cost", label: "mining cost by country" },
  { href: "/halving", label: "halving" },
] as const;

export type MoreMiningLinksProps = Record<string, never>;

/** Mining charts the site already draws elsewhere: linked, never redrawn here. */
export function MoreMiningLinks(_props: MoreMiningLinksProps) {
  return (
    <Panel title="MORE MINING CHARTS" className="mt-3">
      <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        {LINKS.map((l) => (
          <li key={l.href}>
            <span aria-hidden className="text-ink-faint">
              &gt;{" "}
            </span>
            <Link href={l.href} className="text-green hover:underline">
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
