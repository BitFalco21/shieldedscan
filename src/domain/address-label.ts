import { HYPERUNIT_DEPOSIT_ADDRESSES } from "./hyperunit-deposits";

/**
 * Names for transparent addresses.
 *
 * A label is a claim about a real company or person. Its `basis` is recorded but not rendered,
 * and no label states where it came from: a name appears on the page without qualification.
 */

/**
 * How we know.
 *
 * - `self-declared` — the address's holder published it themselves (an exchange's documented
 *   cold wallet, a foundation's posted donation address). The only claim a reader can check
 *   without trusting us.
 * - `external` — a third party attributes it and we are repeating them.
 * - `unattributed` — no label. The address is its own name.
 */
export type AddressLabelBasis = "self-declared" | "external" | "unattributed";

/**
 * Who publicly flagged an address, and where they published it.
 *
 * The one case where attribution is printed: naming an address as part of a theft is a claim
 * about a crime, so the page names who made it and links to it rather than stating it in this
 * site's own voice.
 */
export interface AddressFlag {
  /** The investigator, as they sign their work. */
  by: string;
  /** Their published post. Rendered as an outbound link with no referrer. */
  href: string;
}

export interface AddressLabel {
  name: string;
  basis: Exclude<AddressLabelBasis, "unattributed">;
  /** Present only on an address a named investigator flagged; rendered as a banner. */
  flag?: AddressFlag;
}

/**
 * The Bitget hot-wallet theft of 2026-09-24, attributed by ZachXBT on 2026-09-30.
 *
 * The DPRK attribution is ZachXBT's ("alleged"), repeated rather than verified. The flows were
 * checked against this site's own `/v1`: two sweeps (blocks 3,494,885 and 3,494,980) moved
 * 18,916.72 ZEC into the theft address; at 3,501,236 / 3,501,238 / 3,501,252 it paid 876.42 and
 * 993.46 ZEC to one address and 876.43 ZEC to the other; those two spent exactly that into
 * Ironwood in the three shieldings the post names (9bf8d134…, 64e5a66c…, 61d2cb33…).
 *
 * Only the addresses the post evidences are named; the theft address's other payees are not,
 * since naming them would be our inference.
 */
const ZACHXBT_FLAG: AddressFlag = { by: "ZachXBT", href: "https://t.me/investigations/364" };

/**
 * The labels, keyed by address.
 *
 * Every address was checked against this site's own index before being written.
 *
 * Each name joins an entity and a wallet type, dropping a repeated entity
 * ("Coinbase Coinbase Prime Custody") and a parenthetical that restates a sibling
 * ("Cold Wallet (Gemini Custody)"). Tests pin both.
 *
 * One address is one address: repeated names such as "Coinbase Cold Wallet" are deliberate, and
 * entries are never clustered into one entity's wallets. An unlabelled address is its own name.
 */
