import { PrivacyShield } from "@/components/PrivacyShield";
import { LearnAddress } from "./LearnAddress";
import { LearnRow } from "./LearnRow";
import { BOX, CHIP, CHIP_WRAP } from "./learn-ui";
import { CheckMessage } from "./CheckMessage";
import { RECOVERY_PHRASE_WARNING } from "./learn-checks";
import type { AddressCheck } from "./learn-checks";

export interface AddressCheckResultProps {
  check: AddressCheck;
  /** True when this is the page's example address rather than the reader's own. */
  example: boolean;
}

/**
 * What a pasted address turned out to be, decided in the browser. A unified address lists the
 * receivers inside it, which is public by construction (it IS the address); which receiver a
 * payment used is a different question, and private.
 */
export function AddressCheckResult({ check, example }: AddressCheckResultProps) {
  switch (check.kind) {
    case "empty":
      return (
        <CheckMessage tone="err" title="✗ nothing to check">
          Paste your shielded address first, or show an example.
        </CheckMessage>
      );
    case "phrase":
      return (
        <CheckMessage tone="warn" title={RECOVERY_PHRASE_WARNING.title}>
          {RECOVERY_PHRASE_WARNING.text}
        </CheckMessage>
      );
    case "invalid":
      return (
        <CheckMessage tone="err" title="✗ not a Zcash address">
          Shielded addresses start with u1 (older ones with zs1), transparent ones with t1. Check
          you copied all of it.
        </CheckMessage>
      );
    case "typo":
      return (
        <CheckMessage tone="err" title="✗ this address has a typo">
          {check.addressKind === "unified"
            ? "Its last characters don’t match the rest, so a character is missing or changed. Copy it again from your wallet."
            : "Its checksum doesn’t match, so a character is missing or changed. Copy it again from your wallet."}
        </CheckMessage>
      );
    case "testnet":
      return (
        <CheckMessage tone="info" title="a testnet address">
          Testnet coins are for developers and have no value. This page is about real ZEC.
        </CheckMessage>
      );
    case "transparent":
      return (
        <div className="grid gap-3">
          <p className="text-sm font-semibold text-ink-dim">transparent address</p>
          <div className="flex items-center gap-2.5">
            <PrivacyShield variant="transparent" />
            <span className={`${CHIP} border-edge text-ink-bright`}>transparent</span>
          </div>
          <p className="max-w-[64ch] text-sm text-ink">
            <b className="font-semibold text-ink-bright">Everything sent here is public.</b> That’s
            fine for receiving from an exchange: you’ll shield it in step 3. For everything else,
            use your wallet’s shielded address (u1…).
          </p>
        </div>
      );
    case "sapling":
      return (
        <div className="grid gap-3">
          <p className="text-sm font-semibold text-green">✓ shielded address</p>
          <div className="flex items-center gap-2.5">
            <PrivacyShield variant="shielded" />
            <span className={`${CHIP} border-edge text-ink-bright`}>sapling</span>
          </div>
          <p className="max-w-[64ch] text-sm text-ink">
            <b className="font-semibold text-ink-bright">This address receives privately.</b>{" "}
            Sapling is an older format; newer wallets give a u1… address.
          </p>
        </div>
      );
    case "unified": {
      const sapling = check.receivers.find((r) => r.kind === "sapling");
      const transparent = check.receivers.find((r) => r.kind === "p2pkh" || r.kind === "p2sh");
      const orchard = check.receivers.some((r) => r.kind === "orchard");
      return (
        <div className="grid gap-3">
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-semibold text-green">
            ✓ unified address
            {example ? (
              <span
                className={`${CHIP_WRAP} border-dashed border-edge-faint font-normal text-ink-faint`}
              >
                example · this site’s donation address
              </span>
            ) : null}
          </p>
          <div className={BOX}>
            <p className="microlabel mb-1">receivers inside this address</p>
            <LearnRow
              wrap
              label="orchard"
              value={orchard ? "✓ included · has no separate address" : "none in this one"}
            />
            <LearnRow
              wrap
              label="sapling"
              value={
                sapling && "address" in sapling ? (
                  <LearnAddress address={sapling.address} variant="short" />
                ) : (
                  "none in this one"
                )
              }
            />
            <LearnRow
              wrap
              label="transparent"
              value={
                transparent && "address" in transparent ? (
                  <LearnAddress address={transparent.address} variant="short" />
                ) : (
                  "none in this one"
                )
              }
            />
          </div>
          <p className="max-w-[64ch] text-sm text-ink">
            <b className="font-semibold text-ink-bright">This address receives privately.</b> Any
            wallet or exchange that understands u1… addresses can pay it, and the ZEC lands
            shielded. If an exchange says “invalid address”, give it your wallet’s transparent
            address (t1…) instead.
          </p>
        </div>
      );
    }
  }
}
