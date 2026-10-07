import Link from "@/components/Link";
import { AmountZec } from "@/components/AmountZec";
import { PrivacyShield } from "@/components/PrivacyShield";
import type { PrivacyVariant } from "@/components/PrivacyShield";
import { Unmeasured } from "@/components/Unmeasured";
import { learnIntoPoolsZat, learnOutOfPoolsZat } from "@/domain";
import type { LearnEntry, LearnShape, LearnTx, PoolName } from "@/domain";
import { formatCount, formatUtc, formatZatUsd, formatZec, shortHash } from "@/lib/format";
import { AskZeno } from "./AskZeno";
import { LearnAddress } from "./LearnAddress";
import { LearnRow } from "./LearnRow";
import { BOX, CHIP, CHIP_WRAP } from "./learn-ui";

export interface TxCheckResultProps {
  tx: LearnTx;
  /** A real recent transaction the page fetched as an example, not the reader's own. */
  example: boolean;
  /** The reader's own transparent addresses, from step 1, so their rows can say "you". */
  yours: ReadonlySet<string>;
  priceUsd: number | null;
}

const VARIANT: Readonly<Record<LearnShape, PrivacyVariant>> = {
  transparent: "transparent",
  coinbase: "transparent",
  shielding: "mixed",
  unshielding: "mixed",
  mixed: "mixed",
  shielded: "shielded",
};

/** One sentence per shape: what everyone can see, said once. */
const MEANING: Readonly<Record<LearnShape, { lead: string; rest: string }>> = {
  transparent: { lead: "Anyone can see both addresses and every amount, forever.", rest: "" },
  shielding: {
    lead: "The amount is public on the way in,",
    rest: "because it came from a public address. Who received it is hidden.",
  },
  shielded: {
    lead: "The sender, the recipient, the amount and the memo are encrypted.",
    rest: "The fee and the time are public.",
  },
  unshielding: {
    lead: "The amount and the receiving address are public.",
    rest: "Where the ZEC came from inside the shielded pool stays hidden.",
  },
  coinbase: {
    lead: "A block reward:",
    rest: "newly created ZEC paid to a miner, not a payment from anyone.",
  },
  mixed: {
    lead: "This one moved value into one shielded pool and out of another,",
    rest: "so it has no single direction.",
  },
};

/** A shape in words, for a question that names the kind of transaction and nothing about it. */
const SHAPE_PHRASE: Readonly<Record<LearnShape, string>> = {
  transparent: "a transparent transaction",
  shielding: "a shielding transaction",
  shielded: "a fully shielded transaction",
  unshielding: "an unshielding transaction",
  coinbase: "a block reward (coinbase) transaction",
  mixed: "a transaction that moves ZEC between shielded pools",
};

/**
 * What Zeno is asked about a checked transaction. An example is one the page fetched from the
 * chain, so its ID may go along and Zeno looks it up and explains it with its real figures. The
 * reader's own transaction never goes to the model — its ID, amounts or time would tie them to it
 * in a third party's logs — so for that one Zeno is asked only about its kind.
 */
export function explainTxQuestion(tx: LearnTx, example: boolean): string {
  return example
    ? `Explain this example transaction in plain words: ${tx.txid}`
    : `What can anyone see in ${SHAPE_PHRASE[tx.shape]}?`;
}

const poolName = (pool: PoolName) => `${pool.charAt(0).toUpperCase()}${pool.slice(1)} pool`;
const POOL_TITLE =
  "Ironwood is Zcash’s newest shielded pool; Orchard, Sapling and Sprout came before it.";

function Entries({
  entries,
  total,
  yours,
}: {
  entries: readonly LearnEntry[];
  total: number;
  yours: ReadonlySet<string>;
}) {
  return (
    <>
      {entries.map((e, i) => (
        <LearnRow
          key={`${e.address}-${i}`}
          label={
            <LearnAddress
              address={e.address}
              owner={yours.has(e.address) ? "you" : undefined}
              variant="short"
            />
          }
          value={formatZec(e.valueZat)}
        />
      ))}
      {total > entries.length ? <LearnRow label={`and ${total - entries.length} more`} /> : null}
    </>
  );
}

/**
 * A pasted transaction as the learning page shows it: the side everyone can read and the side
 * the chain keeps silent, in the explorer's own grammar — the shield, the veil, and amounts to
 * the zatoshi. It states only what the transaction publishes; which output was a payment and
 * which was change is not knowable, so it is never said.
 */
