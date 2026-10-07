/**
 * The claims `/fact-check` answers, and the evidence behind every sentence.
 *
 * Every sentence here was checked against a primary source on the day in `verifiedOn`: the
 * protocol specification, a ZIP, the party's own disclosure, the paper itself, or this
 * explorer's own node. A sentence that could not be sourced is not included.
 *
 * Three rules shape the copy:
 *
 * - The prose holds no live number. A figure that moves (a pool balance, a share) sits in the
 *   claim's `live` row, read at a printed height. Everything in `answer` is a settled past event
 *   or a consensus rule.
 * - A true claim is not refuted. Zcash has had two counterfeiting bugs; that entry is PARTLY
 *   TRUE and says what is true before what is not.
 * - No individual is named, including the researchers behind the papers cited. Organisations
 *   are named where a source names them.
 */

import { apiBaseUrl } from "@/lib/site";

/**
 * How far a claim is from the record. A backdoor's absence cannot be proven (an undetected flaw
 * sat in public Orchard code for four years), so "Zcash has an intelligence backdoor" is
 * UNFOUNDED (nothing supports it) rather than FALSE.
 */
export type Verdict = "false" | "misleading" | "outdated" | "partly-true" | "unfounded";

export const VERDICT_LABEL: Record<Verdict, string> = {
  false: "FALSE",
  misleading: "MISLEADING",
  outdated: "OUTDATED",
  "partly-true": "PARTLY TRUE",
  unfounded: "UNFOUNDED",
};

/** What each verdict means, for the tag's tooltip — the word carries it, this spells it out. */
export const VERDICT_MEANING: Record<Verdict, string> = {
  false: "The record contradicts it.",
  misleading: "Built on something true, but the conclusion does not follow.",
  outdated: "Closer to true once; not now.",
  "partly-true": "Part of it is true — the answer says which part.",
  unfounded: "Nothing on record supports it.",
};

/**
 * A live figure a claim can show beneath its answer. The figures are computed in
 * `figures.ts` from one supply read and one chain read; the prose never quotes them.
 */
export type LiveFigureId =
  "lockbox" | "flawed-pools" | "setup-free" | "shielded-share" | "fully-shielded-24h";

export interface ClaimSource {
  label: string;
  /** An absolute `https://` URL, or a path on this site (`/block/0`) a reader can check. */
  href: string;
  /** The UTC day the source was read and found to say what the answer relies on. */
  verifiedOn: string;
}

export type ClaimGroupId = "supply" | "privacy" | "governance";

export interface Claim {
  /** The anchor, so one answer can be linked on its own: `/fact-check#premine`. */
  id: string;
  group: ClaimGroupId;
  /** The claim as it is usually made, paraphrased. */
  claim: string;
  verdict: Verdict;
  /** One to four short sentences. */
  answer: readonly string[];
  live?: readonly LiveFigureId[];
  sources: readonly ClaimSource[];
}

export const CLAIM_GROUPS: readonly { id: ClaimGroupId; title: string }[] = [
  { id: "supply", title: "Supply" },
  { id: "privacy", title: "Privacy" },
  { id: "governance", title: "Who runs it" },
];

/**
 * A chain fact cited through this explorer's public API rather than its pages: the fixture
 * chain that preview builds and e2e render holds none of these heights, so a page link would
 * 404 everywhere but production. The keyless `/v1` URL answers on every build.
 */
const chainFact = (label: string, path: string): ClaimSource => ({
  label,
  href: `${apiBaseUrl}${path}`,
  verifiedOn: "2026-09-27",
});

const SPEC: ClaimSource = {
  label: "Zcash protocol specification",
  href: "https://zips.z.cash/protocol/protocol.pdf",
  verifiedOn: "2026-09-27",
};
const zip = (n: number, title: string, verifiedOn = "2026-09-27"): ClaimSource => ({
  label: `ZIP ${n}: ${title}`,
  href: `https://zips.z.cash/zip-${String(n).padStart(4, "0")}`,
  verifiedOn,
});
const ORCHARD_DISCLOSURE: ClaimSource = {
  label: "Shielded Labs, The Orchard Counterfeiting Vulnerability (2026)",
  href: "https://forum.zcashcommunity.com/t/the-orchard-counterfeiting-vulnerability-and-next-steps/56015",
  verifiedOn: "2026-09-27",
};
const IRONWOOD: ClaimSource = {
  label: "Shielded Labs, Ironwood",
  href: "https://shieldedlabs.net/ironwood/",
  verifiedOn: "2026-09-27",
};
const SPROUT_DISCLOSURE: ClaimSource = {
  label: "Electric Coin Company, Zcash Counterfeiting Vulnerability Successfully Remediated (2019)",
  href: "https://electriccoin.co/blog/zcash-counterfeiting-vulnerability-successfully-remediated/",
  verifiedOn: "2026-09-27",
};
/*
 * Archived deliberately: the live URL answers 404 since ECC restructured its site (checked
 * 2026-09-27), and the archive is the only copy that still carries the phase counts.
 */
