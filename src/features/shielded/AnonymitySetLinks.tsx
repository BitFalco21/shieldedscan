import Link from "@/components/Link";
import { Panel } from "@/components/Panel";
import { isTestnet } from "@/lib/network";

const LINKS = [
  { href: "/charts/anonymity-set", label: "anonymity set per pool" },
  { href: "/charts/notes-added", label: "notes added per pool" },
] as const;

export type AnonymitySetLinksProps = Record<string, never>;

/**
 * The anonymity-set charts, linked rather than drawn: ten years of daily tree sizes would weigh
 * more than the rest of this page together. Absent on testnet, where those charts are not served.
 */
export function AnonymitySetLinks(_props: AnonymitySetLinksProps) {
  if (isTestnet) return null;
  return (
    <Panel title="ANONYMITY SET" className="mt-3">
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