export function TxCheckResult({ tx, example, yours, priceUsd }: TxCheckResultProps) {
  const into = learnIntoPoolsZat(tx);
  const out = learnOutOfPoolsZat(tx);
  const intoPools = tx.poolMoves.filter((m) => m.valueBalanceZat > 0);
  const outOfPools = tx.poolMoves.filter((m) => m.valueBalanceZat < 0);
  const meaning = MEANING[tx.shape];

  return (
    <div className="grid gap-3">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="font-semibold text-green">
          {tx.blockHeight === null
            ? "✓ seen, waiting for its first block"
            : `✓ found in block ${formatCount(tx.blockHeight)}`}
        </span>
        <span title={tx.txid} className="text-ink-faint tabular-nums">
          {shortHash(tx.txid, 8)}
        </span>
        {example ? (
          <span className={`${CHIP_WRAP} border-dashed border-edge-faint text-ink-faint`}>
            example · a real recent transaction
          </span>
        ) : null}
      </p>

      <div className="flex flex-wrap items-center gap-2.5">
        <PrivacyShield variant={VARIANT[tx.shape]} />
        <span className={`${CHIP} border-edge text-ink-bright`}>{tx.shape}</span>
      </div>

      {tx.shape === "shielded" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className={BOX}>
            <p className="microlabel mb-1">
              {example ? "the sender and the recipient know" : "you and the recipient know"}
            </p>
            <ul className="grid gap-1.5 py-1 text-sm text-ink-bright">
              {["the amount", "who sent it", "who received it", "the memo"].map((item) => (
                <li key={item}>
                  <span aria-hidden className="text-green">
                    ✓{" "}
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div className={BOX}>
            <p className="microlabel mb-1">everyone else sees</p>
            {["from", "to", "amount", "memo"].map((field) => (
              <LearnRow key={field} label={field} value={<AmountZec zat={null} />} />
            ))}
          </div>
        </div>
      ) : (
        <div className="grid items-center gap-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
          <div className={`${BOX} min-w-0 self-stretch`}>
            <p className="microlabel mb-1">from</p>
            {tx.shape === "coinbase" ? <LearnRow label="newly mined ZEC" /> : null}
            <Entries entries={tx.inputs} total={tx.inputCount} yours={yours} />
            {outOfPools.map((m) => (
              <LearnRow
                key={m.pool}
                label={<span title={POOL_TITLE}>{poolName(m.pool)}</span>}
                value={formatZec(-m.valueBalanceZat)}
              />
            ))}
            {out !== null ? <LearnRow label="sender" value={<AmountZec zat={null} />} /> : null}
          </div>
          <span aria-hidden className="justify-self-center text-green-dim max-sm:rotate-90">
            →
          </span>
          <div className={`${BOX} min-w-0 self-stretch`}>
            <p className="microlabel mb-1">to</p>
            <Entries entries={tx.outputs} total={tx.outputCount} yours={yours} />
            {intoPools.map((m) => (
              <LearnRow
                key={m.pool}
                label={<span title={POOL_TITLE}>{poolName(m.pool)}</span>}
                value={formatZec(m.valueBalanceZat)}
              />
            ))}
            {into !== null ? <LearnRow label="recipient" value={<AmountZec zat={null} />} /> : null}
          </div>
        </div>
      )}

      <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
        <div>
          <dt className="microlabel">fee</dt>
          <dd className="mt-0.5 text-ink-bright tabular-nums">
            {tx.shape === "coinbase" ? (
              "none"
            ) : tx.feeZat === null ? (
              <Unmeasured />
            ) : (
              <>
                {formatZec(tx.feeZat)}
                {priceUsd !== null ? (
                  <span className="ml-1.5 text-xs text-ink-faint">
                    {formatZatUsd(tx.feeZat, priceUsd)}
                  </span>
                ) : null}
              </>
            )}
          </dd>
        </div>
        <div>
          <dt className="microlabel">block</dt>
          <dd className="mt-0.5 text-ink-bright tabular-nums">
            {tx.blockHeight === null ? "waiting" : formatCount(tx.blockHeight)}
          </dd>
        </div>
        <div>
          <dt className="microlabel">time</dt>
          <dd className="mt-0.5 text-ink-bright tabular-nums">{formatUtc(tx.timestamp)}</dd>
        </div>
      </dl>

      <p className="max-w-[64ch] text-sm text-ink">
        <b className="font-semibold text-ink-bright">{meaning.lead}</b>
        {meaning.rest ? ` ${meaning.rest}` : ""}
      </p>
      <div>
        <AskZeno
          question={explainTxQuestion(tx, example)}
          label={example ? "explain this transaction" : undefined}
        />
      </div>

      <Link
        href={`/tx/${tx.txid}`}
        target="_blank"
        rel="noopener noreferrer"
        className="justify-self-start text-sm text-green-dim hover:text-green"
      >
        open it on shieldedscan ↗
      </Link>
    </div>
  );
}
