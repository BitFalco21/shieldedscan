import { DAY_MS } from "@/domain/time";

/**
 * Committed Zcash reference facts: the whole data source of `zcash_reference`.
 *
 * We do not index ceremony data, upgrade history or the roadmap, but "we do not index it" does not
 * mean "I cannot say it". Without committed facts the model either refuses a documented, checkable
 * number (Sprout's six ceremony participants) or volunteers unverifiable claims from memory.
 *
 * A frozen, reviewable set of facts, each pinned to a primary source actually read on
 * `verifiedOn`. The agent may state a figure from here because a reader can open the document
 * behind it. Outside these entries the agent explains qualitatively and invents no number.
 *
 * Not a measurement and nothing read from the node, which is why it is a separate tool rather than
 * a topic of `explorer_insights`: a tool name is a claim about whose figures these are, and
 * `insights` means an aggregate this explorer measured from its own index.
 *
 * Three properties follow from the data being frozen:
 *
 *  - No injection carrier. Every other tool's payload can carry bytes a stranger chose (a coinbase
 *    tag, a venue's chain label, a DeFiLlama pool symbol); nobody outside this repo writes here.
 *  - No `<unavailable>` path. There is no read, so there is no read to fail.
 *  - A wrong fact is a diff: reviewable, greppable, fixable in one commit.
 */

/** One committed fact. Every field is load-bearing; see `verifiedOn` in particular. */
export interface ReferenceEntry {
  /** Stable slug. Appears in the citation transcript, so renaming one changes a source id. */
  readonly id: string;
  /**
   * The fact, in one or two sentences, figures included.
   *
   * Written to be quoted rather than summarised: a fact that must be paraphrased to be used is a
   * fact whose caveats can be paraphrased away.
   */
  readonly fact: string;
  /**
   * Who published it, named in the answer's prose. A fact this granular has no derived link, so the
   * organisation and the document title are the provenance a reader gets in the sentence.
   */
  readonly source: string;
  /**
   * The document, at a host `guard.ts` allows an answer to link.
   *
   * Optional only where no linkable host publishes the source (e.g. a forum post). An entry with no
   * `href` still has provenance: `source` names the venue and the day, and `renderEntry` says it is
   * named rather than linked so the model does not invent a link. `reference.test.ts` pins the
   * exact set of ids that may omit it.
   */
  readonly href?: string;
  /**
   * The UTC day the primary source at `href` was actually fetched and read.
   *
   * This is the field that stops the module rotting. Every fact here reads plausibly, so
   * plausibility is no evidence; an entry whose source was not opened cannot honestly carry this
   * date, and `reference.test.ts` refuses an entry without one.
   */
  readonly verifiedOn: string;
  /**
   * Present, and `true`, on an entry whose fact is the state of a process still running.
   *
   * For a settled fact the date is an evidence standard; for "ZIP 234 is a Draft" it is the claim's
   * scope, and without it the sentence is a statement about today that nobody checked today.
   *
   * `renderEntry` prints such an entry behind an `IN FLIGHT — READ N DAYS AGO, ON <day>` prefix
   * computed from the turn's clock, so the model gets the age of the reading, and the topic's
   * preamble gains one sentence requiring the day be given with the status. Both appear only when an
   * in-flight entry exists and vanish on their own when the last one settles.
   *
   * Typed `true` rather than `boolean` so `inFlight: false` is unrepresentable and there is no third
   * state; optional so settled entries need no marker.
   */
  readonly inFlight?: true;
}

export interface ReferenceTopic {
  /** Ours, rendered above the payload — what this bucket covers and where its edges are. */
  readonly note: string;
  readonly entries: readonly ReferenceEntry[];
}

/**
 * The four shielded pools' activation days, as structured data.
 *
 * A tool that needs a date cannot rely on a second lookup happening: asked for the price on each
 * pool's activation day, a model will take the days from memory, and Sapling (02:15 UTC on
 * 2018-10-29) is easily misdated to the 28th, attaching a wrong price to a named event. So the
 * days are exported here and interpolated into `zec_price_history`'s note, where the question is
 * asked.
 *
 * `reference.test.ts` asserts every day here appears verbatim in the entry's `fact`, so this stays
 * a view of the verified prose rather than a second source.
 */
export const POOL_ACTIVATION_DAYS: readonly { readonly pool: string; readonly day: string }[] = [
  { pool: "Sprout", day: "2016-10-28" },
  { pool: "Sapling", day: "2018-10-29" },
  { pool: "Orchard", day: "2022-05-31" },
  { pool: "Ironwood", day: "2026-07-28" },
];

const ECC = "Electric Coin Company";
const ZIPS = "the Zcash Improvement Proposals site";
const SPEC = "the Zcash protocol specification";
const ZCASH_SITE = "the Zcash project site at z.cash";

/**
 * The buckets, each returning its whole entry set. `reference.test.ts` pins the names.
 *
 * Coarse on purpose. One enum value per fact would route exactly, but every enum value sits in the
 * fixed prompt on every turn. A free-text keyword search moves the failure somewhere worse: a
 * near-miss returns a plausible unrelated fact with nothing in the payload to reveal it. A wrong
 * bucket is visible to the model and recoverable with a second tool call.
 *
 * Citations: each entry carries its own `href`, and the tool emits one citation per entry
 * returned. That over-cites slightly, but every link shown is a genuine source of material the
 * model just read; one hand-picked link per bucket could cite a document the answer did not rest
 * on. Under-citing is a correctness failure; over-citing is noise, kept bounded by small buckets.
 */