export const ADDRESS_LABELS: Readonly<Record<string, AddressLabel>> = {
  // #1 on the rich list when this was read
  t3aPMe94jMKyrgkbH5SSukimvdMFJ59EFhP: {
    name: "Gemini Cold Wallet",
    basis: "external",
  },
  // #2 on the rich list when this was read
  t1gsBrGZGMyDGZw2icGnMpVBuEGVWip5kH8: {
    name: "Binance Cold Wallet",
    basis: "external",
  },
  // #4 on the rich list when this was read
  t3hdTwzcVVGEqDdNKJTBfWvWyaFYNJv7KkA: {
    name: "Gemini Custody",
    basis: "external",
  },
  // #6 on the rich list when this was read
  t1VxyLUKaK2tvj5iMRQagued6qpxPNvRkk7: {
    name: "Binance Cold Wallet",
    basis: "external",
  },
  // #7 on the rich list when this was read
  t1g47g7wNA55q5PWYHWb6X5JxzhMqwaknjC: {
    name: "Kraken Hot Wallet",
    basis: "external",
  },
  // #9 on the rich list when this was read
  t1XP8Pjju5eMYVfXiFNNjkjY8kt5ZLL4maJ: {
    name: "Binance",
    basis: "external",
  },
  // #10 on the rich list when this was read
  t1e4VsqHKoMNbFp1RdnzXnedfher8gGA5kJ: {
    name: "Kraken Cold Wallet",
    basis: "external",
  },
  // #11 on the rich list when this was read
  t1RyCw14wRXrh3mp21uxgr9ynjem7cNUkMH: {
    name: "Binance Cold Wallet",
    basis: "external",
  },
  // #12 on the rich list when this was read
  t1QGQUHitjvXhZLJXgp7772CTEwAfYBRQXr: {
    name: "Kraken Deposit",
    basis: "external",
  },
  // #13 on the rich list when this was read
  t1am2oFofYswreeeKTN2G2NLiuW9DQvR5DV: {
    name: "Grayscale Zcash Trust",
    basis: "external",
  },
  // #14 on the rich list when this was read
  t1ewXTvioNXo9fRZfjhnwnayQRYBJ5P4ebX: {
    name: "Grayscale Zcash Trust",
    basis: "external",
  },
  // #15 on the rich list when this was read
  t1Ku2KLyndDPsR32jwnrTMd3yvi9tfFP8ML: {
    name: "NEAR Intents Bridge Hot Wallet",
    basis: "external",
  },
  // #17 on the rich list when this was read
  t3fygNh4yTRdhirVn6qu1QAtTUvZNFmGtbH: {
    name: "Gemini Custody",
    basis: "external",
  },
  // #20 on the rich list when this was read
  t1eevo7Gz5KGdRR5w989Gx71yU1v4f4zRsX: {
    name: "Coinbase Prime Custody",
    basis: "external",
  },
  // #23 on the rich list when this was read
  t3ev37Q2uL1sfTsiJQJiWJoFzQpDhmnUwYo: {
    name: "ZIP-271 Disbursement Multisig",
    basis: "external",
  },
  // #24 on the rich list when this was read
  t3SvZNJqBJZQx5t7o4nDb9YP1VqJ2R2md88: {
    name: "Gemini Custody",
    basis: "external",
  },
  // #27 on the rich list when this was read
  t1cyAGaYcwWMdsu8Spfm6zUVynSrLMpTY64: {
    name: "Coinbase Cold Wallet",
    basis: "external",
  },
  // #28 on the rich list when this was read
  t1HwLQtvGCNfdpGpPUmK6MURTaW8Ujf6hU8: {
    name: "Coinbase",
    basis: "external",
  },
  // #29 on the rich list when this was read
  t1g42kALKk1ZkjNL6hcrW4oRLgUE7Hps7sm: {
    name: "Coinbase Cold Wallet",
    basis: "external",
  },
  // #30 on the rich list when this was read
  t1aEbXVxdZasZjcXqYnKJD2N7s12y6Dqp3Z: {
    name: "Coinbase",
    basis: "external",
  },
  // #34 on the rich list when this was read
  t1KbKkQ7WisJF52sSepMjYokQJbkJCJ1i3C: {
    name: "Hyperunit Hot Wallet",
    basis: "external",
  },
  // #35 on the rich list when this was read
  t1RGtQw8T6pfxG9zJNP5U2dRfC7jggaVPjA: {
    name: "Coinbase Cold Wallet",
    basis: "external",
  },
  // #36 on the rich list when this was read
  t1boLLzTf7ddKJoT7PpVUgqUaoPdDgxWzGc: {
    name: "Coinbase Cold Wallet",
    basis: "external",
  },
  // #37 on the rich list when this was read
  t1bxF7oetZt2EqWDndzsisTCz4CJhmsjvzL: {
    name: "Coinbase Cold Wallet",
    basis: "external",
  },
  // #38 on the rich list when this was read
  t1d2gBnDusuHU8gbbuNcY2xfDxoyQYqeHAv: {
    name: "Coinbase Cold Wallet",
    basis: "external",
  },
  // #39 on the rich list when this was read
  t1gw1BUJoLS2SqTHAbE6ghj3dKeb8sEJPea: {
    name: "Coinbase Cold Wallet",
    basis: "external",
  },
  // #40 on the rich list when this was read
  t1M64HCu4RhT5h5GJrWQL7WcMq6pzLdusWp: {
    name: "Coinbase Cold Wallet",
    basis: "external",
  },
  // #41 on the rich list when this was read
  t1N8Q3EmVSo891V3LTaHijeBK4aMPE4HjGz: {
    name: "Coinbase Cold Wallet",
    basis: "external",
  },
  // #42 on the rich list when this was read
  t1TDwC91tn1zny8EMhBDK2YWiGJ6TCEPjcS: {
    name: "Coinbase Cold Wallet",
    basis: "external",
  },
  // #43 on the rich list when this was read
  t1ZtktN6KNQhHkuWXfhWnJEn99p1Gm4ZvQr: {
    name: "Coinbase Cold Wallet",
    basis: "external",
  },
  // #44 on the rich list when this was read
  t1TocTvTDv6dX8CsCPL7JvxDC8PYChF6Vco: {
    name: "Coinbase Prime Custody",
    basis: "external",
  },
  // #48 on the rich list when this was read
  t1NV4euoqYjnutzS9Lr9VvjBD2LLNuXtXXZ: {
    name: "Coinbase",
    basis: "external",
  },
  // #49 on the rich list when this was read
  t1ahNXYP7HFi3oJ8G26rjc9wWe5j4ryxxDL: {
    name: "Coinbase Prime Custody",
    basis: "external",
  },
  // #50 on the rich list when this was read
  t1cKRdxdeqRFzLGiyHB2KnScMnPTMLBMpx2: {
    name: "Coinbase Cold Wallet",
    basis: "external",
  },
  // #51 on the rich list when this was read
  t1L3mP83QYtcVc5r48sB4tYaPiA31z78WPw: {
    name: "Coinbase Cold Wallet",
    basis: "external",
  },
  // #52 on the rich list when this was read
  t1MtYxFayfPrDmMUHDk7vV8bqD7z8MdbS4T: {
    name: "Coinbase",
    basis: "external",
  },
  // #53 on the rich list when this was read
  t1PKBiv7mtzD9bNafYaqyxaENeiNDbpKxxQ: {
    name: "Binance Hot Wallet",
    basis: "external",
  },
  // #54 on the rich list when this was read
  t3WGhZh3QV9Wgj9Xb6MrrhLZhpdyVa8QqLG: {
    name: "Gemini Custody",
    basis: "external",
  },
  // #55 on the rich list when this was read
  t1cByqDRogv9vb7fsYRq4PHgH43cpUxxWSz: {
    name: "Coinbase",
    basis: "external",
  },
  // #56 on the rich list when this was read
  t1d3xisKP7tfdmNtXr2oDqFToBn1K1gKjSi: {
    name: "Grayscale Zcash Trust",
    basis: "external",
  },
  // #83 on the rich list when this was read
  t3LpoiUrHwkgpWA5KVY7LVAKzHKE9qox3Cj: {
    name: "Gemini Custody",
    basis: "external",
  },
  // #90 on the rich list when this was read
  t1e2ivMHX7shmSBhBmGzWxeVN3F9MPvDk8R: {
    name: "Grayscale Zcash Trust",
    basis: "external",
  },
  // Binance's withdrawal wallet since its 2026-10-31 address refresh: funded on 2026-11-01 from a
  // transaction spending two labelled Binance addresses, sweeps its surplus to t1gsBrGZ… (#107
  // on the rich list when this was read)
  t1SzbuFRuPa5upV6c9ZgKb9V7fxn2b8NAKg: {
    name: "Binance Hot Wallet",
    basis: "external",
  },
  // #97 on the rich list when this was read
  t1TQDWckzPtJYxYJq8vYZ2hGDVxjTPhNbjL: {
    name: "Grayscale Zcash Trust",
    basis: "external",
  },
  // Received the 18,916.72 ZEC swept out of Bitget's hot wallet
  t1WgMdtND8NF7NDUuYmq8MpMj1NTCXkMDVG: {
    name: "BitGet Exploit Sept 2026",
    basis: "external",
    flag: ZACHXBT_FLAG,
  },
  // Funded by the theft address; shielded into Ironwood in 9bf8d134…
  t1SyhmRJ35RpGsyuLArsPLepyoiLcawLia5: {
    name: "DPRK attackers",
    basis: "external",
    flag: ZACHXBT_FLAG,
  },
  // Funded by the theft address; shielded into Ironwood in 64e5a66c… and 61d2cb33…
  t1gNZpuHEpST6Yu99y1tVb9nKXetkinFgXg: {
    name: "DPRK attackers",
    basis: "external",
    flag: ZACHXBT_FLAG,
  },
  t1bd55vRgLcBpBxJQFHodH9wb8uTkym6dqc: {
    name: "Coinbase Prime Custody",
    basis: "external",
  },
  t1bjJUUESDGx57t146rd5oFdGkN6meUzg7S: {
    name: "Coinbase Prime Custody",
    basis: "external",
  },
  t1cB2VWdTNV9eW37GQwkj2nvyMdGzECoaiw: {
    name: "Coinbase",
    basis: "external",
  },
  t1cLXeZt4mWKohk51N3Vhy7cWJtfz6fgANF: {
    name: "Binance Cold Wallet",
    basis: "external",
  },
  t1e1BVBDt3HTca4M8T9BWRApaBXKETDwWHz: {
    name: "Coinbase Prime Custody",
    basis: "external",
  },
  t1KuoWCFjRcbG7HKhtVARCgBv7PcxRfMmQd: {
    name: "Coinbase Prime Custody",
    basis: "external",
  },
  t1M1j1rPwUFGz8GDFrgi8rs9R3c7XtCH4Gv: {
    name: "Binance Cold Wallet",
    basis: "external",
  },
  t1PaCpkUPc5cM6FH9jSfFTUVC3DgrYRgxfj: {
    name: "Binance",
    basis: "external",
  },
  t1Rmpqyu1jTXrjU8SEw6GmdRXdxCdPbmj6k: {
    name: "Binance Cold Wallet",
    basis: "external",
  },
  t1VscjxQX2pvPjXCyUAFZxXMAU4BtKr9KGv: {
    name: "Binance Cold Wallet",
    basis: "external",
  },
  t1YjihZAttWbUQJYGgwhEvdGJLbTVcVGGez: {
    name: "KuCoin Cold Wallet",
    basis: "external",
  },
  t1KcqGM7QXUEjVQaWoFhQycavtbHL2gB3f6: {
    name: "Coinbase Prime Custody",
    basis: "external",
  },
  t1fFh6Zy59XceAKfSjqWAqFT5SpStXkQ5hY: {
    name: "Coinbase Prime Custody",
    basis: "external",
  },
  t1PqSbFrj7M3ttYGFc4epHJaJewxdpokv2q: {
    name: "Coinbase Prime Custody",
    basis: "external",
  },
  t1KNV8DZPapZeNnmt6Bzx7J71RejPRACqRk: {
    name: "Coinbase Prime Custody",
    basis: "external",
  },
  t1V2tPpb8cj5z9itXywWVGtTtZK9jP7fEMz: {
    name: "Coinbase Prime Custody",
    basis: "external",
  },
  t1QfYXCJ8T7Eee7TTZ7pzXQ8mdikbJfDCQg: {
    name: "Coinbase Prime Custody",
    basis: "external",
  },
  t1gH8kwDu1euQky74m2CS15vtopntebdKX5: {
    name: "Coinbase Prime Custody",
    basis: "external",
  },
  t1N7GfJ22i3L7GFHpt3BzZdpkASBUiyoVtQ: {
    name: "Coinbase Prime Custody",
    basis: "external",
  },
  t1MyisuNveKK7QcZWXbRrjqkx6XiwXjsKq6: {
    name: "Grayscale Zcash Trust",
    basis: "external",
  },
  t1ZQKpSQn49NpL8AgusVFnRejiW5EdGgTum: {
    name: "Grayscale Zcash Trust",
    basis: "external",
  },
  t1arbxXoLiKrMmBij7fzUHxh51LwUX9TniQ: {
    name: "Grayscale Zcash Trust",
    basis: "external",
  },
  t3fbJDFn6mBdpFAgGdNPnMGRjEdGS2GB6JE: {
    name: "OKX",
    basis: "external",
  },
  t3U4CFPtnLoAjL9fSsQE2PMc49RAGbmfn5n: {
    name: "KuCoin Deposit",
    basis: "external",
  },
  t1buK2T66Wrkf8TTc1Um2Y9co9dR3Pb5uFW: {
    name: "Bitget Deposit",
    basis: "external",
  },
  t1NuCztsAfdTWfuowWCKneUPDys5S4puiBW: {
    name: "Gate Cold Wallet",
    basis: "external",
  },
  ...Object.fromEntries(
    HYPERUNIT_DEPOSIT_ADDRESSES.map((address) => [
      address,
      { name: "Hyperunit Deposit", basis: "external" } satisfies AddressLabel,
    ]),
  ),
};

