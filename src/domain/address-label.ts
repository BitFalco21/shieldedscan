/**
 * Names for transparent addresses.
 *
 * Every name records its `basis` and `source`, because a label is a claim about a real company
 * or person. The basis is recorded but not rendered: a name appears on the page without
 * qualification, and the basis governs whether an entry may be added at all.
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
  /** Where the claim came from. Recorded here, rendered nowhere. */
  source: string;
  /** Present only on an address a named investigator flagged; rendered as a banner. */
  flag?: AddressFlag;
}

/**
 * Provenance for the Arkham-sourced entries. Another source gets its own constant, so a
 * `self-declared` entry never inherits this one's standing.
 */
const ARKHAM = "Arkham entity labels (intel.arkm.com), read 2026-08-21";

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
const ZACHXBT_BITGET = "ZachXBT on X, 2026-09-30 (Bitget exploit; flows checked against /v1)";
const ZACHXBT_FLAG: AddressFlag = { by: "ZachXBT", href: "https://t.me/investigations/364" };

/**
 * The labels, keyed by address.
 *
 * The Arkham entries were checked against this site's `/v1/rich-list` (addresses and balances)
 * before being written; the names are Arkham's and therefore `external`.
 *
 * Each name joins the source's entity and wallet-type columns, dropping a repeated entity
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
    source: ARKHAM,
  },
  // #2 on the rich list when this was read
  t1gsBrGZGMyDGZw2icGnMpVBuEGVWip5kH8: {
    name: "Binance Cold Wallet",
    basis: "external",
    source: ARKHAM,
  },
  // #4 on the rich list when this was read
  t3hdTwzcVVGEqDdNKJTBfWvWyaFYNJv7KkA: {
    name: "Gemini Custody",
    basis: "external",
    source: ARKHAM,
  },
  // #6 on the rich list when this was read
  t1VxyLUKaK2tvj5iMRQagued6qpxPNvRkk7: {
    name: "Binance Cold Wallet",
    basis: "external",
    source: ARKHAM,
  },
  // #7 on the rich list when this was read
  t1g47g7wNA55q5PWYHWb6X5JxzhMqwaknjC: {
    name: "Kraken Hot Wallet",
    basis: "external",
    source: ARKHAM,
  },
  // #9 on the rich list when this was read
  t1XP8Pjju5eMYVfXiFNNjkjY8kt5ZLL4maJ: {
    name: "Binance",
    basis: "external",
    source: ARKHAM,
  },
  // #10 on the rich list when this was read
  t1e4VsqHKoMNbFp1RdnzXnedfher8gGA5kJ: {
    name: "Kraken Cold Wallet",
    basis: "external",
    source: ARKHAM,
  },
  // #11 on the rich list when this was read
  t1RyCw14wRXrh3mp21uxgr9ynjem7cNUkMH: {
    name: "Binance Cold Wallet",
    basis: "external",
    source: ARKHAM,
  },
  // #12 on the rich list when this was read
  t1QGQUHitjvXhZLJXgp7772CTEwAfYBRQXr: {
    name: "Kraken Deposit",
    basis: "external",
    source: ARKHAM,
  },
  // #13 on the rich list when this was read
  t1am2oFofYswreeeKTN2G2NLiuW9DQvR5DV: {
    name: "Grayscale Zcash Trust",
    basis: "external",
    source: ARKHAM,
  },
  // #14 on the rich list when this was read
  t1ewXTvioNXo9fRZfjhnwnayQRYBJ5P4ebX: {
    name: "Grayscale Zcash Trust",
    basis: "external",
    source: ARKHAM,
  },
  // #15 on the rich list when this was read
  t1Ku2KLyndDPsR32jwnrTMd3yvi9tfFP8ML: {
    name: "NEAR Intents Bridge Hot Wallet",
    basis: "external",
    source: ARKHAM,
  },
  // #17 on the rich list when this was read
  t3fygNh4yTRdhirVn6qu1QAtTUvZNFmGtbH: {
    name: "Gemini Custody",
    basis: "external",
    source: ARKHAM,
  },
  // #20 on the rich list when this was read
  t1eevo7Gz5KGdRR5w989Gx71yU1v4f4zRsX: {
    name: "Coinbase Prime Custody",
    basis: "external",
    source: ARKHAM,
  },
  // #23 on the rich list when this was read
  t3ev37Q2uL1sfTsiJQJiWJoFzQpDhmnUwYo: {
    name: "ZIP-271 Disbursement Multisig",
    basis: "external",
    source: ARKHAM,
  },
  // #24 on the rich list when this was read
  t3SvZNJqBJZQx5t7o4nDb9YP1VqJ2R2md88: {
    name: "Gemini Custody",
    basis: "external",
    source: ARKHAM,
  },
  // #27 on the rich list when this was read
  t1cyAGaYcwWMdsu8Spfm6zUVynSrLMpTY64: {
    name: "Coinbase Cold Wallet",
    basis: "external",
    source: ARKHAM,
  },
  // #28 on the rich list when this was read
  t1HwLQtvGCNfdpGpPUmK6MURTaW8Ujf6hU8: {
    name: "Coinbase",
    basis: "external",
    source: ARKHAM,
  },
  // #29 on the rich list when this was read
  t1g42kALKk1ZkjNL6hcrW4oRLgUE7Hps7sm: {
    name: "Coinbase Cold Wallet",
    basis: "external",
    source: ARKHAM,
  },
  // #30 on the rich list when this was read
  t1aEbXVxdZasZjcXqYnKJD2N7s12y6Dqp3Z: {
    name: "Coinbase",
    basis: "external",
    source: ARKHAM,
  },
  // #34 on the rich list when this was read
  t1KbKkQ7WisJF52sSepMjYokQJbkJCJ1i3C: {
    name: "Hyperunit Hot Wallet",
    basis: "external",
    source: ARKHAM,
  },
  // #35 on the rich list when this was read
  t1RGtQw8T6pfxG9zJNP5U2dRfC7jggaVPjA: {
    name: "Coinbase Cold Wallet",
    basis: "external",
    source: ARKHAM,
  },
  // #36 on the rich list when this was read
  t1boLLzTf7ddKJoT7PpVUgqUaoPdDgxWzGc: {
    name: "Coinbase Cold Wallet",
    basis: "external",
    source: ARKHAM,
  },
  // #37 on the rich list when this was read
  t1bxF7oetZt2EqWDndzsisTCz4CJhmsjvzL: {
    name: "Coinbase Cold Wallet",
    basis: "external",
    source: ARKHAM,
  },
  // #38 on the rich list when this was read
  t1d2gBnDusuHU8gbbuNcY2xfDxoyQYqeHAv: {
    name: "Coinbase Cold Wallet",
    basis: "external",
    source: ARKHAM,
  },
  // #39 on the rich list when this was read
  t1gw1BUJoLS2SqTHAbE6ghj3dKeb8sEJPea: {
    name: "Coinbase Cold Wallet",
    basis: "external",
    source: ARKHAM,
  },
  // #40 on the rich list when this was read
  t1M64HCu4RhT5h5GJrWQL7WcMq6pzLdusWp: {
    name: "Coinbase Cold Wallet",
    basis: "external",
    source: ARKHAM,
  },
  // #41 on the rich list when this was read
  t1N8Q3EmVSo891V3LTaHijeBK4aMPE4HjGz: {
    name: "Coinbase Cold Wallet",
    basis: "external",
    source: ARKHAM,
  },
  // #42 on the rich list when this was read
  t1TDwC91tn1zny8EMhBDK2YWiGJ6TCEPjcS: {
    name: "Coinbase Cold Wallet",
    basis: "external",
    source: ARKHAM,
  },
  // #43 on the rich list when this was read
  t1ZtktN6KNQhHkuWXfhWnJEn99p1Gm4ZvQr: {
    name: "Coinbase Cold Wallet",
    basis: "external",
    source: ARKHAM,
  },
  // #44 on the rich list when this was read
  t1TocTvTDv6dX8CsCPL7JvxDC8PYChF6Vco: {
    name: "Coinbase Prime Custody",
    basis: "external",
    source: ARKHAM,
  },
  // #48 on the rich list when this was read
  t1NV4euoqYjnutzS9Lr9VvjBD2LLNuXtXXZ: {
    name: "Coinbase",
    basis: "external",
    source: ARKHAM,
  },
  // #49 on the rich list when this was read
  t1ahNXYP7HFi3oJ8G26rjc9wWe5j4ryxxDL: {
    name: "Coinbase Prime Custody",
    basis: "external",
    source: ARKHAM,
  },
  // #50 on the rich list when this was read
  t1cKRdxdeqRFzLGiyHB2KnScMnPTMLBMpx2: {
    name: "Coinbase Cold Wallet",
    basis: "external",
    source: ARKHAM,
  },
  // #51 on the rich list when this was read
  t1L3mP83QYtcVc5r48sB4tYaPiA31z78WPw: {
    name: "Coinbase Cold Wallet",
    basis: "external",
    source: ARKHAM,
  },
  // #52 on the rich list when this was read
  t1MtYxFayfPrDmMUHDk7vV8bqD7z8MdbS4T: {
    name: "Coinbase",
    basis: "external",
    source: ARKHAM,
  },
  // #53 on the rich list when this was read
  t1PKBiv7mtzD9bNafYaqyxaENeiNDbpKxxQ: {
    name: "Binance Hot Wallet",
    basis: "external",
    source: ARKHAM,
  },
  // #54 on the rich list when this was read
  t3WGhZh3QV9Wgj9Xb6MrrhLZhpdyVa8QqLG: {
    name: "Gemini Custody",
    basis: "external",
    source: ARKHAM,
  },
  // #55 on the rich list when this was read
  t1cByqDRogv9vb7fsYRq4PHgH43cpUxxWSz: {
    name: "Coinbase",
    basis: "external",
    source: ARKHAM,
  },
  // #56 on the rich list when this was read
  t1d3xisKP7tfdmNtXr2oDqFToBn1K1gKjSi: {
    name: "Grayscale Zcash Trust",
    basis: "external",
    source: ARKHAM,
  },
  // #83 on the rich list when this was read
  t3LpoiUrHwkgpWA5KVY7LVAKzHKE9qox3Cj: {
    name: "Gemini Custody",
    basis: "external",
    source: ARKHAM,
  },
  // #90 on the rich list when this was read
  t1e2ivMHX7shmSBhBmGzWxeVN3F9MPvDk8R: {
    name: "Grayscale Zcash Trust",
    basis: "external",
    source: ARKHAM,
  },
  // Received the 18,916.72 ZEC swept out of Bitget's hot wallet
  t1WgMdtND8NF7NDUuYmq8MpMj1NTCXkMDVG: {
    name: "BitGet Exploit Sept 2026",
    basis: "external",
    source: ZACHXBT_BITGET,
    flag: ZACHXBT_FLAG,
  },
  // Funded by the theft address; shielded into Ironwood in 9bf8d134…
  t1SyhmRJ35RpGsyuLArsPLepyoiLcawLia5: {
    name: "DPRK attackers",
    basis: "external",
    source: ZACHXBT_BITGET,
    flag: ZACHXBT_FLAG,
  },
  // Funded by the theft address; shielded into Ironwood in 64e5a66c… and 61d2cb33…
  t1gNZpuHEpST6Yu99y1tVb9nKXetkinFgXg: {
    name: "DPRK attackers",
    basis: "external",
    source: ZACHXBT_BITGET,
    flag: ZACHXBT_FLAG,
  },
};

/** The label for an address, or null when it has none. Never a guess. */
export function addressLabel(address: string): AddressLabel | null {
  return ADDRESS_LABELS[address] ?? null;
}