export const REFERENCE_TOPICS = {
  ceremonies: {
    note: `Zcash's trusted-setup ceremonies, and which pools needed one. A zk-SNARK construction that requires a setup produces "toxic waste" — secret randomness that would let whoever held it forge shielded value undetectably. The ceremonies exist to destroy it. STATE THE PARTICIPANT COUNTS AS FACTS: they are published by the parties who ran the ceremonies and are checkable by anyone. The security property is the part most often stated backwards — these are N-of-N-must-collude schemes, so ONE honest participant is enough for the result to be secure, and a large count raises the cost of universal collusion rather than being required for safety. Never describe a ceremony as having "failed" or the toxic waste as having leaked; no such event is recorded here.`,
    entries: [
      {
        id: "sprout-ceremony",
        fact: "The original Sprout parameters were generated in October 2016 by a six-participant ceremony. The construction is secure as long as at least one of the six destroyed their shard of the toxic waste, so it tolerates five dishonest or compromised participants.",
        source: `${ECC}, "The Design of the Ceremony"`,
        href: "https://electriccoin.co/blog/the-design-of-the-ceremony/",
        verifiedOn: "2026-08-12",
      },
      {
        id: "powers-of-tau",
        fact: "Powers of Tau, the first phase of the Sapling setup, ran between November 2017 and April 2018 and accepted 87 contributions from cryptographers and members of the community.",
        source: `${ECC}, "Completion of the Sapling MPC"`,
        href: "https://electriccoin.co/blog/completion-of-the-sapling-mpc/",
        verifiedOn: "2026-08-12",
      },
      {
        id: "sapling-mpc-phase-two",
        fact: "The second, circuit-specific phase of the Sapling multi-party computation was announced in May 2018 and accepted contributions through early August 2018, taking over 90 contributions. Sapling's setup is therefore two phases, and a single participant count for 'the Sapling ceremony' is ambiguous between them.",
        source: `${ECC}, "Completion of the Sapling MPC"`,
        href: "https://electriccoin.co/blog/completion-of-the-sapling-mpc/",
        verifiedOn: "2026-08-12",
      },
      {
        id: "orchard-needed-no-ceremony",
        fact: "Orchard needed no ceremony at all. It uses Halo 2, which eliminates the trusted setup, so there is no Orchard ceremony and no Orchard toxic waste — and by extension none for Ironwood, which Orchard value migrates into.",
        source: `${ECC}, "Explaining Halo 2"`,
        href: "https://electriccoin.co/blog/explaining-halo-2/",
        verifiedOn: "2026-08-12",
      },
    ],
  },
  cryptography: {
    note: `The proving systems behind each pool, and what changed between them. Keep the pools and their constructions matched: naming the wrong proving system for a pool is the same class of error as naming the wrong pool in a fee sum. Do not paraphrase a construction's security argument in detail — say which system a pool uses and point at the primary source.`,
    entries: [
      {
        id: "sprout-bctv14",
        fact: "Sprout used the BCTV14 zk-SNARK construction. Sapling replaced it with Groth16, which is both smaller and faster, and the Sapling upgrade is what removed BCTV14 from the protocol.",
        source: `${ECC}, "Zcash Counterfeiting Vulnerability Successfully Remediated"`,
        href: "https://electriccoin.co/blog/zcash-counterfeiting-vulnerability-successfully-remediated/",
        verifiedOn: "2026-08-12",
      },
      {
        id: "halo2",
        fact: "Halo 2 is a Rust zk-SNARK implementation that eliminates the need for a trusted setup, achieved through recursive proof composition built on inner-product-argument polynomial commitments. It is what Orchard uses.",
        source: `${ECC}, "Explaining Halo 2"`,
        href: "https://electriccoin.co/blog/explaining-halo-2/",
        verifiedOn: "2026-08-12",
      },
    ],
  },
  history: {
    note: `Dated events in Zcash's history. Every date here is a completed past event, so none of it goes stale — but nothing in this bucket is a LIVE figure: for the tip, the supply, the halving countdown or anything current, use chain_status. The counterfeiting entry is the one to state carefully and completely: it is a fixed, disclosed, never-exploited vulnerability, and reporting the flaw without the remediation would describe a live risk that has not existed since 2018.`,
    entries: [
      {
        id: "genesis",
        fact: "Zcash's mainnet launched on 2016-10-28. This explorer's own index spans that day to the current tip with no missing heights, so the date is checkable against the chain itself rather than only against a document.",
        source: "this explorer's full-chain index, published on /analytics",
        href: "/analytics",
        verifiedOn: "2026-08-12",
      },
      {
        /*
         * Committed absence: naming people is out of scope on this site, so the corpus states that it
         * commits no names, giving the model a sentence to quote instead of an absence to reason about,
         * and points at the primary source.
         */
        id: "founders-not-named",
        fact: "This corpus commits no names of Zcash's founders, creators or team members, and this explorer names no individuals anywhere. For who founded Zcash and built the protocol, the primary source is Electric Coin Company's own published history at electriccoin.co and the Zcash community pages at z.cash; state that, and do not supply any name from memory.",
        source: `${ECC}, its published history (named, not transcribed)`,
        href: "https://electriccoin.co/",
        verifiedOn: "2026-08-27",
      },
      {
        id: "counterfeiting-vulnerability",
        fact: "A flaw in the BCTV14 construction would have let a cheating prover circumvent a consistency check and counterfeit shielded value undetectably. Ariel Gabizon discovered it on 2018-03-01; the Sapling activation on 2018-10-28 removed it; it was publicly disclosed on 2019-02-05. Electric Coin Company found no evidence that anyone else discovered it or that any counterfeiting occurred. Note that counterfeiting is not the same as deanonymisation: no shielded transaction's contents were ever at risk from it.",
        source: `${ECC}, "Zcash Counterfeiting Vulnerability Successfully Remediated"`,
        href: "https://electriccoin.co/blog/zcash-counterfeiting-vulnerability-successfully-remediated/",
        verifiedOn: "2026-08-12",
      },
      {
        /*
         * Committed because the digest and `SHIELDED_UPGRADES` carry activation heights only, and every
         * windowed tool takes days; an unsourced guess at a day is not acceptable even when it is right.
         *
         * Verified against this explorer's own node (`/v1/blocks/<height>`), consensus data a reader can
         * re-fetch. Times are UTC and they matter: Sapling activated at 02:15, so its day is 10-29 where
         * "late October 2018" invites 10-28.
         */
        id: "pool-activation-dates",
        fact: "Activation heights and their UTC times, as this explorer's own node reports them: Sprout came with mainnet genesis, block 1, 2016-10-28 16:19; Sapling at block 419,200, 2018-10-29 02:15; Canopy at 1,046,400, 2020-11-18 12:34; Orchard with NU5 at 1,687,104, 2022-05-31 17:50; NU6 at 2,726,400, 2024-11-23 11:02; NU6.1 at 3,146,400, 2025-11-24 19:56; Ironwood with NU6.3 at 3,428,143, 2026-07-28 14:07. Use the UTC day when pairing one of these with a daily figure — Sapling's is 2018-10-29, not the 28th.",
        source: "this explorer's own node, via /v1/blocks/{height}",
        /*
         * The API reference for the endpoint named in `source`, so a reader can re-fetch any of the seven
         * heights; the block list shows only the newest blocks.
         *
         * Public endpoints only: `apiDocsHrefFor` resolves against the published catalogue, so a
         * `/chain/*` path cannot acquire a link here. The model must never name a private path, and a
         * citation is the same act.
         */
        href: "/api-docs#block-detail",
        verifiedOn: "2026-08-12",
      },
      {
        id: "nu61-exists",
        fact: "NU6.1 is a real mainnet upgrade and is easy to omit after NU6: ZIP 214's revision 2 takes effect at block 3,146,400, which is the NU6.1 activation. The full upgrade order is Overwinter, Sapling, Blossom, Heartwood, Canopy, NU5, NU6, NU6.1, NU6.2, NU6.3 — NU6.2 being the 2026 Orchard fix, the other one easily dropped.",
        source: `${ZIPS}, ZIP 214 for NU6.1's height and ZIP 257 for NU6.2's place in the order`,
        href: "https://zips.z.cash/zip-0214",
        verifiedOn: "2026-10-02",
      },
      {
        /*
         * Two sources: the heights are ZIP 257's own constants, the UTC times are this explorer's node's
         * block timestamps for those heights via /v1/blocks/{height}. In `history` rather than `roadmap`
         * because it is a completed past event; NU6.2 shipped no new pool, so it is not in
         * `pool-activation-dates` either.
         */
        id: "nu62-orchard-fix",
        fact: "NU6.2 is a real mainnet upgrade, deployed to fix a soundness vulnerability in the Orchard Action circuit implementation that could have allowed balance violation and theft of funds. Per ZIP 257, Taylor Hornby reported it on 2026-05-29 during an AI-assisted security audit of Orchard; from mainnet block 3,363,426 (2026-06-02 03:30 UTC by this explorer's node) transactions could carry no Orchard actions at all, and NU6.2 at block 3,364,600 (2026-06-03 04:03 UTC) re-enabled Orchard with a corrected circuit and a new verifying key. ZIP 257 is Final and describes the vulnerability as fixed, not as a live risk. Testnet's NU6.2 height was 4,052,000.",
        source: `${ZIPS}, ZIP 257 "Deployment of the Orchard Temporary Vulnerability Mitigation and NU6.2 Network Upgrade", with block times from this explorer's own node`,
        href: "https://zips.z.cash/zip-0257",
        verifiedOn: "2026-10-02",
      },
      {
        /*
         * The three upgrades `pool-activation-dates` leaves out because none shipped a pool, so a reader
         * asking "when was Blossom" gets a date, not just the order.
         *
         * The height comes from each upgrade's own ZIP, the time from our own node via
         * /v1/blocks/{height}. Neither source alone is enough: a ZIP publishes no timestamp, and the node
         * cannot say which height a ZIP named.
         */
        id: "early-upgrade-heights",
        fact: "The three upgrades that shipped no shielded pool, with heights from their own ZIPs and times from this explorer's node: Overwinter at block 347,500, 2018-06-26 01:37 UTC (ZIP 201, the first network upgrade, also called Network Upgrade Zero); Blossom at 653,600, 2019-12-11 21:50 UTC (ZIP 206); Heartwood at 903,000, 2020-07-16 10:56 UTC (ZIP 250, which shipped ZIP 213 shielded coinbase and ZIP 221 FlyClient).",
        source: `${ZIPS}, ZIPs 201, 206 and 250, with block times from this explorer's own node`,
        href: "https://zips.z.cash/zip-0250",
        verifiedOn: "2026-08-15",
      },
    ],
  },
  addresses: {
    note: `Zcash address types and what an address does or does not reveal. Two rules hold here. This explorer DOES decode a unified address's receiver list and renders it on the address page, and that is public by construction — the receivers ARE the address string. Decoding is not decryption, so describe what an address CONTAINS from a decode and never assert which of its receivers was paid. And an address type says what a payment CAN be, never what it was: a unified address that could receive shielded funds tells you nothing about which receiver a sender actually used, which is not public. Naming the person or company behind an address stays refused here as everywhere.`,
    entries: [
      {
        id: "unified-addresses",
        fact: 'ZIP 316 defines a Unified Address as combining "multiple Receiver (and optionally Metadata) Items" — one address string that can accept payment into several pools. The receiver typecodes it lists are 0x00 transparent P2PKH, 0x01 transparent P2SH, 0x02 Sapling and 0x03 Orchard. The encoding is deliberately opaque: the ZIP states that it "does not allow visual identification of which Receivers or Receiver Types are present", which is why reading a unified address by eye cannot tell you what it contains.',
        source: `${ZIPS}, ZIP 316`,
        href: "https://zips.z.cash/zip-0316",
        verifiedOn: "2026-08-15",
      },
      {
        id: "unified-address-prefixes",
        fact: 'ZIP 316 gives unified addresses different human-readable prefixes by revision: Revision 0 addresses use "u", while Revision 2 uses "zu" for a shielded-only address and "tu" for one that also carries a transparent receiver. This explorer recognises the "u1" form that Revision 0 produces on mainnet. A prefix identifies the encoding revision and whether a transparent receiver is present — it does not reveal the rest of the receiver set.',
        source: `${ZIPS}, ZIP 316`,
        href: "https://zips.z.cash/zip-0316",
        verifiedOn: "2026-08-15",
      },
    ],
  },
  privacy: {
    note: `The two things visitors most often ask about shielded Zcash: the memo field and viewing keys. The viewing-key entry is a FACT about what such a key exposes and is the reason this site refuses to touch one — quoting it is right, and it must never turn into help using, requesting or handling a key. Never tell anyone to paste a viewing key anywhere, including here. Nothing in this bucket describes a specific transaction: a memo's contents are encrypted and this explorer cannot read one.`,
    entries: [
      {
        id: "memo-field",
        fact: "ZIP 302 specifies the shielded memo field as 512 bytes, encrypted, travelling with the note rather than in public. Its first byte says how to read it: a value of 0xF4 or smaller means the memo is a UTF-8 human-readable string padded with zero bytes; 0xF6 followed by all zero bytes means there is no memo; 0xFF means a reader should make no assumption about the contents; and 0xF7 through 0xFE are reserved for future use. A memo is readable by the parties to the note, not by an observer, so this explorer cannot show one.",
        source: `${ZIPS}, ZIP 302`,
        href: "https://zips.z.cash/zip-0302",
        verifiedOn: "2026-08-15",
      },
      {
        id: "viewing-keys",
        fact: 'ZIP 32 states that a Sapling full viewing key carries the trust semantics of a BIP 32 extended public key: "someone with access to a BIP 32 extended public key is able to view all transactions involving that address, which a Sapling full viewing key also enables." That is the whole reason a viewing key must never be pasted into a website — it hands over an entire transaction history, permanently, and cannot be revoked.',
        source: `${ZIPS}, ZIP 32`,
        href: "https://zips.z.cash/zip-0032",
        verifiedOn: "2026-08-15",
      },
    ],
  },
  consensus: {
    note: `How Zcash's proof of work and its upgrade process are defined. ONE figure is deliberately ABSENT and must not be filled in from memory: a computed post-Blossom halving interval, because ZIP 208 defines it as a formula rather than a number, and multiplying it out here would be this site publishing arithmetic as though it were quoted. The Equihash n and k parameters WERE absent for the same reason until 2026-08-21 — the blog post read here states none — and the answer was to read the protocol specification and commit them rather than to keep refusing: the observed refusal declined to give them and then supplied them from memory two sentences later, which is the worse of the two failures. For the CURRENT subsidy split and the next halving height use chain_status 'halving'; nothing in this bucket is live.`,
    entries: [
      {
        id: "equihash",
        fact: 'Zcash\'s proof of work is Equihash. Electric Coin Company announced in April 2016 that "we have started using Equihash as the proof-of-work for block mining in Zcash", describing it as a Proof-of-Work algorithm devised by Alex Biryukov and Dmitry Khovratovich. That post states no n and k parameters; they are quoted separately here from the protocol specification. Equihash yields SOLUTIONS rather than hashes, so a figure quoted in hashes per second is a category error however commonly printed.',
        source: `${ECC}, "Why Equihash" (April 2016)`,
        href: "https://electriccoin.co/blog/why-equihash/",
        verifiedOn: "2026-08-15",
      },
      {
        /*
         * Source: https://zips.z.cash/protocol/protocol.pdf, section 7.7.1 "Equihash", which states
         * verbatim: "The Equihash parameters for Mainnet and Testnet are n = 200; k = 9." The same section
         * defines N = 2^(n/(k+1)+1) and the 21-bit solution encoding.
         *
         * The parameters are committed rather than withheld because a rule that leaves a public question
         * unanswerable gets reasoned around: a model told not to state them will state them from memory
         * and disclaim them in the same answer.
         *
         * Kept separate from the `equihash` entry above: that one carries the authorship and the
         * solutions-not-hashes correction, from a different document. Two entries, two sources.
         */
        id: "equihash-parameters",
        fact: "The Equihash parameters for Zcash Mainnet and Testnet are n = 200 and k = 9. The protocol specification states them in section 7.7.1 and requires n to be a multiple of k + 1 with k >= 3; from those two values the algorithm searches N = 2^(n/(k+1)+1) strings, and a solution is encoded in a block header's solution field as 512 21-bit indices. These are the only two Equihash parameters Zcash uses, and they are the same on both networks.",
        source: `${SPEC}, section 7.7.1`,
        href: "https://zips.z.cash/protocol/protocol.pdf",
        verifiedOn: "2026-08-21",
      },
      {
        id: "blossom-block-spacing",
        fact: "Zcash's 75-second block target was set by ZIP 208 at the Blossom upgrade; before Blossom the target was 150 seconds. The ZIP states PreBlossomPoWTargetSpacing as 150 seconds, PostBlossomPoWTargetSpacing as 75 seconds and PreBlossomHalvingInterval as 840,000 blocks, and defines the post-Blossom halving interval as floor(PreBlossomHalvingInterval x BlossomPoWTargetSpacingRatio) rather than as a literal number. The block subsidy was divided by the same ratio, so halving blocks twice as often left total issuance over time unchanged. Blossom activated on mainnet at block 653,600.",
        source: `${ZIPS}, ZIP 208 (with the activation height from ZIP 206)`,
        href: "https://zips.z.cash/zip-0208",
        verifiedOn: "2026-08-15",
      },
      {
        id: "network-upgrade-mechanism",
        fact: 'ZIP 200 defines a network upgrade as "an intentional consensus rule change undertaken by the community in order to improve the network." Activation is by BLOCK HEIGHT, not by vote or by miner signalling: each upgrade carries a CONSENSUS_BRANCH_ID and an ACTIVATION_HEIGHT, and every consensus rule that depends on the upgrade is gated on height so nodes enforce the right rules for each epoch. The ZIP recommends setting the activation height around three months after the first supporting software release, leaving time for the previous version to reach its end-of-service halt and for operators to upgrade.',
        source: `${ZIPS}, ZIP 200`,
        href: "https://zips.z.cash/zip-0200",
        verifiedOn: "2026-08-15",
      },
    ],
  },
  economics: {
    note: `How Zcash's block subsidy is split, as defined by consensus rather than by policy. These are ZIP 214 funding streams: fractions of the block subsidy fixed in the consensus rules over stated block ranges, not discretionary spending. Quote a range with its percentages — a percentage without the block range it applies to is a claim about the wrong era, and there are four. THE MINER'S SHARE IS A TERM IN THE SAME SPLIT: every entry here states it, because "what percentage goes to funding streams" and "what does the miner get" are one question asked from two ends, and answering only the half that was worded is how a reader is left to subtract. For the CURRENT era use chain_status 'halving', which reads the split live from the node with every share already computed and each stream's recipient named; these entries are the legislated history, and the ranges are what say which one applies.`,
    entries: [
      {
        id: "dev-fund-founders-reward",
        fact: "Before Canopy there were no funding streams: the block subsidy was split between a miner subsidy and the Founders' Reward. The Zcash protocol specification fixes the constant FoundersFraction at 1/5, so the Founders' Reward was 20% of the block subsidy and the miner received the remaining 80%. It was paid until the first halving, which is where Canopy activated — ZIP 207 records that Canopy was planned to activate exactly when the Founders' Reward expired, at block 1,046,400 — and it was never paid at the genesis block.",
        source: "the Zcash protocol specification, sections 5.3 and 7.8",
        href: "https://zips.z.cash/protocol/protocol.pdf",
        verifiedOn: "2026-08-14",
      },
      {
        id: "dev-fund-canopy",
        fact: "ZIP 214 revision 0, active from the Canopy activation at block 1,046,400 to block 2,726,400, directed 20% of the block subsidy in three streams: 7% to the Bootstrap Project (managed by Electric Coin Company), 5% to the Zcash Foundation, and 8% to Major Grants through the Zcash Foundation. The remaining 80% was the miner's.",
        source: `${ZIPS}, ZIP 214`,
        href: "https://zips.z.cash/zip-0214",
        verifiedOn: "2026-08-12",
      },
      {
        id: "dev-fund-nu6",
        fact: "ZIP 214 revision 1, from block 2,726,400 to 3,146,400 (NU6), directed 8% of the block subsidy to the Financial Privacy Foundation for Zcash Community Grants and 12% to a deferred pool, leaving 80% to the miner. Revision 2, from block 3,146,400 to 4,406,400 (NU6.1), keeps that same 8% / 12% / 80% split. The deferred 12% is the lockbox: mined but not circulating, and no transaction can spend from it.",
        source: `${ZIPS}, ZIP 214`,
        href: "https://zips.z.cash/zip-0214",
        verifiedOn: "2026-08-12",
      },
      {
        id: "dev-fund-expiry",
        fact: "ZIP 214 revision 2's funding streams end at block 4,406,400, which is also the next halving height. A subsidy read for a height at or past that boundary therefore shows no funding stream and no lockbox stream, and that means the streams as currently legislated run out there — NOT that miners keep the whole subsidy permanently. Whatever follows would be set by a future ZIP; none is committed here, and an accepted ZIP would not be a shipped one.",
        source: `${ZIPS}, ZIP 214`,
        href: "https://zips.z.cash/zip-0214",
        verifiedOn: "2026-08-14",
      },
    ],
  },
  governance: {
    note: `How Zcash changes, and who the named parties are. Describe the PROCESS and the roles; this bucket says nothing about any individual, and naming people is out of scope here as it is everywhere else on this site. A ZIP's status is not a prediction — an accepted ZIP is not a shipped feature, and never state that an upgrade will activate on a date.`,
    entries: [
      {
        id: "zip-process",
        fact: "A Zcash Improvement Proposal is a design document providing information to the Zcash community or describing a new feature for Zcash, its processes or its environment. ZIPs carry one of eight types (Consensus, Standards, Process, Consensus Process, Informational, Network, RPC, Wallet, Ecosystem) and one of nine statuses (Reserved, Draft, Withdrawn, Active, Proposed, Rejected, Implemented, Final, Obsolete). A draft is discussed on the community forum, submitted as a pull request, reviewed by the ZIP Editors, and given a number when merged. There are always at least two ZIP Editors, at least one of them from the Zcash Foundation.",
        source: `${ZIPS}, ZIP 0`,
        href: "https://zips.z.cash/zip-0000",
        verifiedOn: "2026-08-12",
      },
      {
        id: "funded-organisations",
        fact: "Three organisations appear by name in the consensus-level funding streams: Electric Coin Company, which manages the Bootstrap Project stream; the Zcash Foundation, which receives its own stream and administers Major Grants; and the Financial Privacy Foundation, which receives the Zcash Community Grants stream from NU6 onward. This is who consensus pays, not a statement about who controls the protocol — protocol changes go through the ZIP process.",
        source: `${ZIPS}, ZIP 214`,
        href: "https://zips.z.cash/zip-0214",
        verifiedOn: "2026-08-12",
      },
    ],
  },
  /*
   * What is proposed, as against what has shipped.
   *
   * We do not index a roadmap, but the ZIPs site and the Zcash project site publish it, so the agent
   * should be able to say what is proposed rather than refuse.
   *
   * One bucket, not two, because a topic renders whole: NU7's unset mainnet height, the ZIPs
   * planned for it and the vote on its scope are one subject, and splitting them would let a turn
   * fetch one half without the other. Not folded into `economics` (legislated history, ranges in
   * force) or `governance` (names no individual, while the Tachyon entry names its lead).
   *
   * Most entries are `inFlight` (see that field). The exceptions are settled: a concluded vote's
   * tally does not move, and the vote's snapshot block is a mined block's timestamp, cited to our
   * own node.
   */
  roadmap: {
    note: `What Zcash is PROPOSING, as against what it has shipped: the NU7 upgrade, the coinholder vote on its scope, Project Tachyon, and the Network Sustainability Mechanism proposals. EVERYTHING MARKED IN FLIGHT CAN HAVE CHANGED SINCE IT WAS READ, which is the one thing no other bucket has to say — a ceremony's participant count is the same today as it was in 2016, while a ZIP's status is a fact about a process still running. So each in-flight entry states the day it was read inside its own sentence, and the payload says how long ago that was: GIVE BOTH. "ZIP 259 is a Draft" is a claim about today that nobody here has checked today; "as read on 2026-10-02 ZIP 259 was a Draft" is what was actually read. For a ZIP's CURRENT status, call zip_index with every ZIP number the question involves in ONE call — it is re-read every six hours, and where it disagrees with a status here, it is newer. THREE THINGS ARE NEVER SAID FROM THIS BUCKET. Never give a MAINNET activation height or date for NU7 or anything proposed for it: as of the reading below none has been set, a date invented here is worse than one invented anywhere else on this site because a reader can act on it, and "to be set on OCT 20" is the day a height is to be CHOSEN, never the day of activation. A TESTNET height that a deployment ZIP states may be given as that Draft states it, with the day it was read. Never say a proposal will happen, will be included or will pass: a Draft deployment ZIP is not a final one, a Proposed ZIP is not an Active one, and a poll result is not consensus. And never let a proposal describe the chain as it is — the block subsidy, the halving schedule and the funding streams in force are chain_status 'halving' and zcash_reference 'economics', and nothing in NU7 changes them before it activates. ZIP 200 activation is by block height: a coinholder vote decides what gets proposed, not what consensus does.`,
    entries: [
      {
        /*
         * Source is ZIP 259, the deployment ZIP; the z.cash upgrade page answers automated reads with a
         * captcha and could not be re-read.
         *
         * "has not yet been set" is deliberately kept for mainnet: the falsifier test in
         * reference.test.ts requires it while the committed upgrade order lacks NU7, and the day a
         * mainnet height is assigned this sentence must change.
         *
         * The testnet height is phrased as what the Draft states rather than as an activation: the
         * in-flight grammar test forbids "activates at".
         */
        id: "nu7-not-yet-scheduled",
        fact: 'As read on 2026-10-02, ZIP 259 "Deployment of the NU7 Network Upgrade" (status Draft, created 2026-09-15) defines NU7 and states its constants: ACTIVATION_HEIGHT (NU7) on Testnet is 4,465,026, and on Mainnet "TBD (To be set on OCT 20)", with "Assign the Mainnet NU7 activation height" listed among its open issues. So as of that reading the Mainnet activation height for NU7 has not yet been set, and there is no Mainnet NU7 date, height or countdown to give; "OCT 20" is when a height is to be chosen, not when NU7 would activate. Per that Draft, NU7 reduces the block target spacing from 75 seconds to 25 seconds with per-pool and global shielded action limits (ZIP 218), also deploys ZIPs 235, 237 and 2008 plus ZIP 207 revision 2 and ZIP 214 revision 3, and makes version 4 transactions invalid (ZIP 2003) — which is why, in its words, "funds remaining in the Sprout pool become unspendable". It introduces no new transaction format and, it states, does not deploy ZIP 233 or ZIP 234. NU7 is not in the upgrade order this explorer\'s node enforces.',
        source: `${ZIPS}, ZIP 259 "Deployment of the NU7 Network Upgrade"`,
        href: "https://zips.z.cash/zip-0259",
        verifiedOn: "2026-10-02",
        inFlight: true,
      },
      {
        /*
         * Committed from Zebra's own GitHub release notes, the primary document, which carry the same
         * height ZIP 259 does: two independent documents agreeing.
         *
         * No `href`: github.com/ZcashFoundation is not a host `guard.ts` lets an answer link (its
         * allowlist admits github.com/zcash only), and widening it for one citation would admit every
         * repository under that organisation.
         *
         * "expected around October 6th" is quoted as Zebra's own expectation: a testnet height is fixed,
         * the day it is reached is a forecast of block times.
         */
        id: "nu7-zebra-testnet-release",
        fact: 'As read on 2026-10-02, the Zcash Foundation published Zebra v7.0.0-rc.0 that day, a release candidate whose notes say it "supports the NU7 network upgrade on Testnet", at height 4,465,026, which the notes expected to be reached "around October 6th", and that "Mainnet node operators are not required to upgrade". It is a release candidate for Testnet, not a Mainnet release, and it sets no Mainnet height.',
        source:
          "the Zcash Foundation's release notes for Zebra v7.0.0-rc.0 on GitHub, published 2026-10-02",
        verifiedOn: "2026-10-02",
        inFlight: true,
      },
      {
        /*
         * The ZIPs repository's README lists the ZIPs "planned for deployment" and defers to ZIP 259 for
         * what is included. ZIPs dropped from an earlier candidate list are stated rather than silently
         * removed, because a reader who remembers the old list will ask. Statuses are as each ZIP's own
         * header read on the day.
         */
        id: "nu7-candidate-zips",
        fact: 'As read on 2026-10-02, the ZIPs site\'s "NU7 ZIPs" section says "The following ZIPs are planned for deployment in NU7:" and lists ZIP 218 25-second Block Target Spacing, ZIP 235 Remove 60% of Transaction Fees From Circulation, ZIP 237 Network Sustainability Mechanism: Halving-Preserving Issuance, ZIP 2003 Disallow version 4 transactions, and ZIP 2008 Update to FS_FPF_ZCG_H3 address list — every one of them Draft at that reading — adds that ZIP 317 may be updated, and says ZIP 259 "defines which ZIPs are included in NU7". The longer candidate list read on 2026-08-27 is gone: ZIP 230 (a version 6 transaction format) and ZIP 254 (an earlier NU7 deployment document) are Withdrawn; ZIPs 231, 233, 234 and 2002 are no longer listed for NU7, and ZIP 259 says NU7 does not deploy 233 or 234. "Planned" in a Draft is not "included": the list that counts is the one on the ZIPs site.',
        source: `${ZIPS}, the "NU7 ZIPs" section of the index and each listed ZIP's own header`,
        href: "https://zips.z.cash/",
        verifiedOn: "2026-10-02",
        inFlight: true,
      },
      {
        id: "nsm-proposals",
        fact: 'Five proposals concern how Zcash issues ZEC and removes it from circulation, and as read on 2026-10-02 none is in force. ZIP 233 "Network Sustainability Mechanism: Removing Funds From Circulation", ZIP 234 "Network Sustainability Mechanism: Issuance Smoothing", ZIP 235 "Remove 60% of Transaction Fees From Circulation" and ZIP 237 "Network Sustainability Mechanism: Halving-Preserving Issuance" are all Draft; ZIP 1016 "Community and Coinholder Funding Model" is Proposed. The Draft NU7 deployment ZIP 259 lists 235 and 237 for NU7 and says it does not deploy 233 or 234, so issuance smoothing is not part of NU7 as drafted — halvings are preserved, matching the coinholder poll. Draft and Proposed are two of the nine statuses ZIP 0 defines, and neither means implemented, active or final: none of these has changed the subsidy, the halving schedule or the funding streams in force today.',
        source: `${ZIPS}, the headers of ZIPs 233, 234, 235, 237 and 1016, and ZIP 259`,
        href: "https://zips.z.cash/",
        verifiedOn: "2026-10-02",
        inFlight: true,
      },
      {
        /*
         * No `href`: the announcement is a Zcash Community Forum post, and `guard.ts` deliberately does
         * not let an answer link user-generated content at a host this project does not control; widening
         * the allowlist would make every future forum URL linkable, including one arriving in a payload.
         * The venue and posting date are named in prose instead. The z.cash NU7 page is not used as a
         * substitute because it does not mention the vote: a citation promises the document says the
         * thing.
         *
         * Deliberately absent: a duration (sources disagree, so the two dates are committed and the span
         * is not); a block-target figure from this source (the announcement states none; ZIP 218's is
         * cited above); ZIP numbers mapped onto ballot questions or percentages on the tally (our
         * inference and our arithmetic, not the organiser's); and any author handle.
         */
        id: "nu7-coinholder-vote",
        fact: "A coinholder vote on the scope of NU7 was announced on the Zcash Community Forum on 2026-08-05, ran from 2026-08-25 to 2026-09-14 19:00 UTC, and HAS CONCLUDED; the organiser posted the results in the same forum thread on 2026-09-14, read there on 2026-10-02. No page an answer may link publishes it, so it is named rather than linked. Eligibility was spendable shielded funds in Ironwood at the snapshot, mainnet block 3,459,350, so transparent, Sprout, Sapling or Orchard ZEC counted only if migrated first; the result was to stand only if at least 1,000,000 ZEC took part in at least one question, and the organiser reported participation well over that threshold. Votes were encrypted to at least ten validators, only the final tally being recoverable by at least two thirds of them. The published totals, in ZEC: issuance smoothing — preserve halvings 2,375,932.375, smooth the issuance curve 22,384.875, leave smoothing out of NU7 4,147.625, abstain 1,072.125; when NSM reissuance begins — February 2031 2,319,643.75, as soon as possible 70,239.625, February 2027 6,283, abstain 4,985.625; Sprout deprecation — immediately at NU7 activation 2,333,854.625, one year after the poll 13,787, set no date to disable version 4 transactions 49,820.875, abstain 1,683.75; faster block times — yes 2,397,669.375, no 141.625, abstain 1,652.25; scope — ship as soon as possible, removing any feature not implemented by the September 30 deadline, 2,382,601.5, delay until every approved feature is complete 12,707.5, do not support this NU7 plan 4, abstain 4,161.375. These are the published totals and no percentage is given here. A poll result is not consensus: what NU7 contains is what its deployment ZIP specifies and what activates.",
        source:
          "the NU7 coinholder vote thread on the Zcash Community Forum: the announcement posted 2026-08-05 and the organiser's results post of 2026-09-14",
        verifiedOn: "2026-10-02",
      },
      {
        id: "nu7-vote-snapshot-height",
        fact: "The NU7 coinholder vote’s eligibility snapshot is mainnet block 3,459,350, which this explorer’s own node reports was mined 2026-08-24 19:18 UTC. The announcement gives the height and the node gives the time, and the block is in this explorer’s index for a reader to re-fetch, so this is the one part of the vote that can be checked against the chain rather than against a document. A snapshot block’s timestamp is settled consensus and does not change, whatever the vote decided.",
        source:
          "the vote announcement's snapshot height, with the block time from this explorer's own node via /v1/blocks/{height}",
        href: "/api-docs#block-detail",
        verifiedOn: "2026-08-27",
      },
      {
        id: "project-tachyon",
        fact: 'Project Tachyon is a proposed upgrade rather than a scheduled one: as read on 2026-08-27 it has no ZIP number, no activation height and no date. The Zcash project site describes it as "a new shielded pool that leverages proof-carrying data for high-bandwidth transaction aggregation and aggressive state pruning to cap validator state growth", and names Zcash cofounder Sean Bowe as its lead. Nothing about it is running on mainnet and nothing about it is consensus.',
        source: `${ZCASH_SITE}, "Project Tachyon"`,
        href: "https://z.cash/ecosystem/project-tachyon/",
        verifiedOn: "2026-08-27",
        inFlight: true,
      },
      {
        /*
         * Tachyon's own site, kept separate from the entry above because its source is a different
         * document. Every quoted claim is on tachyon.z.cash, which is why that host is on `guard.ts`'s
         * allowlist.
         *
         * Only fragments read verbatim on the page are quoted: a quotation is a claim about what a
         * document says, and is never assembled from search snippets.
         */
        id: "tachyon-stated-goals",
        fact: 'Project Tachyon’s own site, read on 2026-08-27, describes it as "a proposed Zcash upgrade actively developed by community members" and states that it "shrinks transactions by two orders of magnitude", "removes runaway state growth for validators", yields "full post-quantum privacy" as a side-effect, and that "All network upgrades require community approval before activation". Every one of those is a stated goal of a proposal rather than a measurement of anything deployed: two orders of magnitude is what Tachyon says it aims at, and the page gives no throughput figure and no date. Never present one of them as a property Zcash has today.',
        source: "the Project Tachyon site at tachyon.z.cash",
        href: "https://tachyon.z.cash/",
        verifiedOn: "2026-08-27",
        inFlight: true,
      },
    ],
  },
} as const satisfies Record<string, ReferenceTopic>;