/** The label for an address, or null when it has none. Never a guess. */
export function addressLabel(address: string): AddressLabel | null {
  return ADDRESS_LABELS[address] ?? null;
}

/**
 * The logo drawn before each label name: the id of a committed icon under
 * `public/ecosystem/logos/` (the reviewed files `/ecosystem` serves), or null for the neutral tag
 * glyph. Decided by hand for every name in `ADDRESS_LABELS`; a test fails on a name missing here.
 * Null where no single organisation's mark fits: a multisig of three, or a firm with no reviewed
 * icon.
 */
export const LABEL_LOGOS: Readonly<Record<string, string | null>> = {
  Binance: "binance",
  "Binance Cold Wallet": "binance",
  "Binance Hot Wallet": "binance",
  Coinbase: "coinbase",
  "Coinbase Cold Wallet": "coinbase",
  "Coinbase Prime Custody": "coinbase",
  "Gemini Cold Wallet": "gemini",
  "Gemini Custody": "gemini",
  "Kraken Cold Wallet": "kraken",
  "Kraken Deposit": "kraken",
  "Kraken Hot Wallet": "kraken",
  OKX: "okx",
  "KuCoin Cold Wallet": "kucoin",
  "KuCoin Deposit": "kucoin",
  "Bitget Deposit": "bitget",
  "Gate Cold Wallet": "gate",
  "Grayscale Zcash Trust": "grayscale-zcash-etf",
  "NEAR Intents Bridge Hot Wallet": "near-intents",
  "Hyperunit Hot Wallet": null,
  "Hyperunit Deposit": null,
  "ZIP-271 Disbursement Multisig": null,
  "BitGet Exploit Sept 2026": null,
  "DPRK attackers": null,
};

/**
 * The logo for a label, or null for the tag glyph. A theft-flagged address never takes one:
 * Bitget's mark beside "BitGet Exploit" would read as Bitget's own wallet.
 */
export function addressLabelLogo(label: AddressLabel): string | null {
  if (label.flag !== undefined) return null;
  return LABEL_LOGOS[label.name] ?? null;
}
