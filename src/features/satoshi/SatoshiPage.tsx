import { AmountZec } from "@/components/AmountZec";
import { Panel } from "@/components/Panel";
import { GENESIS_TARGET } from "@/domain/bitcoin-keys";
import { SlotCabinet } from "./SlotCabinet";
import { GENESIS_COINBASE_BTC, GENESIS_TRIBUTES } from "./target";

/**
 * `/satoshi` — a slot machine where every pull is a real attempt at the genesis-block key.
 *
 * The honesty rules, each of which the copy below states in as many words:
 * - ONE target, the genesis coinbase address, because it is Satoshi's by the chain itself.
 *   "The 1.1M BTC" rests on a mining-pattern attribution and is not claimed.
 * - The jackpot is the tributes ({@link GENESIS_TRIBUTES}), not the 50 BTC coinbase, which
 *   no key can spend.
 * - The odds are stated as ≈ 2^-160 — any of ~2^96 keys hashing to the target would do.
 * - The Zcash half claims the same lock and no visible vault. It does NOT claim harder keys:
 *   a shielded pool uses a different curve at comparable size, and the per-guess odds are the
 *   same order of hopeless. Only the balance row wears the Veil, because that is precisely
 *   what the Veil means; the other two rows are sentences.
 * - No BTC figure without its read date, and no live Bitcoin feed.
 */