export type ReferenceTopicName = keyof typeof REFERENCE_TOPICS;

export const REFERENCE_TOPIC_NAMES = Object.keys(REFERENCE_TOPICS) as ReferenceTopicName[];

/** The citation transcript entry for one fact. Resolved back to a link by `sourceLinkFor`. */
export const referenceEndpoint = (topic: ReferenceTopicName, id: string): string =>
  `reference:${topic}#${id}`;

const REFERENCE_ENDPOINT_RE = /^reference:([a-z]+)#([a-z0-9-]+)$/;

/**
 * The primary source behind one committed fact, or null if the transcript entry names none.
 *
 * A relative href (the genesis entry cites our own /analytics) is returned as-is, which is what
 * the rest of the citation machinery already expects and what `guard.ts` already allows.
 */
export function referenceSource(endpoint: string): { label: string; href: string } | null {
  const m = REFERENCE_ENDPOINT_RE.exec(endpoint);
  if (m === null) return null;
  const topic = REFERENCE_TOPICS[m[1] as ReferenceTopicName] as ReferenceTopic | undefined;
  if (topic === undefined) return null;
  const entry = topic.entries.find((e) => e.id === m[2]);
  if (entry === undefined) return null;
  /*
   * An entry with no linkable document yields no citation; `sourceLinkFor` and `dedupeSources`
   * treat null as "no source row". The provenance is not lost: `renderEntry` states it in the
   * payload and the prompt requires it be named in the sentence.
   */
  if (entry.href === undefined) return null;
  return { label: entry.source, href: entry.href };
}

