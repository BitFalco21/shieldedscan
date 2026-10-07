import type { Fact } from "@/components/FactGrid";
import { PANEL_PADDING } from "@/components/Panel";
import { PrivacyShield } from "@/components/PrivacyShield";

export interface VeilPanelProps {
  title: string;
  facts: Fact[];
}

/**
 * The Veil, panel form: states what is hidden and why, shows what IS public,
 * and renders the hidden part as a redaction strip rather than pretending
 * there is nothing there.
 */
export function VeilPanel({ title, facts }: VeilPanelProps) {
  return (
    // The Panel's regular padding and title block (heading over a hairline), so a veil beside a
    // panel starts its title and text at the same inset.
    <section className={`veil ${PANEL_PADDING.regular}`}>
      <header className="hairline-b mb-3 pb-2.5">
        <h2 className="microlabel flex items-center gap-2 text-green">
          <PrivacyShield variant="shielded" />
          {title}
        </h2>
      </header>
      <p className="text-xs leading-relaxed text-ink-dim">
        Recipient and exact amounts are <strong className="text-ink">hidden by design</strong>
        {" — "}encrypted on-chain, visible only to holders of the viewing key. That&apos;s the point
        of Zcash.
      </p>
      <div aria-hidden className="redact mt-3 inline-block text-sm tracking-[2px]">
        ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓
      </div>
      {/*
        Wraps, because three facts do not fit one phone line. The value is the atom that must
        not break — "−0.0002 ZEC" split across two lines reads as two facts — while the label is
        prose and may wrap freely. A nowrap around the whole row would just move the overflow.
      */}
      <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-xs">
        {facts.map((f) => (
          <div key={f.label} className="flex gap-1.5">
            <dt className="text-ink-faint uppercase">{f.label}</dt>
            <dd className="font-semibold whitespace-nowrap text-ink-bright">{f.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
