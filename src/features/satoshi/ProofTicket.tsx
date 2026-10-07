import { CopyButton } from "@/components/CopyButton";
import { GENESIS_TARGET, type DrawAttempt } from "@/domain/bitcoin-keys";
import { GENESIS_COINBASE_BTC, GENESIS_TRIBUTES } from "./target";

export interface ProofTicketProps {
  attempt: DrawAttempt;
  hits: readonly boolean[];
  pull: number;
  /** ISO instant the key was drawn, captured on the client at pull time. */
  drawnAt: string;
  /** Whether the ticket has finished printing (drives the slide-out class only). */
  out: boolean;
}

const LOSS_VERDICT = "no match";
const JACKPOT_VERDICT = "jackpot";

/**
 * The proof of play. Every field a reader needs to check the attempt with a tool of their
 * own: the key in hex and WIF, the public key, the address it hashes to, and the target it
 * was compared with. A win renders through this same component with the same rows — there
 * is no separate payout view, which is the whole argument that the attempt was real.
 *
 * The verdict for a jackpot says what the key actually spends: the tributes, never the 50 BTC
 * coinbase, which no key can move.
 */
export function ProofTicket({ attempt, hits, pull, drawnAt, out }: ProofTicketProps) {
  const agree = hits.filter(Boolean).length;
  const target = GENESIS_TARGET.address;
  return (
    <div className={out ? "slot-ticket is-out" : "slot-ticket"} data-ticket>
      <div className="slot-ticket-head">
        <span>./shieldedscan · proof of play</span>
        <span className="tabular-nums">pull #{String(pull).padStart(6, "0")}</span>
      </div>
      <dl className="slot-ticket-rows">
        <dt>drawn at</dt>
        <dd className="tabular-nums">{formatUtc(drawnAt)}</dd>
        <dt>private key · hex</dt>
        <dd data-ticket-hex>{attempt.privateKeyHex}</dd>
        <dt>private key · WIF</dt>
        <dd data-ticket-wif>
          {attempt.wif}
          <CopyButton value={attempt.wif} label="private key" />
        </dd>
        <dt>public key</dt>
        <dd>{attempt.publicKeyHex}</dd>
        <dt>your address</dt>
        <dd data-ticket-address>
          {Array.from(target, (_, i) => {
            const ch = attempt.address[i];
            if (ch === undefined) return null;
            return hits[i] ? (
              <mark key={i} className="slot-hit-char">
                {ch}
              </mark>
            ) : (
              <span key={i}>{ch}</span>
            );
          })}
        </dd>
        <dt>target</dt>
        <dd>{target}</dd>
      </dl>
      <div className="slot-ticket-result" role="status">
        {attempt.jackpot ? (
          <>
            <b className="text-green">{JACKPOT_VERDICT.toUpperCase()}</b> · 34 of 34 · this key
            spends the {GENESIS_TRIBUTES.btc} BTC sent to this address; the {GENESIS_COINBASE_BTC}{" "}
            BTC coinbase stays unspendable by consensus. Import the WIF into a wallet you control.
          </>
        ) : (
          <>
            <b>{LOSS_VERDICT.toUpperCase()}</b> · {agree} of 34 aligned
          </>
        )}
      </div>
      <p className="slot-ticket-note">
        Check it yourself: paste the WIF into any offline wallet tool. It derives to the address
        above, which any Bitcoin explorer shows empty. Had it matched the target, this same line
        would hold the key — there is no separate winning path to trust.
      </p>
    </div>
  );
}

function formatUtc(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC`;
}
