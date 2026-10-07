import type { ApiGroup } from "../types";
import { RANKING_PARAMS } from "../shared-params";

export const ANALYTICS_GROUP: ApiGroup = {
  id: "analytics",
  label: "Analytics",
  endpoints: [
    {
      id: "monthly",
      method: "GET",
      path: "/v1/analytics/monthly",
      title: "A decade of chain history, monthly",
      description:
        "Every month since Zcash launched: transactions by privacy kind (coinbase excluded), each pool's closing balance at the month's top block, net pool flow, and both shielded shares — fully shielded and pool-touching — with their denominators.",
      params: [
        {
          name: "from",
          kind: "query",
          type: "unix seconds",
          required: false,
          description: "Inclusive start.",
        },
        {
          name: "to",
          kind: "query",
          type: "unix seconds",
          required: false,
          description: "Inclusive end.",
        },
      ],
      exampleResponse: `{
  "interval": "month",
  "balanceBasis": "period-closing-at-top-height",
  "coinbase": "excluded",
  "range": { "from": 1477612800, "to": 1753747200 },
  "points": [
    {
      "periodStart": 1751328000,
      "topHeight": 3429381,
      "txs": { "transparent": 36000, "mixed": 14000, "shielded": 60000 },
      "balances": { "sprout": 2994923783, "sapling": 5900000000000,
                    "orchard": 36121002983561, "ironwood": 1700000000000 },
      "netFlowZat": 1820000000000,
      "fullyShieldedShare": { "pct": 54.55, "numerator": 60000, "denominator": 110000 },
      "poolTouchingShare": { "pct": 67.27, "numerator": 74000, "denominator": 110000 }
    }
  ],
  "asOf": 1753795200
}`,
      notes: [
        "Balances are the month's CLOSING values at its highest block — not an average and not a max; a pool can fall within a month, and `max()` overstates.",
      ],
    },
    {
      id: "activity",
      method: "GET",
      path: "/v1/analytics/activity",
      title: "Transactions, blocks and fees over any window",
      description:
        "Any UTC window, totalled and optionally bucketed by day or month: transactions by privacy kind (coinbase excluded), the mixed ones split by which way value crossed, how many used each shielded pool, the fully-shielded share with its denominator, and fees with the number of blocks behind them.",
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
          name: "interval",
          kind: "query",
          type: "none | day | month",
          required: false,
          description:
            "Buckets beside the window totals. `day` covers at most 366 days per request; `month` and `none` take any range.",
          example: "month",
        },
        {
          name: "minZec",
          kind: "query",
          type: "ZEC decimal",
          required: false,
          description:
            "Adds `overFloor`: shielding and unshielding transactions moving at least this much ZEC.",
        },
        {
          name: "minFiat",
          kind: "query",
          type: "decimal",
          required: false,
          description:
            "The same floor in `currency`, each transaction valued at its own day's close.",
        },
        {
          name: "currency",
          kind: "query",
          type: "usd | eur | btc | …",
          required: false,
          description: "For `minFiat`. 28 fiat currencies plus btc; default usd.",
        },
        ...RANKING_PARAMS,
      ],
      exampleResponse: `{
  "query": {
    "from": "2026-07-01",
    "to": "2026-10-01",
    "interval": "month",
    "minZec": null,
    "minFiat": null,
    "currency": "usd"
  },
  "window": {
    "from": "2026-07-01",
    "to": "2026-10-01",
    "toExclusive": true,
    "fromTimestamp": 1782864000,
    "toTimestamp": 1790812800,
    "fromHeight": 3396509,
    "toHeight": 3501995
  },
  "indexed": {
    "height": 3504789,
    "timestamp": 1791023562,
    "time": "2026-10-03T10:32:42Z"
  },
  "coverage": {
    "status": "complete",
    "notes": []
  },
  "asOf": 1791023571,
  "source": {
    "name": "ShieldedScan",
    "url": "https://shieldedscan.xyz/analytics"
  },
  "data": {
    "interval": "month",
    "totals": {
      "blocks": 105487,
      "transactions": {
        "total": 604560,
        "byKind": {
          "transparent": 285888,
          "mixed": 173740,
          "fullyShielded": 144932
        },
        "mixedByDirection": {
          "shielding": 87804,
          "unshielding": 85908,
          "indeterminate": 28
        },
        "byPool": {
          "sprout": 83,
          "sapling": 25959,
          "orchard": 66773,
          "ironwood": 261199,
          "transparentOnly": 388674
        }
      },
      "fullyShieldedShare": {
        "pct": 23.97,
        "numerator": 144932,
        "denominator": 604560
      },
      "fees": {
        "feeZat": 21984748618,
        "feeZec": "219.84748618",
        "blocksCovered": 105487,
        "blocks": 105487
      }
    },
    "buckets": [
      {
        "periodStart": "2026-07-01",
        "blocks": 35551,
        "transactions": {
          "total": 101183,
          "byKind": {
            "transparent": 57896,
            "mixed": 30775,
            "fullyShielded": 12512
          },
          "mixedByDirection": {
            "shielding": 14752,
            "unshielding": 15998,
            "indeterminate": 25
          },
          "byPool": {
            "sprout": 30,
            "sapling": 6628,
            "orchard": 34295,
            "ironwood": 6278
          }
        },
        "fullyShieldedShare": {
          "pct": 12.37,
          "numerator": 12512,
          "denominator": 101183
        },
        "fees": {
          "feeZat": 5079266861,
          "feeZec": "50.79266861",
          "blocksCovered": 35551,
          "blocks": 35551
        }
      }
    ]
  },
  "unknowns": {}
}`,
      notes: [
        "`byKind` partitions `total`; `byPool` does NOT — one transaction can use two pools. `transparentOnly` is null with reason `unmeasured` for windows longer than about 200 days, which are counted from daily totals that cannot express it.",
        "`coverage.status` is `partial` when the window includes today's unfinished day, and `floor` when some blocks had no derivable fee total; `notes` say which.",
      ],
    },
    {
      id: "shielding-flow",
      method: "GET",
      path: "/v1/analytics/shielding-flow",
      title: "Value crossing each pool's boundary",
      description:
        "Per pool, value that entered from the transparent side (`shielded`), value that left to it (`unshielded`), the net, and miner rewards paid straight into the pool — over any window, by day or month. Transactions whose pools moved against each other are counted apart as `unattributed`, with a magnitude and never a direction.",
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
          name: "interval",
          kind: "query",
          type: "none | day | month",
          required: false,
          description:
            "Buckets beside the window totals. `day` covers at most 366 days per request; `month` and `none` take any range.",
          example: "month",
        },
        {
          name: "pool",
          kind: "query",
          type: "comma-separated pools",
          required: false,
          description: "Any of sprout, sapling, orchard, ironwood; default all four.",
          example: "ironwood",
        },
        ...RANKING_PARAMS,
      ],
      exampleResponse: `{
  "query": {
    "from": "2026-07-01",
    "to": "2026-10-01",
    "interval": "month",
    "pool": [
      "ironwood"
    ]
  },
  "window": {
    "from": "2026-07-01",
    "to": "2026-10-01",
    "toExclusive": true,
    "fromTimestamp": 1782864000,
    "toTimestamp": 1790812800,
    "fromHeight": 3396509,
    "toHeight": 3501995
  },
  "indexed": {
    "height": 3504790,
    "timestamp": 1791023565,
    "time": "2026-10-03T10:32:45Z"
  },
  "coverage": {
    "status": "complete",
    "notes": []
  },
  "asOf": 1791023574,
  "source": {
    "name": "ShieldedScan",
    "url": "https://shieldedscan.xyz/shielded"
  },
  "data": {
    "interval": "month",
    "totals": {
      "pools": {
        "ironwood": {
          "shielded": {
            "txs": 67429,
            "amountZat": 139729401862474,
            "amountZec": "1397294.01862474"
          },
          "unshielded": {
            "txs": 62928,
            "amountZat": 69115274608038,
            "amountZec": "691152.74608038"
          },
          "netZat": 70614127254436,
          "netZec": "706141.27254436",
          "coinbase": {
            "txs": 2701,
            "amountZat": 338290090110,
            "amountZec": "3382.90090110"
          }
        }
      },
      "unattributed": {
        "txs": 121,
        "magnitudeZat": 432292316346,
        "magnitudeZec": "4322.92316346"
      }
    },
    "buckets": [
      {
        "periodStart": "2026-07-01",
        "pools": {
          "ironwood": {
            "shielded": {
              "txs": 1332,
              "amountZat": 5851973256247,
              "amountZec": "58519.73256247"
            },
            "unshielded": {
              "txs": 706,
              "amountZat": 1407596157631,
              "amountZec": "14075.96157631"
            },
            "netZat": 4444377098616,
            "netZec": "44443.77098616",
            "coinbase": {
              "txs": 0,
              "amountZat": 0,
              "amountZec": "0.00000000"
            }
          }
        },
        "unattributed": {
          "txs": 94,
          "magnitudeZat": 299874141075,
          "magnitudeZec": "2998.74141075"
        }
      }
    ]
  },
  "unknowns": {}
}`,
      notes: [
        "These counts are per pool, not per transaction: a transaction unshielding from two pools appears under both. Do not compare them with `/v1/analytics/activity`'s direction counts — they count different things.",
        "Pool-to-pool movement is not here; use `/v1/analytics/migrations`.",
      ],
    },
    {
      id: "migrations",
      method: "GET",
      path: "/v1/analytics/migrations",
      title: "Pool-to-pool migrations",
      description:
        "Transactions with no transparent side in which exactly one pool gained and at least one lost, as a source → destination matrix over any window. The amount is the destination pool's own published balance change, valued at each day's close. Two or more losing pools are the source `multi`; the amount is never split between them.",
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
          name: "interval",
          kind: "query",
          type: "none | day | month",
          required: false,
          description:
            "Buckets beside the window totals. `day` covers at most 366 days per request; `month` and `none` take any range.",
        },
        {
          name: "source",
          kind: "query",
          type: "sprout | sapling | orchard | ironwood | multi",
          required: false,
          description: "Narrow to one source pool.",
        },
        {
          name: "destination",
          kind: "query",
          type: "sprout | sapling | orchard | ironwood",
          required: false,
          description: "Narrow to one destination pool.",
          example: "ironwood",
        },
        {
          name: "currency",
          kind: "query",
          type: "usd | eur | btc | …",
          required: false,
          description: "For `value`; default usd.",
        },
      ],
      exampleResponse: `{
  "query": {
    "from": "2026-09-22",
    "to": "2026-09-29",
    "interval": "day",
    "source": null,
    "destination": "ironwood",
    "currency": "usd"
  },
  "window": {
    "from": "2026-09-22",
    "to": "2026-09-29",
    "toExclusive": true,
    "fromTimestamp": 1790035200,
    "toTimestamp": 1790640000,
    "fromHeight": 3491682,
    "toHeight": 3499717
  },
  "indexed": {
    "height": 3504790,
    "timestamp": 1791023565,
    "time": "2026-10-03T10:32:45Z"
  },
  "coverage": {
    "status": "complete",
    "notes": []
  },
  "asOf": 1791023593,
  "source": {
    "name": "ShieldedScan",
    "url": "https://shieldedscan.xyz/charts/pool-migrations"
  },
  "data": {
    "interval": "day",
    "totals": [
      {
        "source": "orchard",
        "destination": "ironwood",
        "txs": 724,
        "amountZat": 1269426073998,
        "amountZec": "12694.26073998",
        "value": {
          "currency": "usd",
          "amount": "19611054.72",
          "pricedTxs": 724
        }
      },
      {
        "source": "sapling",
        "destination": "ironwood",
        "txs": 155,
        "amountZat": 115157217259,
        "amountZec": "1151.57217259",
        "value": {
          "currency": "usd",
          "amount": "1862031.16",
          "pricedTxs": 155
        }
      },
      {
        "source": "multi",
        "destination": "ironwood",
        "txs": 3,
        "amountZat": 271050000,
        "amountZec": "2.71050000",
        "value": {
          "currency": "usd",
          "amount": "4190.18",
          "pricedTxs": 3
        }
      }
    ],
    "buckets": [
      {
        "periodStart": "2026-09-22",
        "cells": [
          {
            "source": "orchard",
            "destination": "ironwood",
            "txs": 93,
            "amountZat": 92358614449,
            "amountZec": "923.58614449",
            "value": {
              "currency": "usd",
              "amount": "1503446.94",
              "pricedTxs": 93
            }
          },
          {
            "source": "sapling",
            "destination": "ironwood",
            "txs": 2,
            "amountZat": 100006860000,
            "amountZec": "1000.06860000",
            "value": {
              "currency": "usd",
              "amount": "1627947.85",
              "pricedTxs": 2
            }
          }
        ]
      },
      {
        "periodStart": "2026-09-23",
        "cells": [
          {
            "source": "orchard",
            "destination": "ironwood",
            "txs": 160,
            "amountZat": 737676564238,
            "amountZec": "7376.76564238",
            "value": {
              "currency": "usd",
              "amount": "11052647.94",
              "pricedTxs": 160
            }
          },
          {
            "source": "sapling",
            "destination": "ironwood",
            "txs": 60,
            "amountZat": 3016048419,
            "amountZec": "30.16048419",
            "value": {
              "currency": "usd",
              "amount": "45189.62",
              "pricedTxs": 60
            }
          }
        ]
      }
    ]
  },
  "unknowns": {}
}`,
      notes: [
        "With `interval=day` or `month`, `source` or `destination` is required — it keeps a per-period matrix small. `interval=none` returns the full matrix.",
        'An empty `cells` list is a measured "none that period", not missing data. `value.amount` is null when no migration in the cell fell on a day with a known close.',
      ],
    },
    {
      id: "analytics-pools",
      method: "GET",
      path: "/v1/analytics/pools",
      title: "Each shielded pool's balance over time",
      description:
        "The closing balance of Sprout, Sapling, Orchard and Ironwood for every day or month since launch, each read at the period's highest block, plus their total. The transparent and lockbox pools are on /v1/supply.",
      params: [
        {
          name: "from",
          kind: "query",
          type: "YYYY-MM-DD",
          required: false,
          description: "First UTC day, inclusive. Absent means the start of the series.",
          example: "2026-07-01",
        },
        {
          name: "to",
          kind: "query",
          type: "YYYY-MM-DD",
          required: false,
          description: "UTC day the window ends BEFORE (exclusive). Absent means today.",
          example: "2026-10-01",
        },
        {
          name: "interval",
          kind: "query",
          type: "day | month",
          required: false,
          description: "Default month. `day` needs from and to at most 366 days apart.",
        },
        ...RANKING_PARAMS,
      ],
      exampleResponse: `{
  "query": {
    "from": "2026-07-01",
    "to": "2026-10-01",
    "interval": "month"
  },
  "coverage": {
    "status": "complete",
    "notes": []
  },
  "source": {
    "name": "ShieldedScan",
    "url": "https://shieldedscan.xyz/shielded"
  },
  "basis": "closing balance of each shielded pool at the period's highest block; a level, not a flow — never sum points. The transparent and lockbox pools are at /v1/supply.",
  "data": {
    "interval": "month",
    "points": [
      {
        "periodStart": "2026-09-01",
        "closing": {
          "day": "2026-09-30",
          "height": 3501995
        },
        "pools": {
          "ironwood": {
            "zat": 406278757758551,
            "zec": "4062787.57758551"
          },
          "orchard": {
            "zat": 37887532318673,
            "zec": "378875.32318673"
          },
          "sapling": {
            "zat": 47871452970105,
            "zec": "478714.52970105"
          },
          "sprout": {
            "zat": 2231077535128,
            "zec": "22310.77535128"
          }
        },
        "totalShielded": {
          "zat": 494268820582457,
          "zec": "4942688.20582457"
        }
      }
    ]
  },
  "unknowns": {},
  "asOf": 1791043736
}`,
      notes: [
        "A balance is a level, not a flow: a month's point is its closing day, never a sum or an average of days. Never add points together.",
        "`closing.height` is the block each figure was read at, so any point can be checked against a node.",
      ],
    },
    {
      id: "analytics-pool-usage",
      method: "GET",
      path: "/v1/analytics/pool-usage",
      title: "How each shielded pool is used, and its anonymity set",
      description:
        "Per day or month and per pool: the transactions that used the pool, split by kind and by which way mixed ones crossed; the pool's own bundle counts (Sapling spends and outputs, Orchard and Ironwood actions, Sprout JoinSplits); and its note commitment tree at the period's close — every note ever created in the pool, which is the set a spend from it hides in.",
      params: [
        {
          name: "from",
          kind: "query",
          type: "YYYY-MM-DD",
          required: false,
          description: "First UTC day, inclusive. Absent means the start of the series.",
          example: "2026-09-01",
        },
        {
          name: "to",
          kind: "query",
          type: "YYYY-MM-DD",
          required: false,
          description: "UTC day the window ends BEFORE (exclusive). Absent means today.",
          example: "2026-09-02",
        },
        {
          name: "interval",
          kind: "query",
          type: "day | month",
          required: false,
          description: "Default month. `day` needs from and to at most 366 days apart.",
        },
        {
          name: "pool",
          kind: "query",
          type: "comma-separated pools",
          required: false,
          description: "ironwood, orchard, sapling, sprout. Absent means all four.",
          example: "ironwood",
        },
        ...RANKING_PARAMS,
      ],
      exampleResponse: `{
  "query": {
    "from": "2026-09-01",
    "to": "2026-09-02",
    "interval": "day",
    "pool": ["ironwood"]
  },
  "coverage": { "status": "complete", "notes": [] },
  "source": { "name": "ShieldedScan", "url": "https://shieldedscan.xyz/shielded" },
  "basis": "transactions that used each pool (carried a bundle in it), split by kind; a pool migration uses two pools and is counted in both, so pools do not sum. \`notes.atClose\` is the pool's note commitment tree size at the period's last block, as the node reports it: every note ever created in the pool, spent or not — the anonymity set a spend from it hides in. Sprout's is not reported.",
  "data": {
    "interval": "day",
    "totals": {
      "ironwood": {
        "transactions": {
          "total": 1921,
          "fullyShielded": 590,
          "mixed": 1303,
          "coinbase": 28,
          "mixedByDirection": { "shielding": 542, "unshielding": 761, "indeterminate": 0 }
        },
        "bundle": { "actions": 4312 },
        "notes": { "atClose": 133403, "created": 4312, "closeDay": "2026-09-01", "closeHeight": 3468735 }
      }
    },
    "points": [
      {
        "periodStart": "2026-09-01",
        "pools": {
          "ironwood": {
            "transactions": {
              "total": 1921,
              "fullyShielded": 590,
              "mixed": 1303,
              "coinbase": 28,
              "mixedByDirection": { "shielding": 542, "unshielding": 761, "indeterminate": 0 }
            },
            "bundle": { "actions": 4312 },
            "notes": {
              "atClose": 133403,
              "created": 4312,
              "closeDay": "2026-09-01",
              "closeHeight": 3468735
            }
          }
        }
      }
    ]
  },
  "unknowns": {},
  "asOf": 1791150000
}`,
      notes: [
        "Kinds partition `transactions.total`: fully shielded, mixed and coinbase (a ZIP-213 coinbase paying into the pool). A migration uses two pools, so pools do not add up to the chain's total.",
        "`notes.created` is the change in the tree size from the previous period's close. It equals the period's Orchard or Ironwood actions, or Sapling outputs — two independent counts — except where miner timestamps run backwards across midnight, which moves a note between days: two Sapling days so far, by one note each.",
        "The node reports no Sprout tree size, so Sprout's `notes` are null with reason `unmeasured`.",
      ],
    },
    {
      id: "analytics-transparent",
      method: "GET",
      path: "/v1/analytics/transparent",
      title: "Transparent volume and active addresses",
      description:
        "Per day or month: ZEC paid to and spent from transparent outputs, by kind, and the exact count of distinct transparent addresses that sent or received; also over the trailing 7, 30 and 90 days.",
      params: [
        {
          name: "from",
          kind: "query",
          type: "YYYY-MM-DD",
          required: false,
          description: "First UTC day, inclusive. Absent means the start of the series.",
          example: "2026-09-01",
        },
        {
          name: "to",
          kind: "query",
          type: "YYYY-MM-DD",
          required: false,
          description: "UTC day the window ends BEFORE (exclusive). Absent means today.",
          example: "2026-10-01",
        },
        {
          name: "interval",
          kind: "query",
          type: "day | month",
          required: false,
          description: "Default month. `day` needs from and to at most 366 days apart.",
        },
        ...RANKING_PARAMS,
      ],
      exampleResponse: `{
  "query": {
    "from": "2026-09-01",
    "to": "2026-10-01",
    "interval": "month"
  },
  "coverage": {
    "status": "complete",
    "notes": []
  },
  "source": {
    "name": "ShieldedScan",
    "url": "https://shieldedscan.xyz/api-docs#analytics-transparent"
  },
  "basis": "every transparent input and output this explorer indexes, per UTC day by block time. \`outputs.value\` is the ZEC the period's non-coinbase transactions paid to transparent outputs, split by the transaction's kind: \`transparent\` (no shielded side) and \`mixed\` (crossing the shielded boundary). It includes change returned to the sender — which output paid whom is not recorded on the chain — so it bounds the value that changed hands from above and is not ZEC sent. \`inputs.value\` is the ZEC transparent inputs spent. Coinbase outputs are issuance and fees (see the miners endpoint), not volume. \`addresses\` counts distinct transparent addresses that sent (an input) or received (an output, coinbase included), exactly, over a whole UTC day, a whole calendar month, or the trailing 7, 30 and 90 complete days. A distinct count does not add across periods, so it is stated only for a span it was counted over: a total carries one only when the window is exactly one of those spans. An output naming no single address (a bare key, multisig, OP_RETURN) is volume and no address. Shielded activity has no address and is in no figure here.",
  "data": {
    "interval": "month",
    "totals": {
      "days": 30,
      "outputs": {
        "count": 462655,
        "unaddressed": 18616,
        "value": {
          "transparent": {
            "zat": 3659922414688057,
            "zec": "36599224.14688057"
          },
          "mixed": {
            "zat": 1011264261063012,
            "zec": "10112642.61063012"
          },
          "total": {
            "zat": 4671186675751069,
            "zec": "46711866.75751069"
          }
        }
      },
      "inputs": {
        "count": 681194,
        "unresolved": 0,
        "value": {
          "transparent": {
            "zat": 3659928709535127,
            "zec": "36599287.09535127"
          },
          "mixed": {
            "zat": 1019411616492634,
            "zec": "10194116.16492634"
          },
          "total": {
            "zat": 4679340326027761,
            "zec": "46793403.26027761"
          }
        }
      },
      "addresses": {
        "active": 154232,
        "sending": 134194,
        "receiving": 136333
      }
    },
    "points": [
      {
        "periodStart": "2026-09-01",
        "days": 30,
        "outputs": {
          "count": 462655,
          "unaddressed": 18616,
          "value": {
            "transparent": {
              "zat": 3659922414688057,
              "zec": "36599224.14688057"
            },
            "mixed": {
              "zat": 1011264261063012,
              "zec": "10112642.61063012"
            },
            "total": {
              "zat": 4671186675751069,
              "zec": "46711866.75751069"
            }
          }
        },
        "inputs": {
          "count": 681194,
          "unresolved": 0,
          "value": {
            "transparent": {
              "zat": 3659928709535127,
              "zec": "36599287.09535127"
            },
            "mixed": {
              "zat": 1019411616492634,
              "zec": "10194116.16492634"
            },
            "total": {
              "zat": 4679340326027761,
              "zec": "46793403.26027761"
            }
          }
        },
        "addresses": {
          "active": 154232,
          "sending": 134194,
          "receiving": 136333
        }
      }
    ],
    "trailing": [
      {
        "days": 7,
        "from": "2026-09-28",
        "through": "2026-10-04",
        "addresses": {
          "active": 33042,
          "sending": 26517,
          "receiving": 28142
        }
      },
      {
        "days": 30,
        "from": "2026-09-05",
        "through": "2026-10-04",
        "addresses": {
          "active": 148144,
          "sending": 128255,
          "receiving": 130660
        }
      },
      {
        "days": 90,
        "from": "2026-07-07",
        "through": "2026-10-04",
        "addresses": {
          "active": 260062,
          "sending": 232493,
          "receiving": 222940
        }
      }
    ]
  },
  "unknowns": {},
  "asOf": 1791207007
}`,
      notes: [
        "`outputs.value` includes change returned to the sender: which output paid whom is not recorded on the chain, so it bounds the value that changed hands from above and is never ZEC sent. Coinbase outputs are issuance, not volume (see /v1/analytics/miners).",
        "A distinct count never adds across periods: an address active on two days is one address in their month. So `addresses` is stated for a day, a whole calendar month and the trailing windows; a month the window cuts, and a total over any other span, carry none, with the reason in `unknowns`.",
        "Shielded activity has no address and is in no figure here. An output naming no single address (a bare public key, multisig, OP_RETURN) is volume and no address.",
      ],
      toolNotes: [
        "outputs.value includes change, so it bounds value that changed hands from above. Coinbase is not volume.",
        "addresses are exact for a day, a whole month or data.trailing (7/30/90 days); distinct counts never add, so other spans have none.",
      ],
    },
    {
      id: "analytics-network",
      method: "GET",
      path: "/v1/analytics/network",
      title: "Difficulty and block size over time",
      description:
        "Average mining difficulty and average block size per day or month, with the number of blocks behind each.",
      params: [
        {
          name: "from",
          kind: "query",
          type: "YYYY-MM-DD",
          required: false,
          description: "First UTC day, inclusive. Absent means the start of the series.",
          example: "2026-07-01",
        },
        {
          name: "to",
          kind: "query",
          type: "YYYY-MM-DD",
          required: false,
          description: "UTC day the window ends BEFORE (exclusive). Absent means today.",
          example: "2026-10-01",
        },
        {
          name: "interval",
          kind: "query",
          type: "day | month",
          required: false,
          description: "Default month. `day` needs from and to at most 366 days apart.",
        },
        ...RANKING_PARAMS,
      ],
      exampleResponse: `{
  "query": {
    "from": "2026-07-01",
    "to": "2026-10-01",
    "interval": "month"
  },
  "coverage": {
    "status": "complete",
    "notes": []
  },
  "source": {
    "name": "ShieldedScan",
    "url": "https://shieldedscan.xyz/charts/difficulty"
  },
  "basis": "averages weighted by block, so a month's figure equals the mean over every block in it",
  "data": {
    "interval": "month",
    "points": [
      {
        "periodStart": "2026-08-01",
        "blocks": 35531,
        "avgDifficulty": 225208862.34,
        "avgBlockBytes": 34511
      },
      {
        "periodStart": "2026-09-01",
        "blocks": 34405,
        "avgDifficulty": 253360428.64,
        "avgBlockBytes": 74874
      }
    ]
  },
  "unknowns": {},
  "asOf": 1791043736
}`,
      notes: [
        "Averages are weighted by block, so a month's figure equals the mean over every block in it rather than a mean of daily means.",
        "A period with no measured value is `null` with reason `unmeasured`, never 0.",
      ],
    },
    {
      id: "analytics-miners",
      method: "GET",
      path: "/v1/analytics/miners",
      title: "Who mined a window, by payout address",
      description:
        "Blocks, share, reward and fees per payout address over any window of UTC days (all of history by default), the concentration of the largest one, three and ten addresses, and the blocks no address can be named for.",
      params: [
        {
          name: "from",
          kind: "query",
          type: "YYYY-MM-DD",
          required: false,
          description: "First UTC day, inclusive. Absent means the chain's first day.",
          example: "2026-09-01",
        },
        {
          name: "to",
          kind: "query",
          type: "YYYY-MM-DD",
          required: false,
          description: "UTC day the window ends BEFORE (exclusive). Absent means through today.",
          example: "2026-10-01",
        },
        {
          name: "limit",
          kind: "query",
          type: "integer",
          required: false,
          description:
            "How many addresses to list, largest first: 1 to 100, default 25. The rest are folded into `rest`.",
          example: "3",
        },
      ],
      exampleResponse: `{
  "query": { "from": "2026-09-01", "to": "2026-10-01", "limit": 3 },
  "coverage": { "status": "complete", "notes": [] },
  "source": { "name": "ShieldedScan", "url": "https://shieldedscan.xyz/mining" },
  "basis": "blocks grouped by the payout address of each coinbase's largest output, which is the miner by consensus. Two addresses are never merged, so an operator paid at several addresses appears as several and every share and concentration figure is a lower bound for any operator. Shares are of every block in the window. reward is everything the miner's coinbase outputs paid it, its fees included; fees is that included part — never add the two. coinbaseTag is text the miner wrote into its block and identifies nobody verifiably. A shielded coinbase (ZIP 213) has no payout address, and some miners until 2018 paid a bare public key, which has no address form; both are counted apart.",
  "data": {
    "fromHeight": 3467591,
    "toHeight": 3501995,
    "blocks": 34405,
    "byKind": {
      "transparent": {
        "blocks": 32842,
        "addresses": 28,
        "share": { "pct": 95.46, "numerator": 32842, "denominator": 34405 }
      },
      "shieldedCoinbase": {
        "blocks": 1563,
        "share": { "pct": 4.54, "numerator": 1563, "denominator": 34405 }
      },
      "noAddress": { "blocks": 0, "share": { "pct": 0, "numerator": 0, "denominator": 34405 } },
      "unrecorded": { "blocks": 0, "share": { "pct": 0, "numerator": 0, "denominator": 34405 } }
    },
    "concentration": {
      "top1": { "pct": 29.87, "numerator": 10277, "denominator": 34405 },
      "top3": { "pct": 59.59, "numerator": 20503, "denominator": 34405 },
      "top10": { "pct": 93.85, "numerator": 32288, "denominator": 34405 }
    },
    "miners": [
      {
        "rank": 1,
        "address": "t1MKn34KBa8Xh4g8qU8psibBXvURafphVn7",
        "blocks": 10277,
        "share": { "pct": 29.87, "numerator": 10277, "denominator": 34405 },
        "reward": { "zat": 1287376194246, "zec": "12873.76194246" },
        "fees": { "zat": 2751194246, "zec": "27.51194246" },
        "firstHeight": 3467593,
        "lastHeight": 3501994,
        "newestBlock": { "height": 3501994, "coinbaseTag": "🌸" }
      },
      {
        "rank": 2,
        "address": "t1PEp2GJLSdhDfCKqc2J211WKDUS1NfoQNy",
        "blocks": 5368,
        "share": { "pct": 15.6, "numerator": 5368, "denominator": 34405 },
        "reward": { "zat": 672921562078, "zec": "6729.21562078" },
        "fees": { "zat": 1921562078, "zec": "19.21562078" },
        "firstHeight": 3467605,
        "lastHeight": 3501990,
        "newestBlock": { "height": 3501990, "coinbaseTag": "🌸Mined by zhou106660378H\\\\ ȑ%" }
      },
      {
        "rank": 3,
        "address": "t1SqwRAAdSig6dE4EBPLonAait219VmkUjP",
        "blocks": 4858,
        "share": { "pct": 14.12, "numerator": 4858, "denominator": 34405 },
        "reward": { "zat": 608850277380, "zec": "6088.50277380" },
        "fees": { "zat": 1600277380, "zec": "16.00277380" },
        "firstHeight": 3467596,
        "lastHeight": 3501991,
        "newestBlock": { "height": 3501991, "coinbaseTag": "🦓\\ue83djFoundry Zcash Pool #PrivacyMatters" }
      }
    ],
    "rest": {
      "addresses": 25,
      "blocks": 12339,
      "share": { "pct": 35.86, "numerator": 12339, "denominator": 34405 }
    }
  },
  "unknowns": {},
  "asOf": 1791200000
}`,
      notes: [
        "A payout address is not an operator: one pool can pay to several addresses, so every share and concentration figure is a lower bound. No operator is named; each row carries the coinbase tag of its newest block, as the miner wrote it.",
        "`reward` is everything the miner's coinbase outputs paid it, fees included; `fees` is the part of it that came from fees. Never add the two.",
        "`coinbaseTag` is text the miner wrote into its block. It can say anything, including another pool's name, and proves nothing about who mined.",
        "`noAddress` counts blocks whose miner was paid to a bare public key, which some miners used until 2018 — most blocks of the first two weeks; it has no address form, so those blocks are counted but not grouped.",
      ],
      toolNotes: [
        "A payout address is not an operator: shares are lower bounds and no operator is named. `reward` includes `fees`; never add them. `coinbaseTag` is miner-written text that proves nothing.",
      ],
    },
    {
      id: "analytics-fees",
      method: "GET",
      path: "/v1/analytics/fees",
      title: "What a transaction costs, by privacy kind",
      description:
        "Median and quartile fees paid by transparent, mixed and fully shielded transactions, per day or month, plus one distribution per kind over the trailing 90 days with its mean and sample size.",
      params: [
        {
          name: "from",
          kind: "query",
          type: "YYYY-MM-DD",
          required: false,
          description: "First UTC day, inclusive. Absent means the start of the series.",
          example: "2026-07-01",
        },
        {
          name: "to",
          kind: "query",
          type: "YYYY-MM-DD",
          required: false,
          description: "UTC day the window ends BEFORE (exclusive). Absent means today.",
          example: "2026-10-01",
        },
        {
          name: "interval",
          kind: "query",
          type: "day | month",
          required: false,
          description: "Default month. `day` needs from and to at most 366 days apart.",
        },
        ...RANKING_PARAMS,
      ],
      exampleResponse: `{
  "query": {
    "from": "2026-07-01",
    "to": "2026-10-01",
    "interval": "month"
  },
  "coverage": {
    "status": "complete",
    "notes": []
  },
  "source": {
    "name": "ShieldedScan",
    "url": "https://shieldedscan.xyz/analytics"
  },
  "basis": "fee paid per transaction, coinbase excluded; percentiles are computed over the period's own transactions and must never be averaged across periods",
  "data": {
    "interval": "month",
    "trailing": {
      "days": 90,
      "byKind": {
        "transparent": {
          "median": {
            "zat": 20000,
            "zec": "0.00020000"
          },
          "p25": {
            "zat": 10000,
            "zec": "0.00010000"
          },
          "p75": {
            "zat": 28644,
            "zec": "0.00028644"
          },
          "mean": {
            "zat": 47169,
            "zec": "0.00047169"
          },
          "txs": 286316
        },
        "mixed": {
          "median": {
            "zat": 15000,
            "zec": "0.00015000"
          },
          "p25": {
            "zat": 15000,
            "zec": "0.00015000"
          },
          "p75": {
            "zat": 20000,
            "zec": "0.00020000"
          },
          "mean": {
            "zat": 29297,
            "zec": "0.00029297"
          },
          "txs": 174500
        },
        "fullyShielded": {
          "median": {
            "zat": 15000,
            "zec": "0.00015000"
          },
          "p25": {
            "zat": 10000,
            "zec": "0.00010000"
          },
          "p75": {
            "zat": 20000,
            "zec": "0.00020000"
          },
          "mean": {
            "zat": 23068,
            "zec": "0.00023068"
          },
          "txs": 145802
        }
      }
    },
    "points": [
      {
        "periodStart": "2026-09-01",
        "byKind": {
          "transparent": {
            "median": {
              "zat": 17000,
              "zec": "0.00017000"
            },
            "p25": {
              "zat": 10000,
              "zec": "0.00010000"
            },
            "p75": {
              "zat": 25000,
              "zec": "0.00025000"
            },
            "txs": 153325
          },
          "mixed": {
            "median": {
              "zat": 15000,
              "zec": "0.00015000"
            },
            "p25": {
              "zat": 15000,
              "zec": "0.00015000"
            },
            "p75": {
              "zat": 20000,
              "zec": "0.00020000"
            },
            "txs": 107810
          },
          "fullyShielded": {
            "median": {
              "zat": 10000,
              "zec": "0.00010000"
            },
            "p25": {
              "zat": 10000,
              "zec": "0.00010000"
            },
            "p75": {
              "zat": 20000,
              "zec": "0.00020000"
            },
            "txs": 102027
          }
        }
      }
    ]
  },
  "unknowns": {},
  "asOf": 1791043738
}`,
      notes: [
        "Percentiles are computed over each period's own transactions and must never be averaged across periods: a monthly median is not the median of daily medians.",
        "A kind with no fee-paying transaction in a period is `null` with reason `nonexistent`. Coinbase transactions pay no fee and are excluded.",
      ],
    },
    {
      id: "analytics-ironwood",
      method: "GET",
      path: "/v1/analytics/ironwood",
      title: "Where Ironwood's balance came from",
      description:
        "Ironwood's balance now, and the terms that account for it exactly: net from Orchard, Sapling and Sprout, net shielded from transparent, mined straight into the pool, minus fees paid out of it. Plus how many transactions carried an Ironwood bundle, and how many shielded into it from transparent.",
      params: [],
      exampleResponse: `{
  "query": {},
  "coverage": {
    "status": "complete",
    "notes": []
  },
  "source": {
    "name": "ShieldedScan",
    "url": "https://shieldedscan.xyz/shielded"
  },
  "basis": "every term is the counterparty's own published value balance, netted across every transaction since activation; nothing is apportioned. balance = fromOrchard + fromSapling + fromSprout + fromTransparent + mined − feesPaid",
  "data": {
    "activationHeight": 3428143,
    "readAtHeight": 3505056,
    "balance": {
      "zat": 406001511033807,
      "zec": "4060015.11033807"
    },
    "sources": {
      "fromOrchard": {
        "zat": 325418249281501,
        "zec": "3254182.49281501"
      },
      "fromSapling": {
        "zat": 10616145562846,
        "zec": "106161.45562846"
      },
      "fromSprout": {
        "zat": 0,
        "zec": "0.00000000"
      },
      "fromTransparent": {
        "zat": 69618883303296,
        "zec": "696188.83303296"
      },
      "mined": {
        "zat": 353456321164,
        "zec": "3534.56321164"
      },
      "feesPaid": {
        "zat": 5223435000,
        "zec": "52.23435000"
      }
    },
    "migrated": {
      "zat": 336034394844347,
      "zec": "3360343.94844347"
    },
    "residual": {
      "zat": 0,
      "zec": "0.00000000"
    },
    "transactions": {
      "withIronwoodBundle": 267760,
      "shieldedFromTransparent": 69395
    }
  },
  "unknowns": {},
  "asOf": 1791043751
}`,
      notes: [
        "`residual` is zero by construction and published so the identity can be checked: balance = fromOrchard + fromSapling + fromSprout + fromTransparent + mined − feesPaid.",
        "Each term is a counterparty's own published value balance, netted over every transaction since activation. Nothing is apportioned between pools.",
      ],
    },
    {
      id: "analytics-records",
      method: "GET",
      path: "/v1/analytics/records",
      title: "All-time fee and value records",
      description:
        "The lowest, lowest non-zero and highest fee ever paid by a transaction and by a whole block, and the range of transparent value moved by a single transaction.",
      params: [],
      exampleResponse: `{
  "query": {},
  "coverage": {
    "status": "complete",
    "notes": []
  },
  "source": {
    "name": "ShieldedScan",
    "url": "https://shieldedscan.xyz/charts/median-fee"
  },
  "basis": "coinbase excluded throughout. A record is named only when it is unique (ties = 1). transparentValue covers transactions with a public amount only — never the largest transaction on Zcash, whose shielded amounts are encrypted.",
  "data": {
    "fees": {
      "transaction": {
        "lowest": {
          "amount": {
            "zat": 0,
            "zec": "0.00000000"
          },
          "ties": 61045,
          "txid": null,
          "height": null
        },
        "lowestNonZero": {
          "amount": {
            "zat": 1,
            "zec": "0.00000001"
          },
          "ties": 2464,
          "txid": null,
          "height": null
        },
        "highest": {
          "amount": {
            "zat": 98784262808,
            "zec": "987.84262808"
          },
          "ties": 1,
          "txid": "7a34e0c7bd9a381fa915da188da0a039d32d7d7b9bdec386757f5de2ec35c9d1",
          "height": 3065135
        },
        "considered": 15029728
      },
      "block": {
        "lowest": {
          "amount": {
            "zat": 0,
            "zec": "0.00000000"
          },
          "ties": 770393,
          "height": null
        },
        "lowestNonZero": {
          "amount": {
            "zat": 1,
            "zec": "0.00000001"
          },
          "ties": 436,
          "height": null
        },
        "highest": {
          "amount": {
            "zat": 98784262808,
            "zec": "987.84262808"
          },
          "ties": 1,
          "height": 3065135
        },
        "considered": 3506024
      }
    },
    "transparentValue": {
      "lowest": {
        "amount": {
          "zat": 54,
          "zec": "0.00000054"
        },
        "ties": 12,
        "txid": null,
        "height": null
      },
      "highest": {
        "amount": {
          "zat": 87294301279739,
          "zec": "872943.01279739"
        },
        "ties": 1,
        "txid": "d913e08e76ea94896b7ef20e680b806c3e8864adbbc55e900167fefd8389dd10",
        "height": 2889330
      },
      "considered": 13505114,
      "coveredThroughHeight": 3505923
    }
  },
  "unknowns": {},
  "asOf": 1791117400
}`,
      notes: [
        "A record is named (txid or height) only when it is unique: the lowest fee is 0 with tens of thousands of ties, so naming one would be arbitrary.",
        '`transparentValue` covers transactions with a public amount only — never "the largest transaction on Zcash", whose shielded amounts are encrypted.',
      ],
    },
  ],
};
