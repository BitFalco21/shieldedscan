import Link from "@/components/Link";
import { Panel } from "@/components/Panel";
import type { SupplyPartMeta } from "./supply-part-meta";

export interface SupplyPartPanelProps {
  /** Referenced by the cards' `aria-controls`. */
  id: string;
  meta: SupplyPartMeta;
}

/**
 * The selected card's panel: what the part is, and the nearest list the site has for it. No
 * pool has a transaction list of its own yet, so the link is to the closest one, named for
 * exactly what it shows.
 */
export function SupplyPartPanel({ id, meta }: SupplyPartPanelProps) {
  return (
    <section id={id} aria-live="polite">
      <Panel title={meta.label} className="mt-3">
        <p className="text-sm leading-relaxed text-ink-dim">{meta.detail}</p>
        {meta.link === null ? null : (
          <p className="mt-3 text-sm">
            <Link href={meta.link.href}>{meta.link.label} →</Link>
          </p>
        )}
      </Panel>
    </section>
  );
}
