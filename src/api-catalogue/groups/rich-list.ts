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
        "Every transparent address with a positive balance, largest first. A balance is `sum(outputs) − sum(inputs)` over the chain index, exact to the zatoshi. Shielded value is absent by construction: this is the transparent share of supply and says nothing about who holds ZEC privately.",
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
        "`height` is the height the BALANCES cover, not the chain tip — figures are dated by when they were computed, never by when you asked.",
        '`txCount` counts transactions the address appears in, either side, once per transaction. It is `null` on rows a backfill has not reached, with `unknowns.txCount: "unmeasured"` beside it — never 0, which is a value the truth cannot take for an address holding a balance.',
        "No labels and no entity grouping. One address is one address: an exchange holds thousands and one address holds thousands of people's coins, so 'this entity's wallets' is a claim this API does not make.",
      ],
      toolNotes: [
        "`height` is the height the balances cover, not the tip. `txCount` is null (`unmeasured`) on rows not yet backfilled, never 0.",
        "No labels and no grouping: one address is one address, never one owner.",
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
