import { CopyButton } from "@/components/CopyButton";
import { Panel } from "@/components/Panel";
import { DONATION_ADDRESS } from "@/lib/donation";
import { PageHeader } from "@/components/PageHeader";

/**
 * The donate page: one address, one QR, and a plain statement of why.
 *
 * The QR is a static, committed SVG (`public/donate-qr.svg`) generated from the same
 * constant this page renders and round-trip verified by `scripts/generate-donate-qr.mjs` —
 * never a QR service, which the CSP forbids and which would ship the donation address to a
 * third party on every page view. It sits on a white tile because a scanner needs dark
 * modules on a light field; the site's near-black background would render it unscannable,
 * and the tile is the one deliberate patch of light in the design.
 *
 * The address renders in full with a copy button — the same standard as every address on
 * the site: what is copied is the untruncated value, and what is shown is checkable
 * character by character against what a wallet pastes.
 */
export function DonatePage() {
  return (
    <>
      <PageHeader
        eyebrow="SUPPORT"
        title="Donate"
        lede="I really appreciate donations — they directly support this work. I'm bootstrapping this explorer alone, and it carries real development and infrastructure costs: the archive node, the server it runs on, and the time to build the rest."
      />

      <Panel title="ZCASH — UNIFIED ADDRESS">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
          {/*
            Explicit dimensions so the tile reserves its box before the image arrives —
            the CLS budget treats a late-loading square as a layout shift like any other.
          */}
          <div className="shrink-0 self-center rounded-md bg-white p-2 sm:self-start">
            {/* eslint-disable-next-line @next/next/no-img-element -- a 5 KB static SVG:
                next/image would not optimise it (SVG passes through, and enabling
                dangerouslyAllowSVG for one asset is backwards), while the plain tag with
                explicit dimensions already reserves its box. First <img> in src/. */}
            <img
              src="/donate-qr.svg"
              width={200}
              height={200}
              alt={`QR code for a Zcash donation to ${DONATION_ADDRESS.slice(0, 12)}… — scan with any Zcash wallet`}
            />
          </div>
          <div className="min-w-0">
            <div className="microlabel">ADDRESS</div>
            <p className="mt-2 font-mono text-sm break-all text-ink">
              {DONATION_ADDRESS}
              <CopyButton value={DONATION_ADDRESS} label="donation address" />
            </p>
            <p className="mt-4 max-w-2xl text-xs leading-relaxed text-ink-dim">
              A unified address: your wallet pays into whichever receiver it supports, and a
              shielded donation stays shielded — this site cannot see it either, which is rather the
              point.
            </p>
          </div>
        </div>
      </Panel>
    </>
  );
}
