import type { ApiGroup } from "../types";

export const NODES_GROUP: ApiGroup = {
  id: "nodes",
  label: "Network nodes",
  endpoints: [
    {
      id: "nodes-summary",
      method: "GET",
      path: "/v1/nodes",
      title: "The network's listening nodes, counted",
      description:
        "How many Zcash nodes answered our crawler in the last day, how many addresses the network has ever advertised, IPv6 and Tor counts, countries and network operators, and the client, version and protocol-version mix — the figures behind /network.",
      params: [],
      exampleResponse: `{
  "coverage": {
    "status": "floor",
    "notes": [
      "Counts only nodes that accept incoming connections; nodes behind a router cannot be crawled, so the real network is larger."
    ]
  },
  "source": {
    "name": "ShieldedScan",
    "url": "https://shieldedscan.xyz/network"
  },
  "data": {
    "answeringWindowSeconds": 86400,
    "answering": 157,
    "knownAddresses": 5109,
    "everAnswered": 646,
    "neverAnswered": 4463,
    "ipv6": {
      "known": 617,
      "answering": 22
    },
    "torKnown": 697,
    "countries": 28,
    "networkOperators": 56,
    "clients": [
      {
        "client": "Zebra",
        "share": {
          "pct": 52.23,
          "numerator": 82,
          "denominator": 157
        }
      },
      {
        "client": "Zakura",
        "share": {
          "pct": 45.86,
          "numerator": 72,
          "denominator": 157
        }
      },
      {
        "client": "zcashd",
        "share": {
          "pct": 1.91,
          "numerator": 3,
          "denominator": 157
        }
      }
    ],
    "versions": [
      {
        "client": "Zebra",
        "version": "6.4.2",
        "nodes": 36
      },
      {
        "client": "Zakura",
        "version": "1.6.0",
        "nodes": 35
      },
      {
        "client": "Zebra",
        "version": "6.3.0",
        "nodes": 22
      }
    ],
    "protocolVersions": [
      {
        "protocolVersion": 170160,
        "nodes": 81
      },
      {
        "protocolVersion": 170190,
        "nodes": 63
      }
    ],
    "crawls": {
      "count": 2422,
      "firstStartedAt": 1788697919,
      "lastFinishedAt": 1791116718,
      "intervalSeconds": 999
    }
  },
  "notes": [
    "A node is answering when it completed a handshake with our crawler within answeringWindowSeconds.",
    "A user agent is the node's own claim about its software and is not verified."
  ],
  "asOf": 1791117392
}`,
      notes: [
        "A crawler only reaches nodes that accept incoming connections, so every count is a lower bound (`coverage.status` is `floor`).",
        "A user agent is the node's own claim about its software and is not verified.",
      ],
    },
    {
      id: "nodes-list",
      method: "GET",
      path: "/v1/nodes/list",
      title: "Every answering node",
      description:
        "One row per node that answered in the last day: client, version, protocol version, network, GeoIP location and operator, a crawler-relative ping, and how many of our crawls it answered. No address is published; `id` is a one-way hash.",
      params: [
        {
          name: "client",
          kind: "query",
          type: "string",
          required: false,
          description:
            "A user-agent family, e.g. Zebra, Zakura, zcashd. An unknown but well-formed one returns an empty page.",
        },
        {
          name: "asn",
          kind: "query",
          type: "integer",
          required: false,
          description: "An autonomous system number.",
        },
        {
          name: "limit",
          kind: "query",
          type: "1–100",
          required: false,
          description: "Page size, default 25.",
        },
        {
          name: "cursor",
          kind: "query",
          type: "string",
          required: false,
          description: "`nextCursor` from the previous page.",
        },
      ],
      exampleResponse: `{
  "coverage": {
    "status": "floor",
    "notes": [
      "Counts only nodes that accept incoming connections; nodes behind a router cannot be crawled, so the real network is larger."
    ]
  },
  "source": {
    "name": "ShieldedScan",
    "url": "https://shieldedscan.xyz/network/nodes"
  },
  "applied": {
    "client": null,
    "asn": null
  },
  "order": "crawls answered as a share of crawls attempted, highest first; ties by id",
  "items": [
    {
      "id": "8d59d7ea1e18",
      "client": "Zakura",
      "version": "1.5.0",
      "protocolVersion": 170190,
      "network": "ipv4",
      "country": "United Kingdom",
      "city": "Bexley",
      "asn": 16276,
      "networkOperator": "OVH SAS",
      "pingMs": 122,
      "crawlsAnswered": {
        "answered": 233,
        "attempted": 233
      },
      "firstSeen": 1790794485,
      "lastAnswered": 1791116420
    },
    {
      "id": "4cc95c6a67eb",
      "client": "Zakura",
      "version": "1.5.0",
      "protocolVersion": 170190,
      "network": "ipv6",
      "country": "United Kingdom",
      "city": "Brentford",
      "asn": 16276,
      "networkOperator": "OVH SAS",
      "pingMs": 122,
      "crawlsAnswered": {
        "answered": 230,
        "attempted": 230
      },
      "firstSeen": 1790797851,
      "lastAnswered": 1791116640
    }
  ],
  "nextCursor": "MTAwMDB8MDVlYjY1MjFlM2U0",
  "prevCursor": null,
  "notes": [
    "id is a one-way hash; no address is published.",
    "pingMs is a handshake round trip from our crawler in Vienna — a fact about that path, not about the node.",
    "crawlsAnswered mostly reflects whether the node accepted OUR crawler's connection (many nodes accept one connection per address, and ours is shared with our own node); it is not a reliability score.",
    "country, city and network operator are GeoIP's claim about the address, not a measurement."
  ],
  "asOf": 1791117394
}`,
      notes: [
        "`crawlsAnswered` mostly reflects whether the node accepted our crawler's connection; it is not a reliability score.",
        "`pingMs` is measured from our crawler in Vienna and describes that path, not the node.",
      ],
    },
    {
      id: "nodes-geography",
      method: "GET",
      path: "/v1/nodes/geography",
      title: "Where the nodes are",
      description:
        "Answering nodes by country, and on a 1° grid with each cell's modal city, country and client mix; plus the advertised addresses that did not answer, bucketed the same way.",
      params: [],
      exampleResponse: `{
  "coverage": {
    "status": "floor",
    "notes": [
      "Counts only nodes that accept incoming connections; nodes behind a router cannot be crawled, so the real network is larger."
    ]
  },
  "source": {
    "name": "ShieldedScan",
    "url": "https://shieldedscan.xyz/network/map"
  },
  "data": {
    "countries": [
      {
        "country": "United States",
        "nodes": 55
      },
      {
        "country": "Germany",
        "nodes": 24
      },
      {
        "country": "France",
        "nodes": 12
      }
    ],
    "unplaced": 0,
    "cellDegrees": 1,
    "cells": [
      {
        "lat": 48.5,
        "lon": 2.5,
        "nodes": 7,
        "country": "France",
        "city": "Aubervilliers",
        "clients": [
          {
            "client": "Zebra",
            "nodes": 5
          },
          {
            "client": "Zakura",
            "nodes": 2
          }
        ]
      }
    ],
    "notAnswering": {
      "total": 4952,
      "cells": [
        {
          "lat": 32.5,
          "lon": -96.5,
          "addresses": 397
        }
      ]
    }
  },
  "notes": [
    "A location is GeoIP's claim about an address, never a measurement; a node GeoIP could not place is counted in unplaced and drawn nowhere.",
    "notAnswering counts advertised addresses that did not complete a handshake within the answering window."
  ],
  "asOf": 1791117392
}`,
      notes: [
        "A location is GeoIP's claim about an address, never a measurement. Nodes GeoIP could not place are counted in `unplaced` and drawn nowhere.",
      ],
    },
    {
      id: "nodes-concentration",
      method: "GET",
      path: "/v1/nodes/concentration",
      title: "How concentrated the hosting is",
      description:
        "The network operators hosting the most answering nodes, the share held by the top three, and /24 subnets holding more than one node.",
      params: [],
      exampleResponse: `{
  "coverage": {
    "status": "floor",
    "notes": [
      "Counts only nodes that accept incoming connections; nodes behind a router cannot be crawled, so the real network is larger."
    ]
  },
  "source": {
    "name": "ShieldedScan",
    "url": "https://shieldedscan.xyz/network/health"
  },
  "data": {
    "topNetworkOperators": [
      {
        "asn": 396982,
        "networkOperator": "Google LLC",
        "share": {
          "pct": 14.01,
          "numerator": 22,
          "denominator": 157
        }
      },
      {
        "asn": 16276,
        "networkOperator": "OVH SAS",
        "share": {
          "pct": 10.83,
          "numerator": 17,
          "denominator": 157
        }
      },
      {
        "asn": 14061,
        "networkOperator": "DigitalOcean, LLC",
        "share": {
          "pct": 7.64,
          "numerator": 12,
          "denominator": 157
        }
      }
    ],
    "topThreeOperators": {
      "pct": 32.48,
      "numerator": 51,
      "denominator": 157
    },
    "clusteredSubnets": [
      {
        "subnet": "154.21.212.x",
        "nodes": 4
      }
    ]
  },
  "notes": [
    "Grouped by autonomous system, never clustered into operators: two networks run by one company count separately, so real concentration can only be higher.",
    "A subnet is a /24, written a.b.c.x; the last octet is never published."
  ],
  "asOf": 1791117392
}`,
      notes: [
        "Grouped by autonomous system, never clustered into companies, so the real concentration can only be higher.",
        "A subnet is written a.b.c.x: the last octet is never published.",
      ],
    },
  ],
};
