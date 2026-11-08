import { MINING_POOLS } from "@/domain/mining-pools";
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
      "fromDay": "2026-11-02",
      "toDay": "2026-11-08",
      "fromHeight": 3538694,
      "toHeight": 3552856,
      "daysComputed": 7,
      "daysExpected": 7
    },
    "historyFrom": "2025-12-01",
    "blocks": 14163,
    "byKind": {
      "transparent": {
        "blocks": 13399,
        "share": {
          "pct": 94.61,
          "numerator": 13399,
          "denominator": 14163
        },
        "addresses": 28
      },
      "shieldedCoinbase": {
        "blocks": 764,
        "share": {
          "pct": 5.39,
          "numerator": 764,
          "denominator": 14163
        }
      },
      "noAddress": {
        "blocks": 0,
        "share": {
          "pct": 0,
          "numerator": 0,
          "denominator": 14163
        }
      },
      "unrecorded": {
        "blocks": 0,
        "share": {
          "pct": 0,
          "numerator": 0,
          "denominator": 14163
        }
      }
    },
    "pools": [
      {
        "id": "viabtc",
        "name": "ViaBTC",
        "blocks": 4648,
        "share": {
          "pct": 32.82,
          "numerator": 4648,
          "denominator": 14163
        },
        "reward": {
          "zat": 322687375232,
          "zec": "3226.87375232"
        },
        "fees": {
          "zat": 270704428,
          "zec": "2.70704428"
        },
        "valueUsd": {
          "usd": 4026981.32,
          "floor": false
        },
        "addresses": [
          {
            "address": "t1MKn34KBa8Xh4g8qU8psibBXvURafphVn7",
            "blocks": 2952,
            "share": {
              "pct": 20.84,
              "numerator": 2952,
              "denominator": 14163
            },
            "reward": {
              "zat": 215385128768,
              "zec": "2153.85128768"
            },
            "fees": {
              "zat": 135126308,
              "zec": "1.35126308"
            },
            "firstHeight": 3538695,
            "lastHeight": 3552856,
            "basis": "pool-published"
          },
          {
            "address": "t1SEgZvXCu3ceE42qrq5pCeSq7HbLjX8NJv",
            "blocks": 1696,
            "share": {
              "pct": 11.97,
              "numerator": 1696,
              "denominator": 14163
            },
            "reward": {
              "zat": 107302246464,
              "zec": "1073.02246464"
            },
            "fees": {
              "zat": 135578120,
              "zec": "1.35578120"
            },
            "firstHeight": 3538712,
            "lastHeight": 3552849,
            "basis": "pool-published"
          }
        ]
      },
      {
        "id": "foundry",
        "name": "Foundry USA",
        "blocks": 2403,
        "share": {
          "pct": 16.97,
          "numerator": 2403,
          "denominator": 14163
        },
        "reward": {
          "zat": 165779669082,
          "zec": "1657.79669082"
        },
        "fees": {
          "zat": 154666926,
          "zec": "1.54666926"
        },
        "valueUsd": {
          "usd": 2069397.68,
          "floor": false
        },
        "addresses": [
          {
            "address": "t1SqwRAAdSig6dE4EBPLonAait219VmkUjP",
            "blocks": 2403,
            "share": {
              "pct": 16.97,
              "numerator": 2403,
              "denominator": 14163
            },
            "reward": {
              "zat": 165779669082,
              "zec": "1657.79669082"
            },
            "fees": {
              "zat": 154666926,
              "zec": "1.54666926"
            },
            "firstHeight": 3538702,
            "lastHeight": 3552847,
            "basis": "coinbase-tag"
          }
        ]
      },
      {
        "id": "f2pool",
        "name": "F2Pool",
        "blocks": 2074,
        "share": {
          "pct": 14.64,
          "numerator": 2074,
          "denominator": 14163
        },
        "reward": {
          "zat": 147008040219,
          "zec": "1470.08040219"
        },
        "fees": {
          "zat": 174705087,
          "zec": "1.74705087"
        },
        "valueUsd": {
          "usd": 1833856.48,
          "floor": false
        },
        "addresses": [
          {
            "address": "t1PEp2GJLSdhDfCKqc2J211WKDUS1NfoQNy",
            "blocks": 2074,
            "share": {
              "pct": 14.64,
              "numerator": 2074,
              "denominator": 14163
            },
            "reward": {
              "zat": 147008040219,
              "zec": "1470.08040219"
            },
            "fees": {
              "zat": 174705087,
              "zec": "1.74705087"
            },
            "firstHeight": 3538707,
            "lastHeight": 3552855,
            "basis": "coinbase-tag"
          }
        ]
      }
    ],
    "unattributed": {
      "blocks": 332,
      "addresses": 16,
      "share": {
        "pct": 2.34,
        "numerator": 332,
        "denominator": 14163
      },
      "reward": {
        "zat": 21850899309,
        "zec": "218.50899309"
      },
      "fees": {
        "zat": 19774368,
        "zec": "0.19774368"
      },
      "valueUsd": {
        "usd": 273221.33,
        "floor": false
      },
      "largest": [
        {
          "address": "t1fpcZ2Dbwn4oj35oWBTUhtmUciSq7HG7LU",
          "blocks": 123,
          "share": {
            "pct": 0.87,
            "numerator": 123,
            "denominator": 14163
          },
          "reward": {
            "zat": 9637155275,
            "zec": "96.37155275"
          },
          "fees": {
            "zat": 12155183,
            "zec": "0.12155183"
          },
          "firstHeight": 3538789,
          "lastHeight": 3552806
        },
        {
          "address": "t1Na7ykQ6vE4CbxBPuUDUQx5n6aEWXu1VQq",
          "blocks": 110,
          "share": {
            "pct": 0.78,
            "numerator": 110,
            "denominator": 14163
          },
          "reward": {
            "zat": 6420234152,
            "zec": "64.20234152"
          },
          "fees": {
            "zat": 3567368,
            "zec": "0.03567368"
          },
          "firstHeight": 3538790,
          "lastHeight": 3552838
        }
      ]
    }
  },
  "unknowns": {},
  "asOf": 1794173057
}`,
      notes: [
        "The example response is abridged: three of the pools and two of the largest unattributed addresses, so its rows do not add up to its totals.",
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
          type: Object.keys(MINING_POOLS).join(" | "),
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
      "fromDay": "2026-11-02",
      "toDay": "2026-11-08",
      "fromHeight": 3538694,
      "toHeight": 3552856,
      "daysComputed": 7,
      "daysExpected": 7
    },
    "historyFrom": "2025-12-01",
    "totals": {
      "blocks": 2403,
      "share": {
        "pct": 16.97,
        "numerator": 2403,
        "denominator": 14163
      },
      "reward": {
        "zat": 165779669082,
        "zec": "1657.79669082"
      },
      "fees": {
        "zat": 154666926,
        "zec": "1.54666926"
      },
      "valueUsd": {
        "usd": 2069397.68,
        "floor": false
      },
      "addresses": [
        {
          "address": "t1SqwRAAdSig6dE4EBPLonAait219VmkUjP",
          "blocks": 2403,
          "share": {
            "pct": 16.97,
            "numerator": 2403,
            "denominator": 14163
          },
          "reward": {
            "zat": 165779669082,
            "zec": "1657.79669082"
          },
          "fees": {
            "zat": 154666926,
            "zec": "1.54666926"
          },
          "firstHeight": 3538702,
          "lastHeight": 3552847,
          "basis": "coinbase-tag"
        }
      ]
    },
    "blocks": {
      "items": [
        {
          "height": 3552847,
          "timestamp": 1794172766,
          "time": "2026-11-08T21:19:26.000Z",
          "address": "t1SqwRAAdSig6dE4EBPLonAait219VmkUjP",
          "reward": {
            "zat": 41666668,
            "zec": "0.41666668"
          }
        },
        {
          "height": 3552840,
          "timestamp": 1794172637,
          "time": "2026-11-08T21:17:17.000Z",
          "address": "t1SqwRAAdSig6dE4EBPLonAait219VmkUjP",
          "reward": {
            "zat": 41715756,
            "zec": "0.41715756"
          }
        }
      ],
      "nextCursor": "MzU1Mjg0MHwzNTUyODQw"
    }
  },
  "unknowns": {},
  "asOf": 1794173058
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
    "pool": "foundry"
  },
  "coverage": {
    "status": "complete",
    "notes": [
      "The period starting 2026-11-01 holds today and is still running."
    ]
  },
  "source": {
    "name": "ShieldedScan",
    "url": "https://shieldedscan.xyz/miners"
  },
  "basis": "A mining pool here is this explorer's reviewed label on specific payout addresses (each address carries its \`basis\`); a pool's figures add up those addresses and nothing else. Addresses no label names stay in \`unattributed\`, each its own row and never merged; some of their blocks may be a pool's, so a pool's share is a lower bound. Every share is of every block in the window, unattributed, shielded-coinbase and unrecorded ones included. \`reward\` is what the coinbase paid the address, its subsidy share plus its fee share, so it already contains \`fees\`: never add the two. From NU7 a miner keeps 40% of a block's fees and 60% goes to the NSM (/v1/analytics/nsm). A shielded coinbase (ZIP 213) is counted and never valued: its amount is encrypted. \`valueUsd\` values each closed UTC day at that day's stored close and today at the live price; \`floor\` marks a closed day with no stored close, left out rather than priced at 0. Windows are the last 7, 30 or 90 UTC days, today unfinished; nothing before \`historyFrom\` is read, and longer windows are not served until one stored block's miner is repaired. Each period's share is of every block in that period. Months run from 2025-12-01; days cover the trailing year from it.",
  "data": {
    "interval": "month",
    "fromDay": "2025-12-01",
    "toDay": "2026-11-08",
    "groups": [
      {
        "id": "foundry",
        "name": "Foundry USA",
        "kind": "mining-pool"
      }
    ],
    "periods": [
      {
        "period": "2025-12-01",
        "partial": false,
        "blocks": 35534,
        "firstHeight": 3153474,
        "lastHeight": 3189007,
        "groups": [
          {
            "group": "foundry",
            "blocks": 0,
            "share": {
              "pct": 0,
              "numerator": 0,
              "denominator": 35534
            },
            "reward": {
              "zat": 0,
              "zec": "0.00000000"
            },
            "fees": {
              "zat": 0,
              "zec": "0.00000000"
            }
          }
        ]
      },
      {
        "period": "2026-01-01",
        "partial": false,
        "blocks": 35533,
        "firstHeight": 3189008,
        "lastHeight": 3224540,
        "groups": [
          {
            "group": "foundry",
            "blocks": 4,
            "share": {
              "pct": 0.01,
              "numerator": 4,
              "denominator": 35533
            },
            "reward": {
              "zat": 510661694,
              "zec": "5.10661694"
            },
            "fees": {
              "zat": 10661694,
              "zec": "0.10661694"
            }
          }
        ]
      },
      {
        "period": "2026-02-01",
        "partial": false,
        "blocks": 32111,
        "firstHeight": 3224541,
        "lastHeight": 3256651,
        "groups": [
          {
            "group": "foundry",
            "blocks": 428,
            "share": {
              "pct": 1.33,
              "numerator": 428,
              "denominator": 32111
            },
            "reward": {
              "zat": 53581123914,
              "zec": "535.81123914"
            },
            "fees": {
              "zat": 81123914,
              "zec": "0.81123914"
            }
          }
        ]
      }
    ]
  },
  "unknowns": {},
  "asOf": 1794173058
}`,
      notes: [
        "The example response is abridged to its first three months.",
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
      "The window opens before NU7; it is summed from 2026-11-06."
    ]
  },
  "source": {
    "name": "ShieldedScan",
    "url": "https://shieldedscan.xyz/miners"
  },
  "basis": "From NU7 (ZIP 235) each block moves floor(6 × fees / 10) of its fees into the NSM (Network Sustainability Mechanism) and leaves the rest to the miner, summed per UTC day over every block whatever its coinbase: a block's fee total is public. The balance is the node's own figure at \`balance.height\`. It is larger than the fees because the node opened the NSM at NU7 with the miner subsidy never claimed since genesis (\`carriedIn\`); \`fromFees\` is the rest, every block's fee share from NU7 to that height. No reissuance has left the balance yet. \`toNsmValueUsd\` and \`toMinersValueUsd\` value each closed UTC day at that day's stored close and today at the live price. Windows are the last 7, 30 or 90 UTC days, today unfinished.",
  "data": {
    "activationHeight": 3543405,
    "activationDay": "2026-11-06",
    "feeSplitPct": {
      "nsm": 60,
      "miners": 40
    },
    "balance": {
      "height": 3552857,
      "amount": {
        "zat": 37088183318,
        "zec": "370.88183318"
      },
      "carriedIn": {
        "zat": 36858445520,
        "zec": "368.58445520"
      },
      "fromFees": {
        "zat": 229737798,
        "zec": "2.29737798"
      }
    },
    "window": {
      "key": "7d",
      "fromDay": "2026-11-06",
      "toDay": "2026-11-08",
      "sinceActivation": true,
      "blocks": 9452,
      "fees": {
        "zat": 382703186,
        "zec": "3.82703186"
      },
      "toNsm": {
        "zat": 229621439,
        "zec": "2.29621439"
      },
      "toMiners": {
        "zat": 153081747,
        "zec": "1.53081747"
      },
      "toNsmValueUsd": {
        "usd": 2930.67,
        "floor": false
      },
      "toMinersValueUsd": {
        "usd": 1953.79,
        "floor": false
      }
    },
    "days": [
      {
        "day": "2026-11-06",
        "partial": false,
        "blocks": 2923,
        "fees": {
          "zat": 147770581,
          "zec": "1.47770581"
        },
        "toNsm": {
          "zat": 88662173,
          "zec": "0.88662173"
        },
        "toMiners": {
          "zat": 59108408,
          "zec": "0.59108408"
        },
        "usdClose": 1320.165771484375
      },
      {
        "day": "2026-11-07",
        "partial": false,
        "blocks": 3443,
        "fees": {
          "zat": 124063876,
          "zec": "1.24063876"
        },
        "toNsm": {
          "zat": 74438170,
          "zec": "0.74438170"
        },
        "toMiners": {
          "zat": 49625706,
          "zec": "0.49625706"
        },
        "usdClose": 1260.21044921875
      },
      {
        "day": "2026-11-08",
        "partial": true,
        "blocks": 3086,
        "fees": {
          "zat": 110868729,
          "zec": "1.10868729"
        },
        "toNsm": {
          "zat": 66521096,
          "zec": "0.66521096"
        },
        "toMiners": {
          "zat": 44347633,
          "zec": "0.44347633"
        },
        "usdClose": null
      }
    ]
  },
  "unknowns": {
    "data.days.2.usdClose": "nonexistent"
  },
  "asOf": 1794173058
}`,
      notes: [
        "The balance is the node's own figure. It is larger than the fees because the node opened the NSM at NU7 with the miner subsidy never claimed since genesis: `carriedIn`. `fromFees` is every block's fee share from NU7 to `balance.height`.",
        "A window that opens before NU7 is summed from activation and says so.",
      ],
      toolNotes: ["balance = carriedIn (unclaimed subsidy carried in at NU7) + fromFees."],
    },
  ],
};