export function SatoshiPage() {
  return (
    <>
      <header className="pt-8 pb-5 text-center">
        <div className="microlabel">A DEMONSTRATION · EVERY PULL IS A REAL ATTEMPT</div>
        <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-ink-dim">
          Behind the payline is the first Bitcoin address ever written into the chain. It holds{" "}
          <b className="font-medium text-ink">{GENESIS_TRIBUTES.btc} BTC</b> in plain sight, and the
          only thing keeping it shut is{" "}
          <b className="font-medium text-ink">
            one number among 2<sup>256</sup>
          </b>
          . Pull, and this page draws one of them for real. Line up all 34 and the key is yours. It
          is printed on your ticket either way.
        </p>
      </header>

      <div className="slot-stage">
        <section className="slot-cabinet" aria-label="the machine">
          <div className="slot-topper">
            <h1 className="crt-title slot-marquee">SATOSHI&apos;S LOCK</h1>
            <div className="slot-marquee-sub">
              free play · <b>no stake</b> · ≈ 1 in 2<sup>160</sup> per pull
            </div>
          </div>
          <SlotCabinet />
        </section>
      </div>

      <div className="mt-10 grid gap-5 md:grid-cols-2">
        <Panel title="YOUR ODDS, PER PULL">
          <div className="text-3xl font-extralight text-ink-bright tabular-nums">
            ≈ 1 in 2<sup className="text-base text-green">160</sup>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-ink-dim">
            About 1 in{" "}
            <span className="break-all">
              1,461,501,637,330,902,918,203,684,832,716,283,019,655,932,542,976
            </span>
            . The address is a 160-bit hash of the public key, so any of roughly 2<sup>96</sup> keys
            would open it — which is why the figure is 160 and not 256.
          </p>
          <dl className="mt-4 grid gap-2 text-sm">
            <ScaleRow
              label="Everyone alive pulling once a second since the Big Bang"
              value={
                <>
                  ≈ 3.5 × 10<sup>27</sup> pulls
                </>
              }
            />
            <ScaleRow
              label="Every Bitcoin hash ever computed, repurposed"
              value={
                <>
                  ≈ 10<sup>30</sup> pulls
                </>
              }
            />
            <ScaleRow
              label="Pulls for a coin-flip's chance"
              value={
                <>
                  ≈ 7 × 10<sup>47</sup>
                </>
              }
            />
          </dl>
        </Panel>

        <Panel title="THE TARGET">
          <div className="microlabel">BITCOIN · BLOCK 0 · COINBASE OUTPUT</div>
          <p className="mt-1 font-mono text-base break-all text-ink-bright">
            {GENESIS_TARGET.address}
          </p>
          <dl className="mt-4 grid grid-cols-[max-content_1fr] gap-x-5 gap-y-2 text-sm">
            <dt className="microlabel pt-0.5 text-ink-faint">holds</dt>
            <dd className="tabular-nums">
              {GENESIS_TRIBUTES.exactBtc} BTC{" "}
              <span className="text-ink-faint">
                · read {GENESIS_TRIBUTES.readOn} ·{" "}
                <a
                  href={GENESIS_TRIBUTES.explorerHref}
                  rel="noreferrer"
                  target="_blank"
                  className="text-green hover:underline"
                >
                  check
                </a>
              </span>
            </dd>
            <dt className="microlabel pt-0.5 text-ink-faint">coinbase</dt>
            <dd>
              {GENESIS_COINBASE_BTC} BTC, mined at genesis and{" "}
              <span className="text-ink">unspendable by consensus</span>
              <span className="text-ink-faint">
                {" "}
                — never added to the UTXO set, so no key moves it
              </span>
            </dd>
            <dt className="microlabel pt-0.5 text-ink-faint">owner</dt>
            <dd>
              Satoshi Nakamoto
              <span className="text-ink-faint">
                {" "}
                — by the chain itself: whoever mined block 0 wrote this key into it
              </span>
            </dd>
          </dl>
          <p className="mt-4 border-t border-edge-faint pt-3 text-xs leading-relaxed text-ink-dim">
            Why this address and not &ldquo;the 1.1M BTC&rdquo;: the larger figure rests on a
            mining-pattern attribution nobody has proved. This one needs none.
          </p>
        </Panel>
      </div>

      <section className="mt-10">
        <h2 className="text-2xl font-extralight tracking-tight text-balance text-ink-bright">
          The lock is the same on Zcash. The vault is not.
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-dim">
          A shielded key is a number of the same size, and guessing one is exactly as hopeless. What
          changes is everything before the lock: there is no address on the chain to aim at, no
          balance to read, and no way to know what a hit would even be worth.
        </p>
        <div className="mt-5 grid gap-5 md:grid-cols-2">
          <Panel title="BITCOIN · THIS ADDRESS" headingLevel={3}>
            <VsTable
              rows={[
                ["can you find the target", "yes — it is on every explorer"],
                ["can you see what it holds", `yes — ${GENESIS_TRIBUTES.btc} BTC`],
                ["can you watch it move", "yes — every payment, forever"],
                [
                  "can you pick the lock",
                  <span key="odds">
                    no — ≈ 1 in 2<sup>160</sup>
                  </span>,
                ],
              ]}
            />
          </Panel>
          <Panel title="ZCASH · A SHIELDED ADDRESS" headingLevel={3}>
            <VsTable
              rows={[
                ["can you find the target", "no — the chain publishes no address"],
                ["can you see what it holds", <AmountZec key="veil" zat={null} />],
                ["can you watch it move", "no — a spend reveals neither sender nor amount"],
                ["can you pick the lock", "no — a different curve, the same odds"],
              ]}
            />
          </Panel>
        </div>
        <p className="mt-5 max-w-2xl text-base text-ink">
          Cryptography protects both coins equally.{" "}
          <b className="font-medium text-green">
            Only one of them lets the whole world stand outside the door and count what is inside.
          </b>
        </p>
      </section>

      <p className="mt-10 border-t border-hairline pt-4 text-xs text-ink-faint">
        Every pull runs in your browser. No key, address or count is sent or stored. The balance was
        read from a Bitcoin explorer on the date shown; this site indexes Zcash, not Bitcoin.
      </p>
    </>
  );
}

function ScaleRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[1fr_auto] gap-4 border-t border-hairline pt-2">
      <dt className="text-ink-dim">{label}</dt>
      <dd className="whitespace-nowrap text-ink-faint tabular-nums">{value}</dd>
    </div>
  );
}

function VsTable({ rows }: { rows: ReadonlyArray<readonly [string, React.ReactNode]> }) {
  return (
    <table className="w-full border-collapse text-sm">
      <caption className="sr-only">what a stranger can learn, and do</caption>
      <tbody>
        {rows.map(([question, answer], i) => (
          <tr key={question}>
            <td
              className={`microlabel w-[44%] pr-3 align-top text-ink-faint ${i === 0 ? "pt-0" : "border-t border-hairline pt-3"} pb-2`}
            >
              {question}
            </td>
            <td
              className={`align-top text-ink ${i === 0 ? "pt-0" : "border-t border-hairline pt-2.5"} pb-2`}
            >
              {answer}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
