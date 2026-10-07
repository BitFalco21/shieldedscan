import type { ApiGroup } from "../types";
import { RANKING_PARAMS, TRANSFER_FILTER_PARAMS } from "../shared-params";

export const CROSSCHAIN_GROUP: ApiGroup = {
  id: "crosschain",
  label: "Cross-chain",
  endpoints: [
    {
      id: "transfers",
      method: "GET",
      path: "/v1/crosschain/transfers",
      title: "ZEC crossing to and from other chains",
      description:
        "Swaps through public swap protocols (Maya, THORChain, NEAR Intents), newest first. Each has two legs, each with the protocol's own USD figure; they differ by the protocol's fee, so there is no single `usdValue`.",
      params: [
        {
          name: "limit",
          kind: "query",
          type: "integer ≤ 100",
          required: false,
          description: "Page size. Default 25.",
        },
        {
          name: "cursor",
          kind: "query",
          type: "cursor",
          required: false,
          description: "Next page: hand back the nextCursor you were given.",
        },
        {
          name: "before",
          kind: "query",
          type: "cursor",
          required: false,
          description:
            "Rows older than this cursor — pass the `nextCursor` from the previous response here. This is the NEXT page.",
        },
        {
          name: "after",
          kind: "query",
          type: "cursor",
          required: false,
          description:
            "Rows newer than this cursor — pass `prevCursor` here. This is the PREVIOUS page.",
        },
        ...TRANSFER_FILTER_PARAMS,
      ],
      exampleResponse: `{
  "items": [
    {
      "id": "near-intents-fBhQxAEG…",
      "protocol": "near-intents",
      "direction": "in",
      "status": "completed",
      "timestamp": 1753738210,
      "zecAmountZat": 390000000,
      "legs": {
        "zcash": { "chain": "ZEC", "asset": "ZEC", "amount": 3.9, "usdAtSwap": 194.11,
                   "txHash": null, "address": "u1a4w9rqrv2knrp…", "addressKind": "unified" },
        "counterpart": { "chain": "ETH", "asset": "ETH", "amount": 0.15, "usdAtSwap": 193.54,
                         "txHash": "0x843de978…", "address": "0x8f21C3a1…" }
      },
      "counterpartIsSynthetic": false,
      "venueRecordKey": "0x9D535aC8be0a9D04F95f338a99f78F26f9f63287",
      "unknowns": { "legs.zcash.txHash": "unmeasured" }
    }
  ],
  "nextCursor": "MTc1MzczODIxMHxuZWFyLTU1MjE",
  "prevCursor": null,
  "coverage": {
    "basis": "floor",
    "scope": "public-swap-protocols",
    "excludes": ["custodial-routes", "aggregators"],
    "venues": [ { "protocol": "maya", "enabled": true, "live": true } ],
    "firstAt": null, "lastAt": null
  }
}`,
    },
    {
      id: "transfers-top",
      method: "GET",
      path: "/v1/crosschain/transfers/top",
      title: "The largest crossings",
      description:
        "The largest transfers under the same filters as the list, ranked by ZEC or by USD at swap. At most 25 rows, no cursor.",
      params: [
        {
          name: "by",
          kind: "query",
          type: "zec | usd",
          required: false,
          description:
            'What "largest" means; default zec. `usd` ranks on the protocols\' swap-time prices and leaves out every transfer none priced, which `basisExcludesUnpricedTransfers` says in the response.',
        },
        {
          name: "limit",
          kind: "query",
          type: "integer ≤ 25",
          required: false,
          description: "Rows. Default 10.",
        },
        ...TRANSFER_FILTER_PARAMS,
      ],
      exampleResponse: `{
  "by": "zec",
  "basisExcludesUnpricedTransfers": false,
  "items": [
    {
      "id": "maya-9f2c41ab…",
      "protocol": "maya",
      "direction": "out",
      "status": "completed",
      "timestamp": 1751020800,
      "zecAmountZat": 4500000000000,
      "legs": {
        "zcash": { "chain": "ZEC", "asset": "ZEC", "amount": 45000, "usdAtSwap": 1795500,
                   "txHash": "a1b2c3d4…", "address": "t1XWk29dEXAMPLE…",
                   "addressKind": "transparent" },
        "counterpart": { "chain": "BTC", "asset": "BTC", "amount": 17.4, "usdAtSwap": 1792300,
                         "txHash": "6f0e…", "address": "bc1qexample…" }
      },
      "counterpartIsSynthetic": false,
      "venueRecordKey": null,
      "unknowns": { "venueRecordKey": "nonexistent" }
    }
  ],
  "coverage": {
    "basis": "floor",
    "scope": "public-swap-protocols",
    "excludes": ["custodial-routes", "aggregators"],
    "venues": [ { "protocol": "maya", "enabled": true, "live": true } ],
    "firstAt": null, "lastAt": null
  }
}`,
    },
    {
      id: "transfer",
      method: "GET",
      path: "/v1/crosschain/transfers/{id}",
      title: "One transfer",
      description: "A single transfer by its venue-derived id, same shape as a list item.",
      params: [
        {
          name: "id",
          kind: "path",
          type: "string",
          required: true,
          description: "e.g. `near-intents-fBhQxAEG…` or `maya-<txid>`.",
          example: "maya-fe8d743bf1403f07e0f6650c80ee6c6a87c21574f87d726738ff928f9f57e58c",
        },
      ],
      exampleResponse: `{
  "id": "maya-B5AF684B…",
  "protocol": "maya",
  "direction": "out",
  "status": "completed",
  "zecAmountZat": 520671671,
  "legs": { "zcash": { "…": "…" }, "counterpart": { "…": "…" } },
  "counterpartIsSynthetic": false,
  "venueRecordKey": null,
  "unknowns": { "venueRecordKey": "nonexistent" }
}`,
    },
    {
      id: "crosschain-aggregate",
      method: "GET",
      path: "/v1/crosschain/aggregate",
      title: "Cross-chain totals over any window",
      description:
        "ZEC crossing to and from other chains through public swap protocols, totalled over any window and optionally grouped by counterpart chain, protocol, day or month. Both directions on every row, never netted, each with the protocols' own swap-time dollar value and how many transfers carried one.",
      params: [
        {
          name: "from",
          kind: "query",
          type: "YYYY-MM-DD",
          required: true,
          description: "First UTC day of the window, inclusive.",
          example: "2026-09-01",
        },
        {
          name: "to",
          kind: "query",
          type: "YYYY-MM-DD",
          required: true,
          description:
            "UTC day the window ends BEFORE — exclusive, so to=2026-10-01 ends on 30 September.",
          example: "2026-10-01",
        },
        {
          name: "groupBy",
          kind: "query",
          type: "none | chain | protocol | day | month",
          required: false,
          description: "Rows beside the totals; `day` covers at most 366 days.",
          example: "chain",
        },
        {
          name: "direction",
          kind: "query",
          type: "in | out",
          required: false,
          description: "`in` is to Zcash, `out` is from it.",
        },
        {
          name: "chain",
          kind: "query",
          type: "comma-separated tickers",
          required: false,
          description: "Counterpart chains, e.g. BTC,ETH.",
        },
        {
          name: "protocol",
          kind: "query",
          type: "near-intents | maya | thorchain",
          required: false,
          description: "One protocol.",
        },
        {
          name: "minZec",
          kind: "query",
          type: "ZEC decimal",
          required: false,
          description: "Transfers of at least this much ZEC.",
        },
        {
          name: "minUsd",
          kind: "query",
          type: "decimal",
          required: false,
          description:
            "Transfers of at least this swap-time dollar value; a transfer with no published value is excluded, not assumed to clear it.",
        },
        ...RANKING_PARAMS,
      ],
      exampleResponse: `{
  "query": {
    "from": "2026-09-01",
    "to": "2026-10-01",
    "groupBy": "chain",
    "direction": null,
    "chain": [],
    "protocol": null,
    "minZec": null,
    "minUsd": null
  },
  "window": {
    "from": "2026-09-01",
    "to": "2026-10-01",
    "toExclusive": true,
    "fromTimestamp": 1788220800,
    "toTimestamp": 1790812800,
    "fromHeight": 3467591,
    "toHeight": 3501995
  },
  "indexed": {
    "height": 3504790,
    "timestamp": 1791023565,
    "time": "2026-10-03T10:32:45Z"
  },
  "coverage": {
    "status": "floor",
    "notes": [
      "Public swap protocols only (NEAR Intents, Maya, THORChain), completed transfers only. Exchange withdrawals and aggregators are not included, so every total is a lower bound."
    ]
  },
  "asOf": 1791023575,
  "source": {
    "name": "ShieldedScan",
    "url": "https://shieldedscan.xyz/cross-chain/flows"
  },
  "data": {
    "groupBy": "chain",
    "totals": {
      "in": {
        "transfers": 24823,
        "amountZat": 10970348765182,
        "amountZec": "109703.48765182",
        "usdAtSwap": "144949690.77",
        "usdPricedTransfers": 24823
      },
      "out": {
        "transfers": 23850,
        "amountZat": 9966372818473,
        "amountZec": "99663.72818473",
        "usdAtSwap": "130082470.23",
        "usdPricedTransfers": 23850
      }
    },
    "groups": [
      {
        "key": "ETH",
        "in": {
          "transfers": 7520,
          "amountZat": 5010140881537,
          "amountZec": "50101.40881537",
          "usdAtSwap": "65684827.14",
          "usdPricedTransfers": 7520
        },
        "out": {
          "transfers": 7191,
          "amountZat": 4668703456687,
          "amountZec": "46687.03456687",
          "usdAtSwap": "60622265.84",
          "usdPricedTransfers": 7191
        }
      },
      {
        "key": "BTC",
        "in": {
          "transfers": 1461,
          "amountZat": 2197247133475,
          "amountZec": "21972.47133475",
          "usdAtSwap": "29169894.27",
          "usdPricedTransfers": 1461
        },
        "out": {
          "transfers": 1587,
          "amountZat": 869713086151,
          "amountZec": "8697.13086151",
          "usdAtSwap": "11915319.25",
          "usdPricedTransfers": 1587
        }
      }
    ]
  },
  "unknowns": {}
}`,
      notes: [
        "`coverage.status` is always `floor`: public swap protocols only, completed transfers only. Exchange withdrawals and aggregators are not included.",
        "For a single transfer or the largest ones, use `/v1/crosschain/transfers` and `/v1/crosschain/transfers/top`.",
      ],
    },
    {
      id: "flows",
      method: "GET",
      path: "/v1/crosschain/flows",
      title: "All-time flows per chain",
      description:
        "ZEC in and out per counterpart chain since observation began, the two directions as separate lists: unrelated transfers, never netted. `usdAtSwap` sums the protocols' own swap-time prices; `usdCoveredTransfers` says how many transfers had one, so a smaller count makes the dollar figure a floor.",
      params: [],
      exampleResponse: `{
  "coverage": { "basis": "floor", "scope": "public-swap-protocols", "…": "…" },
  "in":  { "transfers": 4210, "zecAmountZat": 61250000000000,
           "usdAtSwap": 18420145.77, "usdCoveredTransfers": 3980,
           "flows": [ { "chain": "BTC", "transfers": 1890, "zecAmountZat": 30070000000000,
                        "usdAtSwap": 9041220.14, "usdCoveredTransfers": 1774 } ] },
  "out": { "transfers": 6120, "zecAmountZat": 80530000000000,
           "usdAtSwap": 24216903.02, "usdCoveredTransfers": 5904,
           "flows": [ { "chain": "ETH", "transfers": 2010, "zecAmountZat": 28810000000000,
                        "usdAtSwap": 8663401.55, "usdCoveredTransfers": 1955 } ] },
  "asOf": 1753795200
}`,
    },
    {
      id: "destinations",
      method: "GET",
      path: "/v1/crosschain/destinations",
      title: "Where inbound ZEC lands — the shielded-capable rate",
      description:
        "Of the ZEC arriving from other chains, the share landing on a shielded-capable address. `shieldedCapable`, never `shielded`: which receiver a unified address paid into is not public. Unclassified addresses stay in the denominator.",
      params: [
        {
          name: "direction",
          kind: "query",
          type: "in | out",
          required: false,
          description: "Default `in`.",
          example: "in",
        },
      ],
      exampleResponse: `{
  "direction": "in",
  "coverage": { "basis": "floor", "…": "…" },
  "buckets": [
    { "addressKind": "transparent", "shieldedCapable": false, "transfers": 3080, "zecAmountZat": 44100000000000 },
    { "addressKind": "unified", "shieldedCapable": true, "transfers": 1050, "zecAmountZat": 16350000000000 },
    { "addressKind": null, "shieldedCapable": null, "transfers": 80, "zecAmountZat": 800000000000 }
  ],
  "shieldedCapableShare": { "pct": 25.42, "numerator": 1050, "denominator": 4130 },
  "shareDenominator": "transfers whose venue published a classifiable Zcash-side address",
  "receiverUsedIsNotPublic": true,
  "unknowns": {
    "buckets[2].addressKind": "unmeasured",
    "buckets[2].shieldedCapable": "unmeasured"
  },
  "asOf": 1753795200
}`,
    },
  ],
};
