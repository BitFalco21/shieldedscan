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
        "Every labelled transparent address: its name, whose claim it is (`source`: Arkham's entity labels, or a theft investigator), balance and rank.",
      params: [],
      exampleResponse: `{
  "notice": "An \`entity\` name is a third-party attribution, repeated as its source states it and not verified by this explorer; …",
  "count": 64,
  "labels": [
    {
      "address": "t3aPMe94jMKyrgkbH5SSukimvdMFJ59EFhP",
      "name": "Gemini Cold Wallet",
      "basis": "external",
      "category": "entity",
      "miningPool": null,
      "source": "Arkham entity labels (intel.arkm.com), read 2026-08-21",
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
      "source": "ZachXBT on X, 2026-09-30 (Bitget exploit; flows checked against /v1)",
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
      "source": "reviewed by this explorer",
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
          type: "binance | coinbase | gemini | kraken",
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