/**
 * Whole UTC days from the day a source was read to `now`, or null if that is not a usable number.
 *
 * A future `verifiedOn` is a typo, so a negative result yields null rather than "READ -142 DAYS
 * AGO", which would read like a measurement. Null renders as "READ ON AN UNKNOWN DAY", loud
 * enough that somebody fixes the entry.
 */
function daysSince(verifiedOn: string, now: number): number | null {
  const read = Date.parse(`${verifiedOn}T00:00:00Z`);
  if (Number.isNaN(read)) return null;
  const days = Math.floor((now - read) / DAY_MS);
  return days < 0 ? null : days;
}

/** One entry as the model reads it, with its age if the process behind it is still running. */
function renderEntry(e: ReferenceEntry, now: number): string {
  const provenance =
    e.href === undefined
      ? `${e.source} — named, not linked: no page an answer may link publishes this`
      : e.source;
  const trailer = `\n  source: ${provenance} (read ${e.verifiedOn})`;
  if (e.inFlight !== true) return `- ${e.fact}${trailer}`;
  const days = daysSince(e.verifiedOn, now);
  const age =
    days === null
      ? "READ ON AN UNKNOWN DAY"
      : days === 0
        ? `READ TODAY, ${e.verifiedOn}`
        : `READ ${days} DAY${days === 1 ? "" : "S"} AGO, ON ${e.verifiedOn}`;
  /*
   * The prefix carries the age and nothing else; the instruction lives once in the topic's
   * preamble. The age is per entry because entries are re-read on different days; the rule is not.
   */
  return `- IN FLIGHT — ${age}.\n  ${e.fact}${trailer}`;
}

