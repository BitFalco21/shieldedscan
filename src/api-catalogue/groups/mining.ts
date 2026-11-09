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
        "Blocks, share, reward, fees and USD value per reviewed mining pool over the last 7, 30, 90 or 365 days or all of history, with each pool's payout addresses and the unattributed rest.",
      params: [
        {
          name: "window",
          kind: "query",
          type: "7d | 30d | 90d | 1y | all",
          required: false,
          description:
            "The last 7, 30, 90 or 365 UTC days (`7d`, `30d`, `90d`, `1y`), today included, or `all` of history. Default 30d.",
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
  "basis": "A mining pool here is this explorer's reviewed label on specific payout addresses (each address carries its \`basis\`); a pool's figures add up those addresses and nothing else. Addresses no label names stay in \`unattributed\`, each its own row and never merged; some of their blocks may be a pool's, so a pool's share is a lower bound. Every share is of every block in the window, unattributed, shielded-coinbase and unrecorded ones included. \`reward\` is what the coinbase paid the address, its subsidy share plus its fee share, so it already contains \`fees\`: never add the two. From NU7 a miner keeps 40% of a block's fees and 60% goes to the NSM (/v1/analytics/nsm). A shielded coinbase (ZIP 213) is counted and never valued: its amount is encrypted. \`valueUsd\` values each closed UTC day at that day's stored close and today at the live price; \`floor\` marks a closed day with no stored close, left out rather than priced at 0. Windows are the last 7, 30, 90 or 365 UTC days, today unfinished, or all of history from \`historyFrom\`; blocks that paid a bare public key have no address and are counted apart.",
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
    "historyFrom": "2016-10-28",
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
        "Blocks before 2018 that paid their miner to a bare public key have no address: they are counted in `byKind.noAddress`, and their reward is in no row.",
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
          type: "7d | 30d | 90d | 1y | all",
          required: false,
          description:
            "The last 7, 30, 90 or 365 UTC days (`7d`, `30d`, `90d`, `1y`), today included, or `all` of history. Default 30d.",
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
  "basis": "A mining pool here is this explorer's reviewed label on specific payout addresses (each address carries its \`basis\`); a pool's figures add up those addresses and nothing else. Addresses no label names stay in \`unattributed\`, each its own row and never merged; some of their blocks may be a pool's, so a pool's share is a lower bound. Every share is of every block in the window, unattributed, shielded-coinbase and unrecorded ones included. \`reward\` is what the coinbase paid the address, its subsidy share plus its fee share, so it already contains \`fees\`: never add the two. From NU7 a miner keeps 40% of a block's fees and 60% goes to the NSM (/v1/analytics/nsm). A shielded coinbase (ZIP 213) is counted and never valued: its amount is encrypted. \`valueUsd\` values each closed UTC day at that day's stored close and today at the live price; \`floor\` marks a closed day with no stored close, left out rather than priced at 0. Windows are the last 7, 30, 90 or 365 UTC days, today unfinished, or all of history from \`historyFrom\`; blocks that paid a bare public key have no address and are counted apart.",
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
    "historyFrom": "2016-10-28",
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
        "`blocks` pages back to the first block, newest first.",
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
        "Each mining pool's blocks, share, reward and fees per month since 2016, or per day for one pool.",
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
      "The period starting 2026-11-01 holds today and is still running."
    ]
  },
  "source": {
    "name": "ShieldedScan",
    "url": "https://shieldedscan.xyz/miners"
  },
  "basis": "A mining pool here is this explorer's reviewed label on specific payout addresses (each address carries its \`basis\`); a pool's figures add up those addresses and nothing else. Addresses no label names stay in \`unattributed\`, each its own row and never merged; some of their blocks may be a pool's, so a pool's share is a lower bound. Every share is of every block in the window, unattributed, shielded-coinbase and unrecorded ones included. \`reward\` is what the coinbase paid the address, its subsidy share plus its fee share, so it already contains \`fees\`: never add the two. From NU7 a miner keeps 40% of a block's fees and 60% goes to the NSM (/v1/analytics/nsm). A shielded coinbase (ZIP 213) is counted and never valued: its amount is encrypted. \`valueUsd\` values each closed UTC day at that day's stored close and today at the live price; \`floor\` marks a closed day with no stored close, left out rather than priced at 0. Windows are the last 7, 30, 90 or 365 UTC days, today unfinished, or all of history from \`historyFrom\`; blocks that paid a bare public key have no address and are counted apart. Each period's share is of every block in that period, and a period lists only the groups that mined in it. Months run from 2016-10-28; days cover the trailing year.",
  "data": {
    "interval": "month",
    "fromDay": "2016-10-28",
    "toDay": "2026-11-09",
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
        "id": "f2pool",
        "name": "F2Pool",
        "kind": "mining-pool"
      },
      {
        "id": "luxor",
        "name": "Luxor",
        "kind": "mining-pool"
      },
      {
        "id": "2miners",
        "name": "2Miners",
        "kind": "mining-pool"
      },
      {
        "id": "antpool",
        "name": "AntPool",
        "kind": "mining-pool"
      },
      {
        "id": "kupool",
        "name": "KuPool",
        "kind": "mining-pool"
      },
      {
        "id": "kryptex",
        "name": "Kryptex",
        "kind": "mining-pool"
      },
      {
        "id": "nicehash",
        "name": "NiceHash",
        "kind": "mining-pool"
      },
      {
        "id": "mining-dutch",
        "name": "Mining-Dutch",
        "kind": "mining-pool"
      },
      {
        "id": "zec-mining-pool",
        "name": "ZEC Mining Pool",
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
        "period": "2026-09-01",
        "partial": false,
        "blocks": 34405,
        "firstHeight": 3467591,
        "lastHeight": 3501995,
        "groups": [
          {
            "group": "viabtc",
            "blocks": 12650,
            "share": {
              "pct": 36.77,
              "numerator": 12650,
              "denominator": 34405
            },
            "reward": {
              "zat": 1584620818860,
              "zec": "15846.20818860"
            },
            "fees": {
              "zat": 3370818860,
              "zec": "33.70818860"
            }
          },
          {
            "group": "foundry",
            "blocks": 4858,
            "share": {
              "pct": 14.12,
              "numerator": 4858,
              "denominator": 34405
            },
            "reward": {
              "zat": 608850277380,
              "zec": "6088.50277380"
            },
            "fees": {
              "zat": 1600277380,
              "zec": "16.00277380"
            }
          },
          {
            "group": "f2pool",
            "blocks": 5368,
            "share": {
              "pct": 15.6,
              "numerator": 5368,
              "denominator": 34405
            },
            "reward": {
              "zat": 672921562078,
              "zec": "6729.21562078"
            },
            "fees": {
              "zat": 1921562078,
              "zec": "19.21562078"
            }
          },
          {
            "group": "luxor",
            "blocks": 4744,
            "share": {
              "pct": 13.79,
              "numerator": 4744,
              "denominator": 34405
            },
            "reward": {
              "zat": 594899000820,
              "zec": "5948.99000820"
            },
            "fees": {
              "zat": 1899000820,
              "zec": "18.99000820"
            }
          },
          {
            "group": "2miners",
            "blocks": 2038,
            "share": {
              "pct": 5.92,
              "numerator": 2038,
              "denominator": 34405
            },
            "reward": {
              "zat": 255146027602,
              "zec": "2551.46027602"
            },
            "fees": {
              "zat": 396027602,
              "zec": "3.96027602"
            }
          },
          {
            "group": "antpool",
            "blocks": 1247,
            "share": {
              "pct": 3.62,
              "numerator": 1247,
              "denominator": 34405
            },
            "reward": {
              "zat": 156389408768,
              "zec": "1563.89408768"
            },
            "fees": {
              "zat": 514408768,
              "zec": "5.14408768"
            }
          },
          {
            "group": "kupool",
            "blocks": 606,
            "share": {
              "pct": 1.76,
              "numerator": 606,
              "denominator": 34405
            },
            "reward": {
              "zat": 75979577009,
              "zec": "759.79577009"
            },
            "fees": {
              "zat": 229577009,
              "zec": "2.29577009"
            }
          },
          {
            "group": "kryptex",
            "blocks": 320,
            "share": {
              "pct": 0.93,
              "numerator": 320,
              "denominator": 34405
            },
            "reward": {
              "zat": 40126769342,
              "zec": "401.26769342"
            },
            "fees": {
              "zat": 126769342,
              "zec": "1.26769342"
            }
          },
          {
            "group": "nicehash",
            "blocks": 153,
            "share": {
              "pct": 0.44,
              "numerator": 153,
              "denominator": 34405
            },
            "reward": {
              "zat": 18841177218,
              "zec": "188.41177218"
            },
            "fees": {
              "zat": 73965384,
              "zec": "0.73965384"
            }
          },
          {
            "group": "mining-dutch",
            "blocks": 87,
            "share": {
              "pct": 0.25,
              "numerator": 87,
              "denominator": 34405
            },
            "reward": {
              "zat": 10907172863,
              "zec": "109.07172863"
            },
            "fees": {
              "zat": 32172863,
              "zec": "0.32172863"
            }
          },
          {
            "group": "zec-mining-pool",
            "blocks": 19,
            "share": {
              "pct": 0.06,
              "numerator": 19,
              "denominator": 34405
            },
            "reward": {
              "zat": 2383126539,
              "zec": "23.83126539"
            },
            "fees": {
              "zat": 8126539,
              "zec": "0.08126539"
            }
          },
          {
            "group": "unattributed",
            "blocks": 752,
            "share": {
              "pct": 2.19,
              "numerator": 752,
              "denominator": 34405
            },
            "reward": {
              "zat": 94238928609,
              "zec": "942.38928609"
            },
            "fees": {
              "zat": 256461857,
              "zec": "2.56461857"
            }
          },
          {
            "group": "shielded",
            "blocks": 1563,
            "share": {
              "pct": 4.54,
              "numerator": 1563,
              "denominator": 34405
            },
            "reward": null,
            "fees": null
          }
        ]
      },
      {
        "period": "2026-10-01",
        "partial": false,
        "blocks": 35551,
        "firstHeight": 3501996,
        "lastHeight": 3537546,
        "groups": [
          {
            "group": "viabtc",
            "blocks": 11826,
            "share": {
              "pct": 33.26,
              "numerator": 11826,
              "denominator": 35551
            },
            "reward": {
              "zat": 1479804187847,
              "zec": "14798.04187847"
            },
            "fees": {
              "zat": 1554187847,
              "zec": "15.54187847"
            }
          },
          {
            "group": "foundry",
            "blocks": 5939,
            "share": {
              "pct": 16.71,
              "numerator": 5939,
              "denominator": 35551
            },
            "reward": {
              "zat": 743722491813,
              "zec": "7437.22491813"
            },
            "fees": {
              "zat": 1347491813,
              "zec": "13.47491813"
            }
          },
          {
            "group": "f2pool",
            "blocks": 5473,
            "share": {
              "pct": 15.39,
              "numerator": 5473,
              "denominator": 35551
            },
            "reward": {
              "zat": 685182497615,
              "zec": "6851.82497615"
            },
            "fees": {
              "zat": 1057497615,
              "zec": "10.57497615"
            }
          },
          {
            "group": "luxor",
            "blocks": 4555,
            "share": {
              "pct": 12.81,
              "numerator": 4555,
              "denominator": 35551
            },
            "reward": {
              "zat": 570296654436,
              "zec": "5702.96654436"
            },
            "fees": {
              "zat": 921654436,
              "zec": "9.21654436"
            }
          },
          {
            "group": "2miners",
            "blocks": 2105,
            "share": {
              "pct": 5.92,
              "numerator": 2105,
              "denominator": 35551
            },
            "reward": {
              "zat": 263365989603,
              "zec": "2633.65989603"
            },
            "fees": {
              "zat": 240989603,
              "zec": "2.40989603"
            }
          },
          {
            "group": "antpool",
            "blocks": 1937,
            "share": {
              "pct": 5.45,
              "numerator": 1937,
              "denominator": 35551
            },
            "reward": {
              "zat": 242457966953,
              "zec": "2424.57966953"
            },
            "fees": {
              "zat": 332966953,
              "zec": "3.32966953"
            }
          },
          {
            "group": "kupool",
            "blocks": 574,
            "share": {
              "pct": 1.61,
              "numerator": 574,
              "denominator": 35551
            },
            "reward": {
              "zat": 71853490303,
              "zec": "718.53490303"
            },
            "fees": {
              "zat": 103490303,
              "zec": "1.03490303"
            }
          },
          {
            "group": "kryptex",
            "blocks": 344,
            "share": {
              "pct": 0.97,
              "numerator": 344,
              "denominator": 35551
            },
            "reward": {
              "zat": 43098845795,
              "zec": "430.98845795"
            },
            "fees": {
              "zat": 98845795,
              "zec": "0.98845795"
            }
          },
          {
            "group": "nicehash",
            "blocks": 129,
            "share": {
              "pct": 0.36,
              "numerator": 129,
              "denominator": 35551
            },
            "reward": {
              "zat": 15690319242,
              "zec": "156.90319242"
            },
            "fees": {
              "zat": 50586738,
              "zec": "0.50586738"
            }
          },
          {
            "group": "mining-dutch",
            "blocks": 99,
            "share": {
              "pct": 0.28,
              "numerator": 99,
              "denominator": 35551
            },
            "reward": {
              "zat": 12386465109,
              "zec": "123.86465109"
            },
            "fees": {
              "zat": 11465109,
              "zec": "0.11465109"
            }
          },
          {
            "group": "unattributed",
            "blocks": 878,
            "share": {
              "pct": 2.47,
              "numerator": 878,
              "denominator": 35551
            },
            "reward": {
              "zat": 109853356182,
              "zec": "1098.53356182"
            },
            "fees": {
              "zat": 160048024,
              "zec": "1.60048024"
            }
          },
          {
            "group": "shielded",
            "blocks": 1692,
            "share": {
              "pct": 4.76,
              "numerator": 1692,
              "denominator": 35551
            },
            "reward": null,
            "fees": null
          }
        ]
      },
      {
        "period": "2026-11-01",
        "partial": true,
        "blocks": 17937,
        "firstHeight": 3537547,
        "lastHeight": 3555483,
        "groups": [
          {
            "group": "viabtc",
            "blocks": 5878,
            "share": {
              "pct": 32.77,
              "numerator": 5878,
              "denominator": 17937
            },
            "reward": {
              "zat": 405902735130,
              "zec": "4059.02735130"
            },
            "fees": {
              "zat": 319396530,
              "zec": "3.19396530"
            }
          },
          {
            "group": "foundry",
            "blocks": 3030,
            "share": {
              "pct": 16.89,
              "numerator": 3030,
              "denominator": 17937
            },
            "reward": {
              "zat": 206523823187,
              "zec": "2065.23823187"
            },
            "fees": {
              "zat": 190487095,
              "zec": "1.90487095"
            }
          },
          {
            "group": "f2pool",
            "blocks": 2650,
            "share": {
              "pct": 14.77,
              "numerator": 2650,
              "denominator": 17937
            },
            "reward": {
              "zat": 186046810707,
              "zec": "1860.46810707"
            },
            "fees": {
              "zat": 213475047,
              "zec": "2.13475047"
            }
          },
          {
            "group": "luxor",
            "blocks": 2537,
            "share": {
              "pct": 14.14,
              "numerator": 2537,
              "denominator": 17937
            },
            "reward": {
              "zat": 174485872148,
              "zec": "1744.85872148"
            },
            "fees": {
              "zat": 194203196,
              "zec": "1.94203196"
            }
          },
          {
            "group": "2miners",
            "blocks": 993,
            "share": {
              "pct": 5.54,
              "numerator": 993,
              "denominator": 17937
            },
            "reward": {
              "zat": 67360208058,
              "zec": "673.60208058"
            },
            "fees": {
              "zat": 68540482,
              "zec": "0.68540482"
            }
          },
          {
            "group": "antpool",
            "blocks": 1015,
            "share": {
              "pct": 5.66,
              "numerator": 1015,
              "denominator": 17937
            },
            "reward": {
              "zat": 70353737388,
              "zec": "703.53737388"
            },
            "fees": {
              "zat": 62069816,
              "zec": "0.62069816"
            }
          },
          {
            "group": "kupool",
            "blocks": 268,
            "share": {
              "pct": 1.49,
              "numerator": 268,
              "denominator": 17937
            },
            "reward": {
              "zat": 17771698132,
              "zec": "177.71698132"
            },
            "fees": {
              "zat": 21697880,
              "zec": "0.21697880"
            }
          },
          {
            "group": "kryptex",
            "blocks": 151,
            "share": {
              "pct": 0.84,
              "numerator": 151,
              "denominator": 17937
            },
            "reward": {
              "zat": 10469710503,
              "zec": "104.69710503"
            },
            "fees": {
              "zat": 11377035,
              "zec": "0.11377035"
            }
          },
          {
            "group": "nicehash",
            "blocks": 12,
            "share": {
              "pct": 0.07,
              "numerator": 12,
              "denominator": 17937
            },
            "reward": {
              "zat": 1456664028,
              "zec": "14.56664028"
            },
            "fees": {
              "zat": 1715482,
              "zec": "0.01715482"
            }
          },
          {
            "group": "mining-dutch",
            "blocks": 62,
            "share": {
              "pct": 0.35,
              "numerator": 62,
              "denominator": 17937
            },
            "reward": {
              "zat": 4419686238,
              "zec": "44.19686238"
            },
            "fees": {
              "zat": 3019518,
              "zec": "0.03019518"
            }
          },
          {
            "group": "unattributed",
            "blocks": 399,
            "share": {
              "pct": 2.22,
              "numerator": 399,
              "denominator": 17937
            },
            "reward": {
              "zat": 26310465153,
              "zec": "263.10465153"
            },
            "fees": {
              "zat": 21840469,
              "zec": "0.21840469"
            }
          },
          {
            "group": "shielded",
            "blocks": 942,
            "share": {
              "pct": 5.25,
              "numerator": 942,
              "denominator": 17937
            },
            "reward": null,
            "fees": null
          }
        ]
      }
    ]
  },
  "unknowns": {
    "data.periods.0.groups.12.reward": "shielded",
    "data.periods.0.groups.12.fees": "shielded",
    "data.periods.1.groups.11.reward": "shielded",
    "data.periods.1.groups.11.fees": "shielded",
    "data.periods.2.groups.11.reward": "shielded",
    "data.periods.2.groups.11.fees": "shielded"
  },
  "asOf": 1794238453
}`,
      notes: [
        "The example response is abridged to its last three months and the groups that mined in them.",
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
          type: "7d | 30d | 90d | 1y | all",
          required: false,
          description:
            "The last 7, 30, 90 or 365 UTC days (`7d`, `30d`, `90d`, `1y`), today included, or `all` of history. Default 30d.",
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
  "basis": "From NU7 (ZIP 235) each block moves floor(6 × fees / 10) of its fees into the NSM (Network Sustainability Mechanism) and leaves the rest to the miner, summed per UTC day over every block whatever its coinbase: a block's fee total is public. The balance is the node's own figure at \`balance.height\`. It is larger than the fees because the node opened the NSM at NU7 with the miner subsidy never claimed since genesis (\`carriedIn\`); \`fromFees\` is the rest, every block's fee share from NU7 to that height. No reissuance has left the balance yet. \`toNsmValueUsd\` and \`toMinersValueUsd\` value each closed UTC day at that day's stored close and today at the live price. Windows are the last 7, 30, 90 or 365 UTC days, today unfinished, or all of history.",
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
