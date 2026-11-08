import type { ApiGroup } from "../types";

/**
 * The `/miners` page on the public API: who mined by reviewed mining pool, one pool, each pool's
 * share over time, and the NSM. Examples are the fixture chain's answers, pinned whole.
 */
export const MINING_GROUP: ApiGroup = {
  id: "mining",
  label: "Mining pools",
  endpoints: [
    {
      id: "mining-pools",
      method: "GET",
      path: "/v1/analytics/mining-pools",
      title: "Who mined, by mining pool",
      description:
        "Blocks, share, reward, fees and USD value per reviewed mining pool over the last 7, 30 or 90 days, with each pool's payout addresses and the unattributed rest.",
      params: [
        {
          name: "window",
          kind: "query",
          type: "7d | 30d | 90d",
          required: false,
          description: "The last 7, 30 or 90 UTC days, today included. Default 30d.",
          example: "7d",
        },
      ],
      exampleResponse: `{
  "query": {
    "window": "7d"
  },
  "coverage": {
    "status": "complete",
    "notes": []
  },
  "source": {
    "name": "ShieldedScan",
    "url": "https://shieldedscan.xyz/miners"
  },
  "basis": "A mining pool here is this explorer's reviewed label on specific payout addresses (each address carries its \`basis\`); a pool's figures add up those addresses and nothing else. Addresses no label names stay in \`unattributed\`, each its own row and never merged; some of their blocks may be a pool's, so a pool's share is a lower bound. Every share is of every block in the window, unattributed, shielded-coinbase and unrecorded ones included. \`reward\` is what the coinbase paid the address, its subsidy share plus its fee share, so it already contains \`fees\`: never add the two. From NU7 a miner keeps 40% of a block's fees and 60% goes to the NSM (/v1/analytics/nsm). A shielded coinbase (ZIP 213) is counted and never valued: its amount is encrypted. \`valueUsd\` values each closed UTC day at that day's stored close and today at the live price; \`floor\` marks a closed day with no stored close, left out rather than priced at 0. Windows are the last 7, 30 or 90 UTC days, today unfinished; nothing before \`historyFrom\` is read, and longer windows are not served until one stored block's miner is repaired.",
  "data": {
    "window": {
      "key": "7d",
      "fromDay": "2026-07-06",
      "toDay": "2026-07-12",
      "fromHeight": 2458569,
      "toHeight": 2481032,
      "daysComputed": 7,
      "daysExpected": 7
    },
    "historyFrom": "2025-12-01",
    "blocks": 22465,
    "byKind": {
      "transparent": {
        "blocks": 21229,
        "share": {
          "pct": 94.5,
          "numerator": 21229,
          "denominator": 22465
        },
        "addresses": 14
      },
      "shieldedCoinbase": {
        "blocks": 1236,
        "share": {
          "pct": 5.5,
          "numerator": 1236,
          "denominator": 22465
        }
      },
      "noAddress": {
        "blocks": 0,
        "share": {
          "pct": 0,
          "numerator": 0,
          "denominator": 22465
        }
      },
      "unrecorded": {
        "blocks": 0,
        "share": {
          "pct": 0,
          "numerator": 0,
          "denominator": 22465
        }
      }
    },
    "pools": [
      {
        "id": "viabtc",
        "name": "ViaBTC",
        "blocks": 7369,
        "share": {
          "pct": 32.8,
          "numerator": 7369,
          "denominator": 22465
        },
        "reward": {
          "zat": 307336436492,
          "zec": "3073.36436492"
        },
        "fees": {
          "zat": 294760000,
          "zec": "2.94760000"
        },
        "valueUsd": {
          "usd": 1721084.04,
          "floor": false
        },
        "addresses": [
          {
            "address": "t1MKn34KBa8Xh4g8qU8psibBXvURafphVn7",
            "blocks": 5886,
            "share": {
              "pct": 26.2,
              "numerator": 5886,
              "denominator": 22465
            },
            "reward": {
              "zat": 245485447848,
              "zec": "2454.85447848"
            },
            "fees": {
              "zat": 235440000,
              "zec": "2.35440000"
            },
            "firstHeight": 2458568,
            "lastHeight": 2481032,
            "basis": "pool-published"
          },
          {
            "address": "t1SEgZvXCu3ceE42qrq5pCeSq7HbLjX8NJv",
            "blocks": 1483,
            "share": {
              "pct": 6.6,
              "numerator": 1483,
              "denominator": 22465
            },
            "reward": {
              "zat": 61850988644,
              "zec": "618.50988644"
            },
            "fees": {
              "zat": 59320000,
              "zec": "0.59320000"
            },
            "firstHeight": 2458572,
            "lastHeight": 2481028,
            "basis": "pool-published"
          }
        ]
      },
      {
        "id": "foundry",
        "name": "Foundry USA",
        "blocks": 3729,
        "share": {
          "pct": 16.6,
          "numerator": 3729,
          "denominator": 22465
        },
        "reward": {
          "zat": 155524164972,
          "zec": "1555.24164972"
        },
        "fees": {
          "zat": 149160000,
          "zec": "1.49160000"
        },
        "valueUsd": {
          "usd": 870935.32,
          "floor": false
        },
        "addresses": [
          {
            "address": "t1SqwRAAdSig6dE4EBPLonAait219VmkUjP",
            "blocks": 3729,
            "share": {
              "pct": 16.6,
              "numerator": 3729,
              "denominator": 22465
            },
            "reward": {
              "zat": 155524164972,
              "zec": "1555.24164972"
            },
            "fees": {
              "zat": 149160000,
              "zec": "1.49160000"
            },
            "firstHeight": 2458569,
            "lastHeight": 2481031,
            "basis": "coinbase-tag"
          }
        ]
      }
    ],
    "unattributed": {
      "blocks": 562,
      "addresses": 3,
      "share": {
        "pct": 2.5,
        "numerator": 562,
        "denominator": 22465
      },
      "reward": {
        "zat": 23439147416,
        "zec": "234.39147416"
      },
      "fees": {
        "zat": 22480000,
        "zec": "0.22480000"
      },
      "valueUsd": {
        "usd": 131259.23,
        "floor": false
      },
      "largest": [
        {
          "address": "t1SoloMinerPayoutFixture000003",
          "blocks": 292,
          "share": {
            "pct": 1.3,
            "numerator": 292,
            "denominator": 22465
          },
          "reward": {
            "zat": 12178347056,
            "zec": "121.78347056"
          },
          "fees": {
            "zat": 11680000,
            "zec": "0.11680000"
          },
          "firstHeight": 2458579,
          "lastHeight": 2481021
        },
        {
          "address": "t1fpcZ2Dbwn4oj35oWBTUhtmUciSq7HG7LU",
          "blocks": 180,
          "share": {
            "pct": 0.8,
            "numerator": 180,
            "denominator": 22465
          },
          "reward": {
            "zat": 7507200240,
            "zec": "75.07200240"
          },
          "fees": {
            "zat": 7200000,
            "zec": "0.07200000"
          },
          "firstHeight": 2458580,
          "lastHeight": 2481020
        }
      ]
    }
  },
  "unknowns": {},
  "asOf": 1783875480
}`,
      notes: [
        "A pool is this explorer's reviewed label on specific payout addresses, the same labels `/v1/labels` lists; its figures add up those addresses and nothing else. An address no label names stays in `unattributed`, its own row, never merged.",
        "Every share is of every block in the window. Unattributed blocks may belong to any pool, so a pool's share is a lower bound.",
        "`reward` already contains `fees`: never add the two. From NU7 a miner keeps 40% of a block's fees; the other 60% goes to the NSM (`/v1/analytics/nsm`).",
        "A shielded coinbase is counted in `byKind.shieldedCoinbase` and never valued: its amount is encrypted.",
        "`valueUsd` values each closed UTC day at that day's close and today at the live price; `floor: true` means a day had no close and its ZEC is left out.",
        "Nothing before 2025-12-01 is read: the stored miner of block 3,146,400 awaits repair, so 1y and all-of-history windows are refused by name until it is.",
      ],
      toolNotes: [
        "A pool is a reviewed label on its payout addresses; unattributed blocks may be any pool's, so its share is a lower bound. reward includes fees.",
      ],
    },
    {
      id: "mining-pool",
      method: "GET",
      path: "/v1/analytics/mining-pools/{pool}",
      title: "One mining pool",
      description:
        "One pool: its reviewed payout addresses, its figures over the window and its newest blocks, paged by cursor.",
      params: [
        {
          name: "pool",
          kind: "path",
          type: "viabtc | foundry | f2pool | luxor | 2miners | antpool | kupool | kryptex | nicehash | mining-dutch | zec-mining-pool",
          required: true,
          description: "The pool's id.",
          example: "foundry",
        },
        {
          name: "window",
          kind: "query",
          type: "7d | 30d | 90d",
          required: false,
          description: "The last 7, 30 or 90 UTC days, today included. Default 30d.",
          example: "7d",
        },
        {
          name: "limit",
          kind: "query",
          type: "integer",
          required: false,
          description: "Blocks per page, 1 to 20. Default 20.",
          example: "2",
        },
        {
          name: "cursor",
          kind: "query",
          type: "string",
          required: false,
          description: "A `nextCursor` from this endpoint, for older blocks.",
        },
      ],
      exampleResponse: `{
  "query": {
    "window": "7d",
    "limit": 2,
    "cursor": null
  },
  "coverage": {
    "status": "complete",
    "notes": []
  },
  "source": {
    "name": "ShieldedScan",
    "url": "https://shieldedscan.xyz/miners/foundry"
  },
  "basis": "A mining pool here is this explorer's reviewed label on specific payout addresses (each address carries its \`basis\`); a pool's figures add up those addresses and nothing else. Addresses no label names stay in \`unattributed\`, each its own row and never merged; some of their blocks may be a pool's, so a pool's share is a lower bound. Every share is of every block in the window, unattributed, shielded-coinbase and unrecorded ones included. \`reward\` is what the coinbase paid the address, its subsidy share plus its fee share, so it already contains \`fees\`: never add the two. From NU7 a miner keeps 40% of a block's fees and 60% goes to the NSM (/v1/analytics/nsm). A shielded coinbase (ZIP 213) is counted and never valued: its amount is encrypted. \`valueUsd\` values each closed UTC day at that day's stored close and today at the live price; \`floor\` marks a closed day with no stored close, left out rather than priced at 0. Windows are the last 7, 30 or 90 UTC days, today unfinished; nothing before \`historyFrom\` is read, and longer windows are not served until one stored block's miner is repaired.",
  "data": {
    "pool": {
      "id": "foundry",
      "name": "Foundry USA"
    },
    "reviewedAddresses": [
      {
        "address": "t1SqwRAAdSig6dE4EBPLonAait219VmkUjP",
        "basis": "coinbase-tag"
      }
    ],
    "window": {
      "key": "7d",
      "fromDay": "2026-07-06",
      "toDay": "2026-07-12",
      "fromHeight": 2458569,
      "toHeight": 2481032,
      "daysComputed": 7,
      "daysExpected": 7
    },
    "historyFrom": "2025-12-01",
    "totals": {
      "blocks": 3729,
      "share": {
        "pct": 16.6,
        "numerator": 3729,
        "denominator": 22465
      },
      "reward": {
        "zat": 155524164972,
        "zec": "1555.24164972"
      },
      "fees": {
        "zat": 149160000,
        "zec": "1.49160000"
      },
      "valueUsd": {
        "usd": 870935.32,
        "floor": false
      },
      "addresses": [
        {
          "address": "t1SqwRAAdSig6dE4EBPLonAait219VmkUjP",
          "blocks": 3729,
          "share": {
            "pct": 16.6,
            "numerator": 3729,
            "denominator": 22465
          },
          "reward": {
            "zat": 155524164972,
            "zec": "1555.24164972"
          },
          "fees": {
            "zat": 149160000,
            "zec": "1.49160000"
          },
          "firstHeight": 2458569,
          "lastHeight": 2481031,
          "basis": "coinbase-tag"
        }
      ]
    },
    "blocks": {
      "items": [
        {
          "height": 2481032,
          "timestamp": 1783875480,
          "time": "2026-07-12T16:58:00.000Z",
          "address": "t1SqwRAAdSig6dE4EBPLonAait219VmkUjP",
          "reward": {
            "zat": 41706668,
            "zec": "0.41706668"
          }
        },
        {
          "height": 2481031,
          "timestamp": 1783875405,
          "time": "2026-07-12T16:56:45.000Z",
          "address": "t1SqwRAAdSig6dE4EBPLonAait219VmkUjP",
          "reward": {
            "zat": 41707668,
            "zec": "0.41707668"
          }
        }
      ],
      "nextCursor": "MjQ4MTAzMXwyNDgxMDMx"
    }
  },
  "unknowns": {},
  "asOf": 1783875480
}`,
      notes: [
        "`blocks` pages back to 2025-12-01 only, the first day any figure here may include.",
        "A pool that mined nothing in the window answers with zero blocks: a measurement, not an outage.",
      ],
      toolNotes: [],
    },
    {
      id: "mining-pools-series",
      method: "GET",
      path: "/v1/analytics/mining-pools/series",
      title: "Each mining pool's share over time",
      description:
        "Each mining pool's blocks, share, reward and fees per month since 2025-12-01, or per day for one pool.",
      params: [
        {
          name: "interval",
          kind: "query",
          type: "month | day",
          required: false,
          description: "Default month. day needs pool.",
        },
        {
          name: "pool",
          kind: "query",
          type: "string",
          required: false,
          description:
            "One group: a pool id, unattributed, shielded or no-address. Absent, every group.",
          example: "foundry",
        },
      ],
      exampleResponse: `{
  "query": {
    "interval": "month",
    "pool": null
  },
  "coverage": {
    "status": "complete",
    "notes": [
      "The period starting 2026-07-01 holds today and is still running."
    ]
  },
  "source": {
    "name": "ShieldedScan",
    "url": "https://shieldedscan.xyz/miners"
  },
  "basis": "A mining pool here is this explorer's reviewed label on specific payout addresses (each address carries its \`basis\`); a pool's figures add up those addresses and nothing else. Addresses no label names stay in \`unattributed\`, each its own row and never merged; some of their blocks may be a pool's, so a pool's share is a lower bound. Every share is of every block in the window, unattributed, shielded-coinbase and unrecorded ones included. \`reward\` is what the coinbase paid the address, its subsidy share plus its fee share, so it already contains \`fees\`: never add the two. From NU7 a miner keeps 40% of a block's fees and 60% goes to the NSM (/v1/analytics/nsm). A shielded coinbase (ZIP 213) is counted and never valued: its amount is encrypted. \`valueUsd\` values each closed UTC day at that day's stored close and today at the live price; \`floor\` marks a closed day with no stored close, left out rather than priced at 0. Windows are the last 7, 30 or 90 UTC days, today unfinished; nothing before \`historyFrom\` is read, and longer windows are not served until one stored block's miner is repaired. Each period's share is of every block in that period. Months run from 2025-12-01; days cover the trailing year from it.",
  "data": {
    "interval": "month",
    "fromDay": "2025-08-01",
    "toDay": "2026-07-12",
    "groups": [
      {
        "id": "viabtc",
        "name": "ViaBTC",
        "kind": "mining-pool"
      },
      {
        "id": "foundry",
        "name": "Foundry USA",
        "kind": "mining-pool"
      },
      {
        "id": "unattributed",
        "name": "Unattributed",
        "kind": "unattributed"
      },
      {
        "id": "shielded",
        "name": "Shielded coinbase",
        "kind": "shielded-coinbase"
      }
    ],
    "periods": [
      {
        "period": "2026-06-01",
        "partial": false,
        "blocks": 33669,
        "firstHeight": 2412032,
        "lastHeight": 2446532,
        "groups": [
          {
            "group": "viabtc",
            "blocks": 9747,
            "share": {
              "pct": 28.95,
              "numerator": 9747,
              "denominator": 33669
            },
            "reward": {
              "zat": 1219544678988,
              "zec": "12195.44678988"
            },
            "fees": {
              "zat": 389880000,
              "zec": "3.89880000"
            }
          },
          {
            "group": "foundry",
            "blocks": 5619,
            "share": {
              "pct": 16.69,
              "numerator": 5619,
              "denominator": 33669
            },
            "reward": {
              "zat": 703049302476,
              "zec": "7030.49302476"
            },
            "fees": {
              "zat": 224760000,
              "zec": "2.24760000"
            }
          },
          {
            "group": "unattributed",
            "blocks": 909,
            "share": {
              "pct": 2.7,
              "numerator": 909,
              "denominator": 33669
            },
            "reward": {
              "zat": 113734083636,
              "zec": "1137.34083636"
            },
            "fees": {
              "zat": 36360000,
              "zec": "0.36360000"
            }
          },
          {
            "group": "shielded",
            "blocks": 1816,
            "share": {
              "pct": 5.39,
              "numerator": 1816,
              "denominator": 33669
            },
            "reward": null,
            "fees": null
          }
        ]
      },
      {
        "period": "2026-07-01",
        "partial": true,
        "blocks": 17127,
        "firstHeight": 2446532,
        "lastHeight": 2481032,
        "groups": [
          {
            "group": "viabtc",
            "blocks": 5090,
            "share": {
              "pct": 29.72,
              "numerator": 5090,
              "denominator": 17127
            },
            "reward": {
              "zat": 636860820360,
              "zec": "6368.60820360"
            },
            "fees": {
              "zat": 203600000,
              "zec": "2.03600000"
            }
          },
          {
            "group": "foundry",
            "blocks": 3027,
            "share": {
              "pct": 17.67,
              "numerator": 3027,
              "denominator": 17127
            },
            "reward": {
              "zat": 378738252108,
              "zec": "3787.38252108"
            },
            "fees": {
              "zat": 121080000,
              "zec": "1.21080000"
            }
          },
          {
            "group": "unattributed",
            "blocks": 427,
            "share": {
              "pct": 2.49,
              "numerator": 427,
              "denominator": 17127
            },
            "reward": {
              "zat": 53426241708,
              "zec": "534.26241708"
            },
            "fees": {
              "zat": 17080000,
              "zec": "0.17080000"
            }
          },
          {
            "group": "shielded",
            "blocks": 847,
            "share": {
              "pct": 4.95,
              "numerator": 847,
              "denominator": 17127
            },
            "reward": null,
            "fees": null
          }
        ]
      }
    ]
  },
  "unknowns": {
    "data.periods.0.groups.3.reward": "shielded",
    "data.periods.0.groups.3.fees": "shielded",
    "data.periods.1.groups.3.reward": "shielded",
    "data.periods.1.groups.3.fees": "shielded"
  },
  "asOf": 1783875480
}`,
      notes: [
        "Each share is of every block in that period. The running period holds today and says so with `partial`.",
        "A shielded coinbase's reward and fees are null with reason `shielded`: its amounts are encrypted.",
      ],
      toolNotes: [],
    },
    {
      id: "nsm",
      method: "GET",
      path: "/v1/analytics/nsm",
      title: "The NSM: fees in, and its balance",
      description:
        "From NU7: the fees moved into the Network Sustainability Mechanism (60%) and kept by miners, per day and over the window, and the NSM balance now.",
      params: [
        {
          name: "window",
          kind: "query",
          type: "7d | 30d | 90d",
          required: false,
          description: "The last 7, 30 or 90 UTC days, today included. Default 30d.",
          example: "7d",
        },
      ],
      exampleResponse: `{
  "query": {
    "window": "7d"
  },
  "coverage": {
    "status": "complete",
    "notes": [
      "The window opens before NU7; it is summed from 2026-07-10."
    ]
  },
  "source": {
    "name": "ShieldedScan",
    "url": "https://shieldedscan.xyz/miners"
  },
  "basis": "From NU7 (ZIP 235) each block moves floor(6 × fees / 10) of its fees into the NSM (Network Sustainability Mechanism) and leaves the rest to the miner, summed per UTC day over every block whatever its coinbase: a block's fee total is public. The balance is the node's own figure at \`balance.height\`. It is larger than the fees because the node opened the NSM at NU7 with the miner subsidy never claimed since genesis (\`carriedIn\`); \`fromFees\` is the rest, every block's fee share from NU7 to that height. No reissuance has left the balance yet. \`toNsmValueUsd\` and \`toMinersValueUsd\` value each closed UTC day at that day's stored close and today at the live price. Windows are the last 7, 30 or 90 UTC days, today unfinished.",
  "data": {
    "activationHeight": 3543405,
    "activationDay": "2026-07-10",
    "feeSplitPct": {
      "nsm": 60,
      "miners": 40
    },
    "balance": {
      "height": 3552486,
      "amount": {
        "zat": 37165698216,
        "zec": "371.65698216"
      },
      "carriedIn": {
        "zat": 36858445520,
        "zec": "368.58445520"
      },
      "fromFees": {
        "zat": 307252696,
        "zec": "3.07252696"
      }
    },
    "window": {
      "key": "7d",
      "fromDay": "2026-07-10",
      "toDay": "2026-07-12",
      "sinceActivation": true,
      "blocks": 9082,
      "fees": {
        "zat": 512091824,
        "zec": "5.12091824"
      },
      "toNsm": {
        "zat": 307252696,
        "zec": "3.07252696"
      },
      "toMiners": {
        "zat": 204839128,
        "zec": "2.04839128"
      },
      "toNsmValueUsd": {
        "usd": 119.79,
        "floor": false
      },
      "toMinersValueUsd": {
        "usd": 79.86,
        "floor": false
      }
    },
    "days": [
      {
        "day": "2026-07-10",
        "partial": false,
        "blocks": 3086,
        "fees": {
          "zat": 154300000,
          "zec": "1.54300000"
        },
        "toNsm": {
          "zat": 92580000,
          "zec": "0.92580000"
        },
        "toMiners": {
          "zat": 61720000,
          "zec": "0.61720000"
        },
        "usdClose": 38.42
      },
      {
        "day": "2026-07-11",
        "partial": false,
        "blocks": 3456,
        "fees": {
          "zat": 214424064,
          "zec": "2.14424064"
        },
        "toNsm": {
          "zat": 128653056,
          "zec": "1.28653056"
        },
        "toMiners": {
          "zat": 85771008,
          "zec": "0.85771008"
        },
        "usdClose": 39.39
      },
      {
        "day": "2026-07-12",
        "partial": true,
        "blocks": 2540,
        "fees": {
          "zat": 143367760,
          "zec": "1.43367760"
        },
        "toNsm": {
          "zat": 86019640,
          "zec": "0.86019640"
        },
        "toMiners": {
          "zat": 57348120,
          "zec": "0.57348120"
        },
        "usdClose": null
      }
    ]
  },
  "unknowns": {
    "data.days.2.usdClose": "nonexistent"
  },
  "asOf": 1783875480
}`,
      notes: [
        "The balance is the node's own figure. It is larger than the fees because the node opened the NSM at NU7 with the miner subsidy never claimed since genesis: `carriedIn`. `fromFees` is every block's fee share from NU7 to `balance.height`.",
        "A window that opens before NU7 is summed from activation and says so.",
      ],
      toolNotes: ["balance = carriedIn (unclaimed subsidy carried in at NU7) + fromFees."],
    },
  ],
};
