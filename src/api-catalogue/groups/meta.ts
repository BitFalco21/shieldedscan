import type { ApiGroup } from "../types";

export const META_GROUP: ApiGroup = {
  id: "meta",
  label: "Meta",
  endpoints: [
    {
      id: "descriptor",
      method: "GET",
      path: "/v1",
      title: "API descriptor",
      description:
        "The machine-readable index: every endpoint, every convention, and every refusal — what this API deliberately does not answer.",
      params: [],
      exampleResponse: `{
  "name": "shieldedscan public API",
  "version": "1.0.0-beta",
  "keyless": true,
  "conventions": {
    "amounts": "integer zatoshis in *_Zat fields; 1 ZEC = 100,000,000 zat",
    "unknownReasons": ["shielded", "unmeasured", "omitted", "nonexistent", "indeterminate"],
    "pagination": "opaque keyset cursors (nextCursor/prevCursor); no totals, no page numbers"
  },
  "endpoints": ["GET /v1", "GET /v1/status", "GET /v1/supply", "..."],
  "refused": [
    {
      "path": "viewing-key anything",
      "reason": "a viewing key reveals an entire transaction history; there is no endpoint, no stub, no 501"
    }
  ],
  "asOf": 1753795200
}`,
    },
    {
      id: "status",
      method: "GET",
      path: "/v1/status",
      title: "Chain and service status",
      description:
        "Tip height, supply, price and 24h activity. The price and 24h figures come from pollers that can be cold — when they are, the keys are still present, null, with `unmeasured` reasons. An absent key and an explicit null behave oppositely under a spread; this API never makes you discover that.",
      params: [],
      exampleResponse: `{
  "height": 3429381,
  "bestBlockHash": "00000000011f4b…",
  "lastBlockTimestamp": 1753795125,
  "circulatingSupplyZat": 1610764103561234,
  "priceUsd": null,
  "priceChange24hPct": null,
  "txCount24h": 8412,
  "fullyShieldedPct24h": { "pct": 21.4, "numerator": 1800, "denominator": 8412 },
  "crosschain": {
    "venues": [
      { "protocol": "maya", "enabled": true, "live": true },
      { "protocol": "thorchain", "enabled": true, "live": true },
      { "protocol": "near-intents", "enabled": true, "live": true }
    ]
  },
  "unknowns": { "priceUsd": "unmeasured", "priceChange24hPct": "unmeasured" },
  "asOf": 1753795200
}`,
    },
  ],
};
