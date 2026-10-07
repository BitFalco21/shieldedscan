import type { ApiGroup } from "../types";

export const SUPPLY_GROUP: ApiGroup = {
  id: "supply",
  label: "Supply & pools",
  endpoints: [
    {
      id: "supply",
      method: "GET",
      path: "/v1/supply",
      title: "The six-pool supply accounting",
      description:
        "Every ZEC in existence in its six value pools: the four shielded pools, transparent, and the NU6 lockbox, which holds mined ZEC that cannot circulate. The rows sum to the total by consensus, and `heightReadAt` names the block every figure was read at.",
      params: [],
      exampleResponse: `{
  "heightReadAt": 3429381,
  "maxSupplyZat": 2100000000000000,
  "minedZat": 1610764103561234,
  "unminedZat": 489235896438766,
  "shieldedZat": 43960212983561,
  "shieldedZatExcludes": ["lockbox"],
  "pools": [
    { "pool": "transparent", "balanceZat": 1560003890577673, "shielded": false, "spendable": true, "shareOfShielded": null },
    { "pool": "orchard", "balanceZat": 36121002983561, "shielded": true, "spendable": true,
      "shareOfShielded": { "pct": 82.17, "numerator": 36121002983561, "denominator": 43960212983561 } },
    { "pool": "lockbox", "balanceZat": 6800000000000, "shielded": false, "spendable": false, "shareOfShielded": null }
  ],
  "partitionComplete": true,
  "asOf": 1753795200
}`,
    },
    {
      id: "circulating",
      method: "GET",
      path: "/v1/supply/circulating",
      title: "Circulating supply, aggregator-ready",
      description:
        "A bare ZEC decimal over plain text by default — the format CoinGecko-style aggregators consume. `?format=json` returns the structured form, which names what the figure excludes rather than implying it: the NU6 lockbox is mined but unspendable, so it is not circulating.",
      params: [
        {
          name: "format",
          kind: "query",
          type: '"json"',
          required: false,
          description: "Omit for a plain text number; `json` for the structured envelope.",
          example: "json",
        },
      ],
      exampleResponse: `{
  "circulatingZat": 1684825182604480,
  "circulatingZec": "16848251.82604480",
  "heightReadAt": 3429543,
  "excludes": ["lockbox"],
  "asOf": 1753795200
}`,
      notes: [
        "Without `format=json` the body is just the decimal — e.g. `16848251.82604480` — with all eight places, zatoshi-exact.",
      ],
    },
  ],
};
