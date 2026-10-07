import type { ApiGroup } from "../types";

export const NETWORK_GROUP: ApiGroup = {
  id: "network",
  label: "Network",
  endpoints: [
    {
      id: "fees",
      method: "GET",
      path: "/v1/network/fees",
      title: "ZIP-317 conventional fees",
      description:
        "The protocol's own fee convention — 5,000 zatoshis per logical action with a two-action floor. This is consensus convention, not a mempool estimate, so serving it asserts no guess. The worked migration example is a real captured mainnet transaction.",
      params: [],
      exampleResponse: `{
  "standard": "ZIP-317 conventional fee",
  "marginalFeeZat": 5000,
  "graceActions": 2,
  "formula": "conventionalFeeZat = marginalFeeZat * max(graceActions, logicalActions)",
  "logicalActions": "ceil(transparent input bytes / 150) or ceil(transparent output bytes / 34), whichever is larger, + 2 per Sprout joinsplit + max(Sapling spends, Sapling outputs) + Orchard actions + Ironwood actions",
  "examples": [
    { "description": "typical fully shielded transaction (2 actions)", "logicalActions": 2, "conventionalFeeZat": 10000 },
    { "description": "observed Orchard-to-Ironwood turnstile migration, mainnet block 3,428,150 (4 Orchard + 2 Ironwood actions)", "logicalActions": 6, "conventionalFeeZat": 30000 }
  ],
  "notes": ["…"],
  "asOf": 1753795200
}`,
    },
    {
      id: "prices",
      method: "GET",
      path: "/v1/prices/daily",
      title: "Daily ZEC/USD closes since launch",
      description:
        "Every day from 2016-10-29 to yesterday, with **no gaps**. Each row names the aggregator it came from, because there is no canonical daily ZEC price: two reputable free sources disagree by a median 2.2% on the same day. Publishing a number without saying whose it is would be an unattributed claim about a market price.",
      params: [
        {
          name: "from",
          kind: "query",
          type: "YYYY-MM-DD",
          required: false,
          description: "First day, inclusive.",
          example: "2026-07-01",
        },
        {
          name: "to",
          kind: "query",
          type: "YYYY-MM-DD",
          required: false,
          description: "Last day, inclusive.",
        },
        {
          name: "currency",
          kind: "query",
          type: "usd | eur | btc | …",
          required: false,
          description:
            "Default usd. Any other adds `close` in that currency to each row — the USD close times that day's reference rate, with `rateDay` naming the day the rate was published — and gives the all-time pair in it. An unknown currency is a 400 listing the ones held.",
        },
      ],
      exampleResponse: `{
  "items": [
    { "day": "2026-07-01", "usd": 416.63, "source": "yahoo" },
    { "day": "2026-07-02", "usd": 434.2, "source": "yahoo" }
  ],
  "firstDay": "2026-07-01",
  "lastDay": "2026-07-02",
  "availableFrom": "2016-10-29",
  "availableTo": "2026-08-11",
  "sources": ["yahoo"],
  "maxRows": 1000,
  "truncated": false,
  "allTimeHigh": { "day": "2016-10-29", "usd": 2239.29, "source": "coincodex" },
  "allTimeLow": { "day": "2019-01-02", "usd": 24.5, "source": "yahoo" },
  "currency": "usd",
  "asOf": 1753795200
}`,
      notes: [
        "**`firstDay`/`lastDay` describe the page you were handed; `availableFrom`/`availableTo` describe the whole series.** They differ whenever the answer is capped: with no range given you get the 1,000 newest rows, so `firstDay` sits years after `availableFrom`. Read the `available*` pair to learn what exists, then page to it with `from`/`to` — nothing is unreachable. Treating `firstDay` as the start of the history is the mistake this pair exists to prevent, and `truncated` alone cannot prevent it, because a boolean says that there is more and not how much.",
        "`yahoo` is the ZEC-USD daily close and covers 2017-11-09 onward; `coincodex` fills 2016-10-29 to 2017-11-08, the launch year no free source covers with real closes. The split is visible in every row rather than hidden behind one label — and the two agree within 6% where they meet.",
        "Verified against Kraken's real traded daily closes over the 721 days that source reaches: median difference 0.12%, correctly aligned to the close of the named day. The 376 `coincodex` days before 2017-11-09 have no independent free source to check against, so treat them as the best available rather than as confirmed.",
        "Launch-era prices are genuinely extreme — 2016-10-29 closed near $2,239 on a supply of a few thousand ZEC. That is the chain's real history, not a data error, and it is stored unsmoothed.",
      ],
      toolNotes: [
        "`firstDay`/`lastDay` describe the page; `availableFrom`/`availableTo` describe the whole series. Without `from`/`to` you get the 1,000 newest rows: reach older days with `from`/`to`.",
        "Each row names its source: `yahoo` from 2017-11-09, `coincodex` before. Launch-era prices are real, not errors (2016-10-29 closed near $2,239).",
      ],
    },
    {
      id: "halving",
      method: "GET",
      path: "/v1/network/halving",
      title: "Next halving and the subsidy split",
      description:
        "Blocks and estimated time to the next halving, and the block subsidy now and after it: split between the miner, the funding streams and the lockbox, each share with both its terms, and every stream named with the ZIP that defines it. The subsidies come from the node's own `getblocksubsidy`.",
      params: [],
      exampleResponse: `{
  "height": 3447977,
  "halvingHeight": 4406400,
  "blocksRemaining": 958423,
  "estimatedSecondsRemaining": 71881725,
  "estimatedAt": "2028-11-22T04:28:45.000Z",
  "currentSubsidy": {
    "totalZat": 156250000,
    "minerZat": 125000000,
    "fundingStreamsZat": 12500000,
    "lockboxZat": 18750000,
    "minerShare": { "pct": 80, "numerator": 125000000, "denominator": 156250000 },
    "fundingStreamsShare": { "pct": 8, "numerator": 12500000, "denominator": 156250000 },
    "lockboxShare": { "pct": 12, "numerator": 18750000, "denominator": 156250000 },
    "fundingStreams": [
      {
        "recipient": "Major Grants",
        "specification": "https://zips.z.cash/zip-0214",
        "valueZat": 12500000,
        "address": "t3cFfPt1Bcvgez9ZbMBFWeZsskxTkPzGCow",
        "share": { "pct": 8, "numerator": 12500000, "denominator": 156250000 }
      }
    ],
    "lockboxStreams": [
      {
        "recipient": "Lockbox NU6",
        "specification": "https://zips.z.cash/zip-0214",
        "valueZat": 18750000,
        "address": null,
        "share": { "pct": 12, "numerator": 18750000, "denominator": 156250000 }
      }
    ]
  },
  "nextSubsidy": {
    "totalZat": 78125000,
    "minerZat": 78125000,
    "fundingStreamsZat": 0,
    "lockboxZat": 0,
    "minerShare": { "pct": 100, "numerator": 78125000, "denominator": 78125000 },
    "fundingStreamsShare": { "pct": 0, "numerator": 0, "denominator": 78125000 },
    "lockboxShare": { "pct": 0, "numerator": 0, "denominator": 78125000 },
    "fundingStreams": [],
    "lockboxStreams": []
  },
  "events": [
    {
      "kind": "block-time-change",
      "height": 653600,
      "at": 1576101005,
      "atUtc": "2019-12-11T21:50:05.000Z",
      "before": { "totalZat": 1250000000, "minerZat": 1000000000, "fundingStreamsZat": 250000000, "lockboxZat": 0 },
      "after": { "totalZat": 625000000, "minerZat": 500000000, "fundingStreamsZat": 125000000, "lockboxZat": 0 }
    },
    {
      "kind": "halving",
      "height": 1046400,
      "at": 1605702856,
      "atUtc": "2020-11-18T12:34:16.000Z",
      "before": { "totalZat": 625000000, "minerZat": 500000000, "fundingStreamsZat": 125000000, "lockboxZat": 0 },
      "after": { "totalZat": 312500000, "minerZat": 250000000, "fundingStreamsZat": 62500000, "lockboxZat": 0 }
    },
    {
      "kind": "halving",
      "height": 2726400,
      "at": 1732359779,
      "atUtc": "2024-11-23T11:02:59.000Z",
      "before": { "totalZat": 312500000, "minerZat": 250000000, "fundingStreamsZat": 62500000, "lockboxZat": 0 },
      "after": { "totalZat": 156250000, "minerZat": 125000000, "fundingStreamsZat": 12500000, "lockboxZat": 18750000 }
    },
    {
      "kind": "halving",
      "height": 4406400,
      "at": null,
      "atUtc": null,
      "before": { "totalZat": 156250000, "minerZat": 125000000, "fundingStreamsZat": 12500000, "lockboxZat": 18750000 },
      "after": { "totalZat": 78125000, "minerZat": 78125000, "fundingStreamsZat": 0, "lockboxZat": 0 }
    }
  ],
  "asOf": 1786742424
}`,
      notes: [
        "The halving height is a consensus constant, boundary-verified against the live node: `getblocksubsidy(4406399)` = 1.5625 ZEC, `getblocksubsidy(4406400)` = 0.78125 ZEC.",
        "`estimatedAt` assumes the 75-second post-Blossom block target and is labelled an estimate — real block times wander.",
        "`events` lists every subsidy change so far and the next halving, oldest first, each with the block's own timestamp. Blossom (653,600) is in the list as `block-time-change`: the per-block subsidy halved there but the block interval halved with it, so issuance per day did not move — it was not a halving.",
        "**`nextSubsidy` shows no streams because ZIP 214 revision 2's funding streams end at block 4,406,400 — the same height as the halving.** That means the streams as currently legislated run out there, not that miners keep the whole subsidy permanently; whatever follows would be set by a future ZIP.",
        "`recipient` is the **node's own label** for a stream and can lag the ZIP's current recipient name: at height 3,447,900 the node reports `Major Grants` for the stream ZIP 214 revision 2 directs to the Financial Privacy Foundation for Zcash Community Grants, and `Lockbox NU6` while revision 2 — the NU6.1 revision — is active. The payout address matches ZIP 214's own table. It is passed through rather than corrected, because rewriting it would assert a mapping consensus does not publish; `specification` is the authority.",
        "`address` is null on a lockbox stream: it is paid into a value pool rather than to an address, which is why no transaction can spend it.",
        'The three `*Share` fields exist so no caller has to divide. They were added 2026-08-14 after the four zatoshi figures alone left the question "what share of the block reward goes to funding streams" unanswerable to a consumer forbidden from doing its own arithmetic.',
      ],
      toolNotes: [
        "`estimatedAt` assumes 75-second blocks and is an estimate; the halving height (4,406,400) is exact.",
        "`events` lists every subsidy change so far and the next halving. Blossom (653,600) is a `block-time-change`, not a halving: issuance per day did not change.",
        "`nextSubsidy` shows no funding streams because ZIP 214 revision 2's streams end at the halving height, as currently legislated; a future ZIP may set new ones.",
        "`recipient` is the node's own label for a stream and can lag the ZIP's name for the recipient; `specification` is the authority. Use the `*Share` fields rather than dividing.",
      ],
    },
    {
      id: "mining",
      method: "GET",
      path: "/v1/network/mining",
      title: "Mining terms at the tip",
      description:
        "The tip's difficulty, the network's solution rate (Equihash yields solutions, not hashes), the miner's share of the block subsidy, the height it next changes, and the observed block interval.",
      params: [],
      exampleResponse: `{
  "source": {
    "name": "ShieldedScan",
    "url": "https://shieldedscan.xyz/mining-cost"
  },
  "data": {
    "readAtHeight": 3506042,
    "difficulty": 314629595.32164675,
    "networkSolutionRate": {
      "solPerSecond": 35507129603,
      "basis": "node"
    },
    "minerSubsidy": {
      "zat": 125000000,
      "zec": "1.25000000"
    },
    "subsidyChangesAtHeight": 4406400,
    "observedBlockIntervalSeconds": 75.3312885210799,
    "priceUsd": 1328.17
  },
  "unknowns": {},
  "notes": [
    "networkSolutionRate.basis is node when the node reported it (getnetworksolps over its trailing window) and estimated when derived from difficulty at the observed interval.",
    "minerSubsidy is the miner's share of the block subsidy only; fees are on top and funding streams are not included."
  ],
  "asOf": 1791117398
}`,
      notes: [
        "`networkSolutionRate.basis` is `node` when the node reported it and `estimated` when derived from difficulty.",
        "`minerSubsidy` excludes fees and the funding streams.",
      ],
    },
  ],
};