/**
 * One bucket as the model reads it.
 *
 * Deliberately no `<data>` envelope. The envelope says "what follows was retrieved and anyone may
 * have written it"; wrapping our own committed constants in it would teach the model to distrust
 * the one payload nobody can tamper with. It is a `<reference>` block instead, stated to be ours,
 * with the topic's note first.
 *
 * `now` is a parameter so tests can pin the age this prints, which is the freshness mechanism for
 * an in-flight entry. Defaulted, so `dispatch` passes nothing.
 */
export function renderReferenceTopic(
  name: ReferenceTopicName,
  now: number = Date.now(),
): {
  content: string;
  endpoints: string[];
} {
  const topic: ReferenceTopic = REFERENCE_TOPICS[name];
  const body = topic.entries.map((e) => renderEntry(e, now)).join("\n");
  /*
   * Conditional by design: a topic of settled facts must not be told its facts might have moved, or
   * the model learns to hedge the figures this module exists to state plainly. Keyed off the entries
   * themselves, so withdrawing the last `inFlight` removes the warning with no edit here.
   */
  const inFlightRule = topic.entries.some((e) => e.inFlight === true)
    ? `An entry marked IN FLIGHT is the state of a process still running: it was true when it was read and may not be now. State such a status WITH the day it was read, never as settled, and point a reader at the primary source for anything since. Give no Mainnet activation height and no date for anything whose Mainnet height has not been set.\n`
    : "";
  const content =
    `<note source="reference: ${name}">\n${topic.note}\n</note>\n` +
    `<reference topic="${name}">\n` +
    `These facts are committed in this explorer's own source, each transcribed from the primary source named beside it. They are NOT measurements from this explorer's index and NOTHING here was read from the Zcash node — say where a figure comes from. State these figures plainly; they are published and checkable. For anything this list does not cover, explain what you can qualitatively and give NO figure, date or name that is not written here.\n` +
    inFlightRule +
    `${body}\n</reference>`;
  return {
    content,
    endpoints: topic.entries.map((e) => referenceEndpoint(name, e.id)),
  };
}
