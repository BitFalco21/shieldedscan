import type { ApiGroup } from "../types";

export const REORGS_GROUP: ApiGroup = {
  id: "reorgs",
  label: "Reorgs",
  endpoints: [
    {
      id: "reorgs-list",
      method: "GET",
      path: "/v1/reorgs",
      title: "Observed reorganisations",
      description:
        "Chain reorganisations this explorer's node detected and rolled back, with both hashes captured at the rollback: the orphaned hash survives nowhere else. Observed only; there is no way to report one.",
      params: [
        {
          name: "limit",
          kind: "query",
          type: "integer ≤ 100",
          required: false,
          description: "Page size. Default 25.",
        },
        {
          name: "cursor",
          kind: "query",
          type: "cursor",
          required: false,
          description: "Next page: hand back the nextCursor you were given.",
        },
        {
          name: "before",
          kind: "query",
          type: "cursor",
          required: false,
          description: "Page older.",
        },
        {
          name: "after",
          kind: "query",
          type: "cursor",
          required: false,
          description: "Page newer.",
        },
      ],
      exampleResponse: `{
  "items": [
    {
      "detectedAt": 1753740012,
      "height": 3429102,
      "depth": 1,
      "orphanedHash": "0000000001a7c9…",
      "replacedBy": "00000000009f21…"
    }
  ],
  "nextCursor": null,
  "prevCursor": null
}`,
      notes: ["`orphanedHash` is no longer in the chain — do not build a block link from it."],
    },
    {
      id: "reorgs-summary",
      method: "GET",
      path: "/v1/reorgs/summary",
      title: "Reorg observation summary",
      description:
        "Reorg counts, with the scope that bounds them: one node polling every 5 seconds misses orphans that live and die between polls.",
      params: [],
      exampleResponse: `{
  "scope": {
    "basis": "observed",
    "observer": "single-node",
    "networkCensus": false,
    "observingSince": 1753632000,
    "pollIntervalSeconds": 5,
    "detectionLimit": "a block orphaned and replaced between two polls is never observed; depth-1 reorgs are routine on proof of work"
  },
  "observedCount": 3,
  "deepestDepth": 2,
  "asOf": 1753795200
}`,
    },
  ],
};