const SAPLING_MPC: ClaimSource = {
  label: "Electric Coin Company, Completion of the Sapling MPC (2018, archived)",
  href: "https://web.archive.org/web/20231001193115/https://electriccoin.co/blog/completion-of-the-sapling-mpc/",
  verifiedOn: "2026-09-27",
};
const HALO2: ClaimSource = {
  label: "Electric Coin Company, Explaining Halo 2",
  href: "https://electriccoin.co/blog/explaining-halo-2/",
  verifiedOn: "2026-09-27",
};
const UCL_2018: ClaimSource = {
  label: "An Empirical Analysis of Anonymity in Zcash (USENIX Security 2018)",
  href: "https://www.usenix.org/conference/usenixsecurity18/presentation/kappos",
  verifiedOn: "2026-09-27",
};

/*
 * Monero is described only through its own project's publications, read 2026-09-30: the
 * technical specification (launch day, a ring of 16 = 15 decoys), the 2022 upgrade notice
 * (ring 11 to 16) and the FCMP++ hard-fork milestone, which had no activation height yet.
 */
const MONERO_SPECS: ClaimSource = {
  label: "Monero technical specification",
  href: "https://docs.getmonero.org/technical-specs/",
  verifiedOn: "2026-09-30",
};
const MONERO_RING_16: ClaimSource = {
  label: "Monero, network upgrade of August 2022 (ring size 16)",
  href: "https://www.getmonero.org/2022/04/20/network-upgrade-july-2022.html",
  verifiedOn: "2026-09-30",
};
const MONERO_FCMP: ClaimSource = {
  label: "Monero, FCMP++ hard-fork milestone (not yet activated)",
  href: "https://github.com/monero-project/monero/milestone/1",
  verifiedOn: "2026-09-30",
};

