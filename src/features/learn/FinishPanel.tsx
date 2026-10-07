import { AmountZec } from "@/components/AmountZec";
import { CopyButton } from "@/components/CopyButton";
import { PrivacyShield } from "@/components/PrivacyShield";
import { LearnRow } from "./LearnRow";
import { BOX, BTN_PRIMARY, CHIP } from "./learn-ui";

export interface FinishPanelProps {
  /** The page's own address, for the post the reader can share. */
  pageUrl: string;
}

const SHARE_TEXT =
  "I just made my first shielded Zcash transaction. Amount, recipient and memo: all encrypted.";

/**
 * The end of the guide. The comparison states what each kind of payment publishes in words
 * rather than with a made-up transparent payment: an invented amount on a page whose every other
 * figure is real would be a fabricated record.
 *
 * The share links the page, never the reader's transaction: posting your own txid from your own
 * account ties you to it in public, which is the opposite of what this page teaches.
 */
export function FinishPanel({ pageUrl }: FinishPanelProps) {
  const intent = `https://x.com/intent/post?text=${encodeURIComponent(SHARE_TEXT)}&url=${encodeURIComponent(pageUrl)}`;
  return (
    <div className="grid gap-6">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className={BOX}>
          <p className="mb-1 flex items-center gap-2">
            <PrivacyShield variant="transparent" />
            <span className={`${CHIP} border-edge text-ink-bright`}>a transparent payment</span>
          </p>
          <LearnRow label="from" value="an address anyone can read" wrap />
          <LearnRow label="to" value="an address anyone can read" wrap />
          <LearnRow label="amount" value="exact, for anyone" wrap />
        </div>
        <div className={BOX}>
          <p className="mb-1 flex items-center gap-2">
            <PrivacyShield variant="shielded" />
            <span className={`${CHIP} border-edge text-ink-bright`}>your shielded send</span>
          </p>
          <LearnRow label="from" value={<AmountZec zat={null} />} />
          <LearnRow label="to" value={<AmountZec zat={null} />} />
          <LearnRow label="amount" value={<AmountZec zat={null} />} />
        </div>
      </div>
      <p className="max-w-[64ch] text-sm text-ink-dim">
        Anyone can read a transparent payment, forever. Only you and the recipient can read your
        shielded send.
      </p>

      <div className="grid justify-items-start gap-2">
        <p className="microlabel">share it</p>
        <div className="flex flex-wrap items-center gap-3">
          <a href={intent} target="_blank" rel="noopener noreferrer" className={BTN_PRIMARY}>
            post on X ↗
          </a>
          <CopyButton value={`${SHARE_TEXT} ${pageUrl}`} label="the post text" withLabel />
        </div>
      </div>

      <p className="max-w-[72ch] rounded border border-warn-edge px-3 py-2 text-sm text-ink">
        <b className="font-semibold text-warn">Keep it private.</b> Never paste a recovery phrase or
        a viewing key into any website. A viewing key shows your entire history to whoever holds it.
      </p>
    </div>
  );
}
