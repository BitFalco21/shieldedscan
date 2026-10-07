import type { ApiGroup } from "../types";

export const CHAIN_GROUP: ApiGroup = {
  id: "chain",
  label: "Chain",
  endpoints: [
    {
      id: "chain-info",
      method: "GET",
      path: "/v1/chain",
      title: "Chain header facts",
      description:
        "Tip height and hash, circulating supply, and the live stats. The price and 24h figures come from pollers that can be cold — the keys are then present, null, with `unmeasured` reasons beside them.",
      params: [],
      exampleResponse: `{
  "height": 3432911,
  "bestBlockHash": "00000000015f…",
  "lastBlockTimestamp": 1785925125,
  "circulatingSupplyZat": 1631092708439746,
  "priceUsd": 121.34,
  "priceChange24hPct": -1.2,
  "txCount24h": 4441,
  "fullyShieldedPct24h": 6.2,
  "asOf": 1785925130
}`,
    },
    {
      id: "blocks",
      method: "GET",
      path: "/v1/blocks",
      title: "Blocks, newest first",
      description:
        "Keyset over height, or from a point in time with `at`. Rows come from the chain index and state each block's fees; a page the index cannot state exactly yet is read from the node instead, where `totalFeeZat` is null with reason `omitted` (the block detail has it). The miner is named on the coinbase's own evidence: `shielded` means a ZIP-213 coinbase whose payee is not public.",
      params: [
        {
          name: "at",
          kind: "query",
          type: "YYYY-MM-DD | YYYY-MM-DDTHH:MM:SSZ | unix seconds",
          required: false,
          description:
            "Start the page at the newest block stamped at or before this instant, then walk back. A bare day means the end of that UTC day, so the page opens on that day's last block. The answer echoes `at: {time, height}`; `height` is null before genesis. Not combinable with a cursor.",
          example: "2026-09-15",
        },
        {
          name: "limit",
          kind: "query",
          type: "1\u2013100",
          required: false,
          description: "Rows per page; default 25.",
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
          description: "Page older than this cursor (comes back as nextCursor).",
        },
        {
          name: "after",
          kind: "query",
          type: "cursor",
          required: false,
          description: "Page newer than this cursor (comes back as prevCursor).",
        },
      ],
      exampleResponse: `{
  "items": [
    {
      "height": 3484794,
      "hash": "000000000004c30b899e8464f06be21e3321e4902a55650db12e1c73842db1a5",
      "prevHash": "0000000000385ceeaafae1bc7f7c086457e4373742bebc05fbf438fd461819fb",
      "timestamp": 1789516710,
      "sizeBytes": 159775,
      "txCount": 5,
      "difficulty": 210739985.2653873,
      "minerKind": "transparent",
      "minerAddress": "t1XQZdZMnzXBcL8yx2PR27dSNrqctgwLgux",
      "coinbaseTag": "🌸/Mined by Luxor/",
      "contents": {
        "transparent": 3,
        "mixed": 1,
        "shielded": 1,
        "pools": {
          "ironwood": 2,
          "orchard": 0,
          "sapling": 0,
          "sprout": 0
        }
      },
      "totalFeeZat": 521900,
      "blockRewardZat": 138021900,
      "minerRewardZat": 125521900,
      "fundingStreams": [
        {
          "address": "t3cFfPt1Bcvgez9ZbMBFWeZsskxTkPzGCow",
          "valueZat": 12500000
        }
      ]
    }
  ],
  "nextCursor": "MzQ4NDc5NHwzNDg0Nzk0",
  "prevCursor": "MzQ4NDc5NHwzNDg0Nzk0",
  "at": {
    "time": 1789516799,
    "height": 3484794
  },
  "asOf": 1791200703
}`,
    },
    {
      id: "block-detail",
      method: "GET",
      path: "/v1/blocks/{heightOrHash}",
      title: "One block",
      description:
        "By height or hash — the two are distinguishable by shape, so one path serves both. The only block view carrying a real `totalFeeZat`; where an input genuinely cannot be resolved it is null with reason `indeterminate`, never 0.",
      params: [
        {
          name: "heightOrHash",
          kind: "path",
          type: "int | hex64",
          required: true,
          description: "Block height or block hash.",
          example: "3428150",
        },
      ],
      exampleResponse: `{
  "height": 3428150,
  "hash": "0000000000a1…",
  "txCount": 7,
  "minerKind": "transparent",
  "contents": {
    "transparent": 1,
    "mixed": 0,
    "shielded": 6,
    "pools": { "ironwood": 6, "orchard": 6, "sapling": 0, "sprout": 0 }
  },
  "totalFeeZat": 180000,
  "asOf": 1785925130
}`,
    },
    {
      id: "block-transactions",
      method: "GET",
      path: "/v1/blocks/{heightOrHash}/transactions",
      title: "One block's transactions",
      description:
        "A block's transactions, a page at a time, optionally only those that used one shielded pool.",
      params: [
        {
          name: "heightOrHash",
          kind: "path",
          type: "int | hex64",
          required: true,
          description: "Block height or block hash.",
          example: "3428150",
        },
        {
          name: "pool",
          kind: "query",
          type: "ironwood | orchard | sapling | sprout",
          required: false,
          description: "Only the block's transactions that used this shielded pool.",
        },
        {
          name: "limit",
          kind: "query",
          type: "1\u2013100",
          required: false,
          description: "Rows per page; default 25.",
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
          description: "Page older than this cursor (comes back as nextCursor).",
        },
        {
          name: "after",
          kind: "query",
          type: "cursor",
          required: false,
          description: "Page newer than this cursor (comes back as prevCursor).",
        },
      ],
      exampleResponse: `{
  "items": [
    {
      "txid": "25d87ba67830…",
      "blockHeight": 3428150,
      "kind": "shielded",
      "direction": "shielded",
      "pools": ["ironwood", "orchard"],
      "feeZat": 30000
    }
  ],
  "nextCursor": null,
  "prevCursor": null,
  "asOf": 1785925130
}`,
    },
    {
      id: "transactions",
      method: "GET",
      path: "/v1/transactions",
      title: "Transactions, filtered by kind, pool and day",
      description:
        "The whole chain's transactions, newest first, filterable by kind, by the shielded pool a transaction used, and by a window of UTC days; a page of a rare kind or pool is still a full page. `filters` echoes what was applied. No value field: a fully shielded row has no public amount. A null feeZat carries its reason: `nonexistent` on a coinbase, `indeterminate` where an input cannot be resolved.",
      params: [
        {
          name: "kind",
          kind: "query",
          type: "transparent | shielded | mixed | shielding | unshielding | coinbase",
          required: false,
          description:
            "Omit for all kinds. An unknown value is a 400, never silently widened. `shielding` and `unshielding` narrow `mixed` by which way value crossed the shielded boundary, so both are strict subsets of it — and neither covers the ~0.09% of mixed transactions whose pools moved in opposite directions, which are reachable under `mixed` alone.",
          example: "shielded",
        },
        {
          name: "pool",
          kind: "query",
          type: "ironwood | orchard | sapling | sprout",
          required: false,
          description:
            "Only transactions that used this shielded pool — carried a bundle in it, whatever crossed. A pool migration uses both of its pools, so it is in both lists. Not combinable with kind=transparent, which uses no pool.",
          example: "ironwood",
        },
        {
          name: "from",
          kind: "query",
          type: "YYYY-MM-DD",
          required: false,
          description: "First UTC day to include.",
        },
        {
          name: "to",
          kind: "query",
          type: "YYYY-MM-DD",
          required: false,
          description: "Exclusive: the first UTC day NOT included.",
        },
        {
          name: "limit",
          kind: "query",
          type: "1\u2013100",
          required: false,
          description: "Rows per page; default 25.",
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
          description: "Page older than this cursor (comes back as nextCursor).",
        },
        {
          name: "after",
          kind: "query",
          type: "cursor",
          required: false,
          description: "Page newer than this cursor (comes back as prevCursor).",
        },
      ],
      exampleResponse: `{
  "items": [
    {
      "txid": "f16d2a55f3c2…",
      "blockHeight": 3432905,
      "blockHash": "000000000201…",
      "timestamp": 1785924684,
      "sizeBytes": 1841,
      "kind": "shielded",
      "direction": "shielded",
      "pools": ["ironwood", "orchard"],
      "feeZat": 20000
    }
  ],
  "nextCursor": "MTc4NTkyNDY4NHxmMTZk…",
  "prevCursor": null,
  "filters": { "kind": "shielded", "pool": null, "from": null, "to": null },
  "asOf": 1785925130
}`,
    },
    {
      id: "transaction-detail",
      method: "GET",
      path: "/v1/transactions/{txid}",
      title: "One transaction",
      description:
        "The full structure: transparent inputs and outputs (`address: null` where a script names no single address), shielded bundles (`valueBalanceZat` is what the pool gained, negative when value left it), and the fee. `summary` says in one sentence what the transaction did, built only from what the chain states, and what it does not record; `crosschain` lists the public swaps it is the Zcash leg of. `lockTime` can be null on index-served rows: not carried in that view.",
      params: [
        {
          name: "txid",
          kind: "path",
          type: "hex64",
          required: true,
          description: "Transaction id.",
          example: "25d87ba678308c4b88b5b3cfebf4eda388d2e3523f2cf93c03ea2894b0fe8a1e",
        },
        {
          name: "inputsFrom",
          kind: "query",
          type: "integer",
          required: false,
          description:
            "Ordinal offset into transparentInputs. Sides are capped at 1,000 entries; when one is capped the response carries truncated.transparentInputs.resumeWith telling you the exact value to send. An offset is exact here because a confirmed transaction is immutable.",
        },
        {
          name: "outputsFrom",
          kind: "query",
          type: "integer",
          required: false,
          description: "Ordinal offset into transparentOutputs. Same contract as inputsFrom.",
        },
        {
          name: "include",
          kind: "query",
          type: "raw",
          required: false,
          description:
            "Adds the serialised transaction hex. All callers share about 1 MB of hex a second; past that the answer is a 503 with Retry-After.",
        },
      ],
      exampleResponse: `{
  "txid": "25d87ba67830…",
  "blockHeight": 3428150,
  "kind": "shielded",
  "direction": "shielded",
  "pools": ["ironwood", "orchard"],
  "feeZat": 30000,
  "transparentInputs": [],
  "transparentOutputs": [],
  "bundles": {
    "sprout": null,
    "sapling": null,
    "orchard": { "actions": 4, "valueBalanceZat": -300030000 },
    "ironwood": { "actions": 2, "valueBalanceZat": 300000000 }
  },
  "summary": {
    "text": "Migrated 3.00 ZEC from Orchard into Ironwood.",
    "notOnChain": "Who moved it. The amount is the pools’ own published balances, so naming it reveals no one."
  },
  "crosschain": { "total": 0, "transfers": [] },
  "asOf": 1785925130
}`,
      notes: ["`rawHex`, often 9 KB or more, rides only with `include=raw`."],
      // The tool does not offer include=raw (MCP_EXCLUDED_PARAMS), so it carries no note about it.
      toolNotes: [],
    },
    {
      id: "address",
      method: "GET",
      path: "/v1/addresses/{address}",
      title: "One address",
      description:
        "A transparent address answers with exact balances, its `rank` on the transparent rich list and the number of transactions it appears in, and the first and last block it appears in. `balanceZat` and `txCount` (every address, emptied ones too) are current; `rank` is as of `rankAsOfHeight`, the hourly refresh. A shielded or unified address answers 200 with an explanation and NO balance keys: its history is encrypted by the protocol, not hidden by this API. A unified address also lists its `receivers` (Orchard, Sapling, transparent), which are public because they are the address itself; which one a payment used is not.",
      params: [
        {
          name: "address",
          kind: "path",
          type: "t1… | zs… | u1…",
          required: true,
          description: "Any Zcash address.",
          example: "t1a7HnBdsBSvkGZQXD5vPYqoWRvnpG555Jy",
        },
      ],
      exampleResponse: `{
  "kind": "transparent",
  "address": "t1a7HnBdsBSv…",
  "balanceZat": 1240310000,
  "totalReceivedZat": 98421356000,
  "totalSentZat": 97181046000,
  "rank": 4127,
  "txCount": 812,
  "rankAsOfHeight": 3447900,
  "firstSeen": { "height": 1188632, "timestamp": 1607212800 },
  "lastSeen": { "height": 3447611, "timestamp": 1785911912 },
  "asOf": 1785925130
}`,
    },
    {
      id: "address-transactions",
      method: "GET",
      path: "/v1/addresses/{address}/transactions",
      title: "An address's history",
      description:
        "A transparent address's transactions, newest first, a page at a time from the chain index. No total count.",
      params: [
        {
          name: "address",
          kind: "path",
          type: "t1…",
          required: true,
          description:
            "A transparent address. Shielded addresses have no history to list — by design.",
          example: "t1a7HnBdsBSvkGZQXD5vPYqoWRvnpG555Jy",
        },
        {
          name: "limit",
          kind: "query",
          type: "1\u2013100",
          required: false,
          description: "Rows per page; default 25.",
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
          description: "Page older than this cursor (comes back as nextCursor).",
        },
        {
          name: "after",
          kind: "query",
          type: "cursor",
          required: false,
          description: "Page newer than this cursor (comes back as prevCursor).",
        },
      ],
      exampleResponse: `{
  "items": [
    {
      "txid": "658732282e2e…",
      "blockHeight": 3432881,
      "kind": "transparent",
      "direction": null,
      "pools": [],
      "feeZat": 20000
    }
  ],
  "nextCursor": "MzQzMjg4MXw2NTg3…",
  "prevCursor": null,
  "asOf": 1785925130
}`,
    },
    {
      id: "address-activity",
      method: "GET",
      path: "/v1/addresses/{address}/activity",
      title: "One address over a window",
      description:
        "A transparent address's transactions, value received, value sent and net change over any window of UTC days, with the heights the window resolved to and the address's lifetime transaction count.",
      params: [
        {
          name: "address",
          kind: "path",
          type: "t-address",
          required: true,
          description:
            "A transparent address. A shielded one has no public activity and is refused.",
          example: "t1RyCw14wRXrh3mp21uxgr9ynjem7cNUkMH",
        },
        {
          name: "from",
          kind: "query",
          type: "YYYY-MM-DD",
          required: true,
          description: "First UTC day, inclusive.",
          example: "2026-09-01",
        },
        {
          name: "to",
          kind: "query",
          type: "YYYY-MM-DD",
          required: true,
          description: "UTC day the window ends before (exclusive).",
          example: "2026-10-01",
        },
      ],
      exampleResponse: `{
  "query": {
    "address": "t1RyCw14wRXrh3mp21uxgr9ynjem7cNUkMH",
    "from": "2026-09-01",
    "to": "2026-10-01"
  },
  "window": {
    "fromHeight": 3467591,
    "toHeight": 3501995
  },
  "coverage": {
    "status": "complete",
    "notes": []
  },
  "source": {
    "name": "ShieldedScan",
    "url": "https://shieldedscan.xyz/address/t1RyCw14wRXrh3mp21uxgr9ynjem7cNUkMH"
  },
  "basis": "transparent activity only: value paid to the address and spent from it. Shielded value has no address to file under and is never included.",
  "data": {
    "transactions": 1,
    "lifetimeTransactions": 234,
    "received": {
      "zat": 4279862900000,
      "zec": "42798.62900000"
    },
    "sent": {
      "zat": 0,
      "zec": "0.00000000"
    },
    "net": {
      "zat": 4279862900000,
      "zec": "42798.62900000"
    },
    "firstHeight": 3491523,
    "lastHeight": 3491523
  },
  "unknowns": {},
  "asOf": 1791117401
}`,
      notes: [
        "Transparent activity only: a shielded transaction has no address to file under.",
        "The walk is capped at 20,000 index rows; when the cap bites, `coverage` says which heights the figures cover.",
      ],
    },
    {
      id: "address-extremes",
      method: "GET",
      path: "/v1/addresses/{address}/extremes",
      title: "An address's largest receipt and payment",
      description:
        "The single transaction that moved the most value into this address and the one that moved the most out, by the address's own net change, with the whole transaction's public value beside each.",
      params: [
        {
          name: "address",
          kind: "path",
          type: "t-address",
          required: true,
          description: "A transparent address.",
          example: "t1RyCw14wRXrh3mp21uxgr9ynjem7cNUkMH",
        },
      ],
      exampleResponse: `{
  "query": {
    "address": "t1RyCw14wRXrh3mp21uxgr9ynjem7cNUkMH"
  },
  "coverage": {
    "status": "complete",
    "notes": []
  },
  "source": {
    "name": "ShieldedScan",
    "url": "https://shieldedscan.xyz/address/t1RyCw14wRXrh3mp21uxgr9ynjem7cNUkMH"
  },
  "basis": "the address's own net movement per transaction, transparent value only; coinbase payouts included, since a mining reward is a genuine receipt.",
  "data": {
    "lifetimeTransactions": 234,
    "considered": 234,
    "largestReceived": {
      "netChange": {
        "zat": 50756757400000,
        "zec": "507567.57400000"
      },
      "ties": 1,
      "txid": "1d201de0e79e2979532c31eebd7640e48a77908a1c85c2c69d40d89e9cd609bb",
      "height": 3069219,
      "transactionPublicValue": {
        "zat": 50986687769492,
        "zec": "509866.87769492"
      }
    },
    "largestSent": {
      "netChange": {
        "zat": -63980774100000,
        "zec": "-639807.74100000"
      },
      "ties": 1,
      "txid": "d913e08e76ea94896b7ef20e680b806c3e8864adbbc55e900167fefd8389dd10",
      "height": 2889330,
      "transactionPublicValue": {
        "zat": 87294301279739,
        "zec": "872943.01279739"
      }
    }
  },
  "unknowns": {},
  "asOf": 1791117403
}`,
      notes: [
        "Named only when unique: a tie has no single transaction to point at.",
        "For an address with more than 20,000 index rows only the newest are considered, and `coverage` says so.",
      ],
    },
    {
      id: "search",
      method: "GET",
      path: "/v1/search",
      title: "Resolve an identifier",
      description:
        "Heights, block hashes, txids and addresses — the same classifier the site's own search uses, so the two can never disagree about what a txid looks like. Returns identifiers only; fetch the object from its own endpoint. A miss is `resolvesTo: null` with HTTP 200 — an answer, not an error.",
      params: [
        {
          name: "q",
          kind: "query",
          type: "string",
          required: true,
          description: "Height, 64-hex hash, or address.",
          example: "3428150",
        },
      ],
      exampleResponse: `{
  "query": "3428150",
  "resolvesTo": { "type": "block", "height": 3428150, "hash": "0000000000a1…" },
  "asOf": 1785925130
}`,
    },
  ],
};
