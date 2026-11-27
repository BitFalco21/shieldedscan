import type { ApiGroup } from "../types";

export const RICH_LIST_GROUP: ApiGroup = {
  id: "rich-list",
  label: "Rich list",
  endpoints: [
    {
      id: "rich-list",
      method: "GET",
      path: "/v1/rich-list",
      title: "Every transparent address holding ZEC",
      description:
        "Every transparent address with a positive balance, largest first. A balance is `sum(outputs) − sum(inputs)` over the chain index, exact to the zatoshi.",
      params: [
        {
          name: "limit",
          kind: "query",
          type: "integer",
          required: false,
          description: "Rows per page, 1–100. Default 25.",
          example: "3",
        },
        {
          name: "cursor",
          kind: "query",
          type: "cursor",
          required: false,
          description: "Page further down the list (comes back as nextCursor).",
        },
        {
          name: "before",
          kind: "query",
          type: "cursor",
          required: false,
          description: "The same as cursor — pass one or the other, never both.",
        },
        {
          name: "after",
          kind: "query",
          type: "cursor",
          required: false,
          description: "Page back up the list (comes back as prevCursor).",
        },
      ],
      exampleResponse: `{
  "items": [
    {
      "rank": 1,
      "address": "t3aPMe94jMKyrgkbH5SSukimvdMFJ59EFhP",
      "balanceZat": 43892089655000,
      "receivedZat": 131983444555000,
      "firstHeight": 2041451,
      "lastHeight": 3442107,
      "txCount": 100
    }
  ],
  "nextCursor": "Mzg2ODQ2MzIwMjUwMDB8dDFjcEMzU1M4b2tVc01Rd1RxV2d6eUExazIzN0IzV0NlY28",
  "prevCursor": null,
  "height": 3449725,
  "asOf": 1786873631
}`,
      notes: [
        "Shielded value is absent by construction: this is the transparent share of supply and says nothing about who holds ZEC privately.",
        "`height` is the height the BALANCES cover, not the chain tip — figures are dated by when they were computed, never by when you asked.",
        '`txCount` counts transactions the address appears in, either side, once per transaction. It is `null` on rows a backfill has not reached, with `unknowns.txCount: "unmeasured"` beside it — never 0, which is a value the truth cannot take for an address holding a balance.',
        "No label on a row and no entity grouping. One address is one address: an exchange holds thousands and one address holds thousands of people's coins. The addresses this explorer names are at `/v1/labels`, each with its source.",
      ],
      toolNotes: [
        "`height` is the height the balances cover, not the tip. `txCount` is null (`unmeasured`) on rows not yet backfilled, never 0.",
        "No labels and no grouping: one address is one address, never one owner.",
      ],
    },
    {
      id: "labels",
      method: "GET",
      path: "/v1/labels",
      title: "The addresses this explorer names",
      description:
        "Every labelled transparent address: its name, balance and rank, and for a theft label the investigator who flagged it.",
      params: [],
      exampleResponse: `{
  "notice": "An \`entity\` name is a third-party attribution, repeated and not verified by this explorer; …",
  "count": 64,
  "labels": [
    {
      "address": "t3aPMe94jMKyrgkbH5SSukimvdMFJ59EFhP",
      "name": "Gemini Cold Wallet",
      "basis": "external",
      "category": "entity",
      "miningPool": null,
      "flag": null,
      "balanceZat": 43892090013445,
      "rank": 1
    },
    {
      "address": "t1SyhmRJ35RpGsyuLArsPLepyoiLcawLia5",
      "name": "DPRK attackers",
      "basis": "external",
      "category": "entity",
      "miningPool": null,
      "flag": { "by": "ZachXBT", "url": "https://t.me/investigations/364" },
      "balanceZat": 0,
      "rank": null,
      "unknowns": { "rank": "nonexistent" }
    },
    {
      "address": "t1MKn34KBa8Xh4g8qU8psibBXvURafphVn7",
      "name": "ViaBTC",
      "basis": "pool-published",
      "category": "mining-pool",
      "miningPool": { "id": "viabtc", "name": "ViaBTC" },
      "flag": null,
      "balanceZat": 0,
      "rank": null,
      "unknowns": { "rank": "nonexistent" }
    }
  ],
  "rankHeight": 3511859,
  "asOf": 1791555000
}`,
      notes: [
        'A name is someone\'s claim about a real company or person, not a chain fact. `source` says whose, and `basis: "external"` that this explorer repeats it without verifying it. The `notice` on every response says the same, so the names never travel without it.',
        "A label covers exactly its address. Never extend it to an address that sent to or received from a labelled one, and never total a label's addresses as one owner's holdings without saying they are the labelled addresses only.",
        'A `category: "mining-pool"` label names a pool\'s payout address after the pool, from this explorer\'s review of the pool\'s own data (`basis: "pool-published"`) or its own coinbase marker (`basis: "coinbase-tag"`). It names the pool, never the miners it pays.',
        "`balanceZat` is current and transparent only; `rank` is as of `rankHeight`, the height the rich list's balances cover, never the tip. A null rank carries its reason: `nonexistent` means the address holds nothing, `unmeasured` that the list could not be read.",
      ],
      toolNotes: ["Third-party names, not verified here; one label, one address."],
    },
    {
      id: "exchange-reserves",
      method: "GET",
      path: "/v1/labels/exchanges",
      title: "ZEC on exchanges' labelled addresses",
      description:
        "ZEC on each exchange's labelled transparent addresses per day or month, at the period's highest block, and the window's change.",
      params: [
        {
          name: "from",
          kind: "query",
          type: "YYYY-MM-DD",
          required: false,
          description: "First UTC day.",
          example: "2026-10-01",
        },
        {
          name: "to",
          kind: "query",
          type: "YYYY-MM-DD",
          required: false,
          description: "Day the window ends before.",
        },
        {
          name: "interval",
          kind: "query",
          type: "day | month",
          required: false,
          description: "Default month; day: at most 366 days.",
        },
        {
          name: "exchange",
          kind: "query",
          type: "binance | coinbase | gemini | kraken | okx | kucoin | bitget | gate",
          required: false,
          description: "One exchange.",
        },
        {
          name: "addresses",
          kind: "query",
          type: "boolean",
          required: false,
          description: "Add each address.",
        },
      ],
      exampleResponse: `{
  "query": { "from": "2026-10-01", "to": null, "interval": "month",
             "exchange": "binance", "addresses": false },
  "coverage": { "status": "partial",
                "notes": ["The last point is today's unfinished UTC day, read at the newest block."] },
  "source": { "name": "ShieldedScan", "url": "https://shieldedscan.xyz/charts/exchange-reserves" },
  "basis": "transparent ZEC on each exchange's labelled addresses at the period's highest block; …",
  "exchanges": [{ "id": "binance", "name": "Binance", "addresses": 5 }],
  "data": {
    "interval": "month",
    "points": [
      {
        "periodStart": "2026-10-01",
        "closing": { "day": "2026-10-31", "height": 3521874 },
        "exchanges": { "binance": { "zat": 21360981740112, "zec": "213609.81740112" } },
        "total": { "zat": 21360981740112, "zec": "213609.81740112" }
      }
    ],
    "change": {
      "from": { "day": "2026-09-30", "height": 3500813 },
      "to": { "day": "2026-10-31", "height": 3521874 },
      "exchanges": { "binance": { "zat": -1104230000000, "zec": "-11042.3" } },
      "total": { "zat": -1104230000000, "zec": "-11042.3" }
    }
  },
  "unknowns": {},
  "asOf": 1793232000
}`,
      notes: [
        "Grouping addresses by exchange is this explorer's own, from the labels at `/v1/labels`: each exchange's total sums the labelled addresses `exchanges[].addresses` counts, never its unlabelled wallets, so it is not the exchange's holdings. Bridges, funds and theft-flagged addresses are not counted.",
        "A balance is a level: never add points together. `data.change` is the window's last close minus the close of the day before the window (or of its first day when nothing precedes it).",
        "An exchange reads `null` where one of its addresses is not computed yet, with `unmeasured` in `unknowns`. `addresses=true` adds each address's balance at the last close and its change; the daily per-address series is the open dataset's `address_balance_daily`.",
      ],
      toolNotes: [
        "Labelled addresses only, grouped by this explorer: not an exchange's holdings. Never sum points.",
      ],
    },
    {
      id: "exchange-flows",
      method: "GET",
      path: "/v1/labels/exchanges/flows",
      title: "ZEC into and out of exchanges",
      description:
        "ZEC into and out of each exchange's labelled transparent addresses per day or month: where it came from or went.",
      params: [
        {
          name: "from",
          kind: "query",
          type: "YYYY-MM-DD",
          required: false,
          description: "First UTC day.",
          example: "2026-10-01",
        },
        {
          name: "to",
          kind: "query",
          type: "YYYY-MM-DD",
          required: false,
          description: "Day the window ends before.",
        },
        {
          name: "interval",
          kind: "query",
          type: "day | month",
          required: false,
          description: "Default month; day: at most 366 days.",
        },
        {
          name: "exchange",
          kind: "query",
          type: "binance | coinbase | gemini | kraken | okx | kucoin | bitget | gate",
          required: false,
          description: "One exchange.",
        },
      ],
      exampleResponse: `{
  "query": {
    "from": "2026-10-01",
    "to": "2026-11-01",
    "interval": "month",
    "exchange": "binance"
  },
  "coverage": {
    "status": "complete",
    "notes": []
  },
  "source": {
    "name": "ShieldedScan",
    "url": "https://shieldedscan.xyz/rich-list"
  },
  "basis": "ZEC paid to each exchange's labelled transparent addresses minus ZEC spent from them, per transaction, …",
  "exchanges": [
    {
      "id": "binance",
      "name": "Binance"
    }
  ],
  "data": {
    "interval": "month",
    "counted": {
      "from": "2026-10-01",
      "to": "2026-10-31"
    },
    "totals": {
      "exchanges": {
        "binance": {
          "in": {
            "txs": 954,
            "value": { "zat": 48987598756834, "zec": "489875.98756834" },
            "parts": [
              { "kind": "transparent", "value": { "zat": 48987598756834, "zec": "489875.98756834" } }
            ]
          },
          "out": {
            "txs": 6073,
            "value": { "zat": 43994702168312, "zec": "439947.02168312" },
            "parts": [
              { "kind": "transparent", "value": { "zat": 40236188946685, "zec": "402361.88946685" } },
              { "kind": "exchange", "exchange": "kraken", "value": { "zat": 19686528, "zec": "0.19686528" } },
              { "kind": "bridge", "value": { "zat": 3758407000000, "zec": "37584.07000000" } },
              { "kind": "fee", "value": { "zat": 86535099, "zec": "0.86535099" } }
            ]
          },
          "internal": {
            "txs": 19,
            "fee": { "zat": 7470140, "zec": "0.07470140" }
          }
        }
      }
    },
    "points": [
      {
        "periodStart": "2026-10-01",
        "exchanges": {
          "binance": {
            "in": { "zat": 48987598756834, "zec": "489875.98756834" },
            "out": { "zat": 43994702168312, "zec": "439947.02168312" },
            "inTxs": 954,
            "outTxs": 6073
          }
        }
      }
    ]
  },
  "unknowns": {},
  "asOf": 1795818024
}`,
      notes: [
        "A flow is what one transaction paid an exchange's labelled addresses minus what it spent from them, so change returned to the exchange cancels out. Its shielded wallets and unlabelled deposit addresses are not seen: a deposit to an unlabelled deposit address shows when it is swept into a labelled wallet.",
        "`parts` say where value came from (`in`) or went (`out`): `transparent` (unlabelled addresses), `shielded` (a shielded pool), `mined`, `exchange` (another exchange, named), `bridge`, `other-labelled`, and on an outflow the exchange paid alone, `fee`. Where parties on both sides make the split unknowable it is `mixed`, so every other kind is a floor.",
        "`internal` is moves between one exchange's own wallets, with the fees they paid: `in − out − internal.fee` is the change in its `/v1/labels/exchanges` reserves. `txs` counts transactions, not customers: one sweep of many deposits is one.",
        "A move between two exchanges counts as one's `out` and the other's `in`; `allExchanges` leaves it out and states it as `betweenExchanges`. Only whole days are counted, each once every block in it is 100 blocks deep; `data.counted` names them.",
      ],
      toolNotes: [
        "Labelled addresses only; deposits show when swept. Kinds besides `mixed` are floors.",
      ],
    },
    {
      id: "exchange-movements",
      method: "GET",
      path: "/v1/labels/exchanges/movements",
      title: "Largest exchange movements",
      description: "The largest single flows into or out of the exchanges' labelled addresses.",
      params: [
        {
          name: "from",
          kind: "query",
          type: "YYYY-MM-DD",
          required: false,
          description: "First UTC day.",
          example: "2026-10-01",
        },
        {
          name: "to",
          kind: "query",
          type: "YYYY-MM-DD",
          required: false,
          description: "Day the window ends before.",
        },
        {
          name: "exchange",
          kind: "query",
          type: "binance | coinbase | gemini | kraken | okx | kucoin | bitget | gate",
          required: false,
          description: "One exchange.",
        },
        {
          name: "direction",
          kind: "query",
          type: "in | out",
          required: false,
          description: "Inflows or outflows only.",
        },
        {
          name: "limit",
          kind: "query",
          type: "1-25",
          required: false,
          description: "Default 10.",
        },
      ],
      exampleResponse: `{
  "query": {
    "from": "2026-10-01",
    "to": "2026-11-01",
    "exchange": null,
    "direction": null,
    "limit": 2
  },
  "coverage": {
    "status": "complete",
    "notes": []
  },
  "source": {
    "name": "ShieldedScan",
    "url": "https://shieldedscan.xyz/rich-list"
  },
  "basis": "ZEC paid to each exchange's labelled transparent addresses minus ZEC spent from them, per transaction, …",
  "items": [
    {
      "txid": "cb96ca59d1b6919664205ead7ad869e0b129d0d9509f78340a161ae7c452756b",
      "exchange": "kraken",
      "direction": "in",
      "value": { "zat": 2004552566721, "zec": "20045.52566721" },
      "height": 3510758,
      "timestamp": 1791472886,
      "day": "2026-10-08",
      "parts": [
        { "kind": "transparent", "value": { "zat": 2004552566721, "zec": "20045.52566721" } }
      ]
    },
    {
      "txid": "962e1e2485ffd1a675810f205152c1739075be5e7f3ac5ad21bc6e5ce0f0dfd1",
      "exchange": "coinbase",
      "direction": "out",
      "value": { "zat": 1485802568575, "zec": "14858.02568575" },
      "height": 3509677,
      "timestamp": 1791391793,
      "day": "2026-10-07",
      "parts": [
        { "kind": "transparent", "value": { "zat": 1485801568575, "zec": "14858.01568575" } },
        { "kind": "fee", "value": { "zat": 1000000, "zec": "0.01000000" } }
      ]
    }
  ],
  "asOf": 1795818016
}`,
      notes: [
        "A ranking, bounded rather than paged. A move between two exchanges is listed once for each.",
      ],
      toolNotes: ["A move between two exchanges is listed for each."],
    },
    {
      id: "rich-list-distribution",
      method: "GET",
      path: "/v1/rich-list/distribution",
      title: "How transparent value is spread",
      description:
        "Transparent balances in bands by powers of ten, and the share held by the top 10, 100 and 1,000 addresses. No inequality coefficient: an address is not an owner.",
      params: [],
      exampleResponse: `{
  "height": 3449725,
  "addressCount": 843050,
  "totalZat": 1243590756159647,
  "unattributedZat": 79849217432,
  "bands": [
    {
      "fromZat": 1000000000000,
      "addresses": 159,
      "totalZat": 486141041985734,
      "share": { "pct": 39.09, "numerator": 486141041985734,
                 "denominator": 1243590756159647 }
    }
  ],
  "topHolders": [
    {
      "count": 10,
      "totalZat": 280040145486233,
      "share": { "pct": 22.52, "numerator": 280040145486233,
                 "denominator": 1243590756159647 }
    }
  ],
  "asOf": 1786873638
}`,
      notes: [
        "Every share's denominator is TRANSPARENT value, never circulating supply — the two differ by about a third, and a bare percentage gets read against the larger one. That is why each share carries its denominator rather than a naked pct.",
        "`unattributedZat` is transparent value belonging to no single address: bare-pubkey outputs, OP_RETURN, multisig. It is carried rather than rounded away because it is almost all of the gap between `totalZat` and the node's transparent value pool.",
        "Reconcile at a FIXED height. These figures and a pool balance read a minute later drift apart at the block rate, which manufactures tens of ZEC of apparent error out of nothing but elapsed time.",
      ],
      toolNotes: [
        "Every share's denominator is transparent value, not circulating supply. `unattributedZat` is transparent value no single address holds (bare-pubkey outputs, OP_RETURN, multisig).",
      ],
    },
  ],
};