export const CLAIMS: readonly Claim[] = [
  {
    id: "premine",
    group: "supply",
    claim: "Zcash was premined for its founders.",
    verdict: "false",
    answer: [
      "No coins existed before mining began. The genesis block paid nothing. Block 1 paid 0.000625 ZEC, and the reward rose a little each block until it reached the full 12.5 ZEC at block 20,000.",
      "The Founders' Reward was 20% of each block's subsidy, paid in public outputs from block 1 until it ended at block 1,046,400 in November 2020.",
    ],
    sources: [
      SPEC,
      chainFact("Block 0, via this explorer's public API", "/v1/blocks/0"),
      chainFact("Block 1, via this explorer's public API", "/v1/blocks/1"),
      chainFact(
        "Block 1,046,399's coinbase, the last Founders' Reward",
        "/v1/transactions/59cce1aba2e22e68f69d7c10fb4c2813c8447ca22736c0ce1a0daed6fff7cd70",
      ),
    ],
  },
  {
    id: "insiders-forever",
    group: "supply",
    claim: "20% of every block goes to insiders, forever.",
    verdict: "misleading",
    answer: [
      "The Founders' Reward ended in 2020. Today miners get 80% of each block's subsidy, Zcash Community Grants 8%, and 12% goes to a lockbox that no transaction can spend.",
      "One upgrade has released lockbox funds: 78,750 ZEC in November 2025, to a multisig held by the Zcash Foundation, Electric Coin Company and Shielded Labs, for development grants.",
      "Both streams stop at block 4,406,400, the next halving.",
    ],
    live: ["lockbox"],
    sources: [
      zip(214, "Consensus rules for a Zcash Development Fund", "2026-08-12"),
      zip(271, "Dev Fund Extension and One-Time Disbursement"),
      { label: "Today's subsidy split, from our node", href: "/halving", verifiedOn: "2026-09-27" },
      chainFact(
        "The 78,750 ZEC disbursement, via this explorer's public API",
        "/v1/transactions/525f440283b4c9ec30fa04a5796f3ddfa4ba1e1e48657a8d6f32313f36cf1381",
      ),
    ],
  },
  {
    id: "hidden-inflation",
    group: "supply",
    claim: "Hidden inflation means nobody can verify Zcash's supply.",
    verdict: "partly-true",
    answer: [
      "The total supply stays checkable: every pool's balance is public and nodes reject any block that would take one below zero, so counterfeit coins could only take from the flawed pool's other holders, never add to the supply.",
      "What is true: bugs in Sprout (fixed 2018) and Orchard (live 2022 until an emergency fix on 2026-06-01) could have let someone mint unseen ZEC inside that pool, and whether either was used cannot be proven from the chain.",
      "Neither pool accepts deposits any more: Sprout since 2020, Orchard since 2026-07-28.",
    ],
    live: ["flawed-pools"],
    sources: [
      ORCHARD_DISCLOSURE,
      IRONWOOD,
      SPROUT_DISCLOSURE,
      zip(209, "Prohibit Out-of-Range Chain Value Pool Balances"),
      zip(211, "Disabling Addition of New Value to the Sprout Chain Value Pool"),
    ],
  },
  {
    id: "trusted-setup",
    group: "supply",
    claim: "The trusted setup lets Zcash's creators print coins.",
    verdict: "misleading",
    answer: [
      "The ceremonies were built so that one honest participant was enough to make the setup's secret unrecoverable: Sprout's had six participants, and Sapling's two phases took 87 and more than 90 contributions.",
      "Sprout's setup did have a real flaw: a mistake in its proving system left elements in the ceremony transcript that anyone holding it could have used to forge proofs. It was fixed in 2018.",
      "Orchard and Ironwood use Halo 2, which needs no setup at all.",
    ],
    live: ["setup-free"],
    sources: [
      SAPLING_MPC,
      {
        label: "Zcash Foundation, Conclusion of the Powers of Tau Ceremony (2018)",
        href: "https://zfnd.org/conclusion-of-the-powers-of-tau-ceremony/",
        verifiedOn: "2026-09-27",
      },
      SPROUT_DISCLOSURE,
      HALO2,
      SPEC,
    ],
  },
  {
    id: "nobody-shields",
    group: "privacy",
    claim: "Nobody actually uses Zcash's privacy.",
    verdict: "outdated",
    answer: [
      "No longer: a large share of ZEC is now held shielded, and fully shielded transactions are made every day, as the live figures below show.",
      'The "mostly public" finding comes from a 2018 study, published before Sapling and the two newer shielded pools, Orchard and Ironwood.',
    ],
    live: ["shielded-share", "fully-shielded-24h"],
    sources: [
      UCL_2018,
      { label: "The shielded pools, live", href: "/shielded", verifiedOn: "2026-09-27" },
    ],
  },
  {
    id: "privacy-broken",
    group: "privacy",
    claim: "Researchers broke Zcash's privacy in 2018.",
    verdict: "misleading",
    answer: [
      "A 2018 UCL study linked coins entering and leaving the shielded pool from how people used it: the same amount withdrawn soon after it went in, and the founders' and mining pools' routine withdrawals. That cut the era's anonymity set by 69.1%.",
      "It broke no cryptography. Of the transactions inside the pool, it found that relatively little information can be inferred.",
    ],
    sources: [UCL_2018],
  },
  {
    id: "small-anonymity-set",
    group: "privacy",
    claim: "Optional privacy leaves Zcash with a tiny anonymity set.",
    verdict: "partly-true",
    answer: [
      "A fully shielded payment proves it spends some note in its pool without revealing which, so the whole pool is its anonymity set.",
      "What is true: transparent use and quick in-and-out trips leak information; that is what the 2018 study exploited.",
    ],
    sources: [UCL_2018, SPEC],
  },
  {
    id: "monero-better-privacy",
    group: "privacy",
    claim: "Monero is a better privacy tool than Zcash.",
    verdict: "misleading",
    answer: [
      "Monero hides every transaction by default, which is a real strength.",
      "But each input of a Monero transaction publicly lists 16 earlier outputs it might be spending, the real one and 15 decoys, so an observer always starts from a shortlist of 16.",
      "A fully shielded Zcash spend lists nothing: its zero-knowledge proof shows it spends some note in its pool without revealing which, so its anonymity set is every note in that pool.",
      "Monero's own planned fix, proofs over its whole chain, is the approach Zcash has used since 2016, and as of 2026-09-30 it has not activated.",
    ],
    sources: [MONERO_SPECS, MONERO_RING_16, MONERO_FCMP, SPEC],
  },
  {
    id: "criminals-use-monero",
    group: "privacy",
    claim: "Criminals only use Monero, not Zcash.",
    verdict: "misleading",
    answer: [
      "Monero came first: it launched in 2014, more than two years before Zcash, and privacy is part of every Monero transaction.",
      "Early Zcash was harder to use: a shielded transaction needed around 1.5 GB of memory and 40 seconds until Sapling cut that to a few seconds in 2018, and its shielded pools needed a trusted setup until Orchard in 2022.",
      "Wallets built for shielded ZEC, such as Zodl and Vizor, came later still, so criminals settled on Monero first: a 2020 RAND study found it far more accepted than Zcash on dark-web markets, and named Zcash's usability as one reason.",
      "That is a network effect, not a verdict on the technology: Monero's privacy is good, but it does not match a fully shielded Zcash transaction.",
    ],
    sources: [
      MONERO_SPECS,
      {
        label: "Electric Coin Company, Sapling Addresses & Turnstile Migration (2018, archived)",
        href: "https://web.archive.org/web/20260823083437/https://electriccoin.co/blog/sapling-addresses-turnstile-migration/",
        verifiedOn: "2026-09-30",
      },
      {
        label: "Electric Coin Company, What's New in Sapling (2018)",
        href: "https://electriccoin.co/blog/whats-new-in-sapling/",
        verifiedOn: "2026-09-30",
      },
      {
        label:
          "RAND Europe, Exploring the use of Zcash cryptocurrency for illicit or criminal purposes (2020, commissioned by Electric Coin Company)",
        href: "https://www.rand.org/pubs/research_reports/RR4418.html",
        verifiedOn: "2026-09-30",
      },
      zip(224, "Orchard Shielded Protocol", "2026-09-30"),
      {
        label: "Zodl wallet (source code)",
        href: "https://github.com/zodl-inc/zodl-android",
        verifiedOn: "2026-09-30",
      },
      {
        label: "Vizor wallet (source code)",
        href: "https://github.com/chainapsis/vizor-wallet",
        verifiedOn: "2026-09-30",
      },
    ],
  },
  {
    id: "viewing-key-backdoor",
    group: "privacy",
    claim: "Viewing keys are a backdoor for governments.",
    verdict: "false",
    answer: [
      "Your wallet derives viewing keys from your own seed, and nothing in the protocol sends one anywhere. A key leaves only if you share it.",
      "A full viewing key shows that address's whole history, which is why you should never paste one into a website, including this one.",
    ],
    sources: [zip(32, "Shielded Hierarchical Deterministic Wallets")],
  },
  {
    id: "one-company",
    group: "governance",
    claim: "Zcash is controlled by one company.",
    verdict: "misleading",
    answer: [
      "The specification defines Zcash's governance as social consensus on which node software faithfully implements the rules, and the implementations it names are maintained by different organisations.",
      "Rule changes ship as public ZIPs, and a coinholder vote on the next upgrade's scope closed on 2026-09-14. It is fair to say a handful of organisations do most of the development.",
    ],
    sources: [
      SPEC,
      zip(0, "ZIP Process"),
      {
        label: "Zcash Labs, NU7 coinholder vote",
        href: "https://zcashlabs.org/voting",
        verifiedOn: "2026-09-27",
      },
    ],
  },
  {
    id: "intelligence-backdoor",
    group: "governance",
    claim: "Zcash is an Israeli intelligence project with a backdoor.",
    verdict: "unfounded",
    answer: [
      "What is true: two of the seven authors of Zerocash, the 2014 paper Zcash implements, worked at Israeli universities; the other five were at MIT and Johns Hopkins.",
      "Zcash does not ask you to trust its authors. The code is open source, the cryptography is published, and Orchard and Ironwood need no trusted setup at all.",
      "A researcher's nationality or religion is not evidence about code, and this code can be checked instead of assumed.",
    ],
    sources: [
      {
        label: "Zerocash: Decentralized Anonymous Payments from Bitcoin (IEEE S&P 2014)",
        href: "https://eprint.iacr.org/2014/349",
        verifiedOn: "2026-09-27",
      },
      SPEC,
      {
        label: "Halo 2 source code",
        href: "https://github.com/zcash/halo2",
        verifiedOn: "2026-09-27",
      },
      {
        label: "Zebra node source code",
        href: "https://github.com/ZcashFoundation/zebra",
        verifiedOn: "2026-09-27",
      },
    ],
  },
];
