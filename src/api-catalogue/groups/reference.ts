import type { ApiGroup } from "../types";

export const REFERENCE_GROUP: ApiGroup = {
  id: "reference",
  label: "Reference",
  endpoints: [
    {
      id: "reference",
      method: "GET",
      path: "/v1/reference",
      title: "Glossary and Zcash reference",
      description:
        "A glossary of this API's terms, and facts about Zcash transcribed from primary sources, each with its source and the day it was read. Committed text, not measured from the chain. Ironwood activated on 2026-07-28, after most AI models' training ended: an assistant should read this before answering a protocol question from memory.",
      params: [
        {
          name: "topic",
          kind: "query",
          type: "glossary | ceremonies | cryptography | history | addresses | privacy | consensus | economics | governance | roadmap",
          required: false,
          description: "Absent: the list of topics and the glossary.",
          example: "roadmap",
        },
      ],
      exampleResponse: `{
  "topics": [
    {
      "name": "glossary",
      "entries": 18,
      "about": "This API's own vocabulary."
    },
    {
      "name": "ceremonies",
      "entries": 4,
      "about": "Zcash's trusted-setup ceremonies: who took part, and which pools needed one."
    },
    {
      "name": "cryptography",
      "entries": 2,
      "about": "The proving system behind each shielded pool, and what changed between them."
    },
    {
      "name": "history",
      "entries": 7,
      "about": "Dated past events: launch, the pool activations, the network upgrades and the 2018 counterfeiting vulnerability, with its fix."
    },
    {
      "name": "addresses",
      "entries": 2,
      "about": "Zcash address types, and what an address does and does not reveal."
    },
    {
      "name": "privacy",
      "entries": 2,
      "about": "The encrypted memo field, and what a viewing key exposes."
    },
    {
      "name": "consensus",
      "entries": 4,
      "about": "How proof of work, the block target and network upgrades are defined: Equihash and its parameters, Blossom's 75-second blocks, activation by height."
    },
    {
      "name": "economics",
      "entries": 4,
      "about": "How the block subsidy has been split between the miner, the funding streams and the lockbox, era by era."
    },
    {
      "name": "governance",
      "entries": 2,
      "about": "How Zcash changes: the ZIP process and the organisations named in it."
    },
    {
      "name": "roadmap",
      "entries": 8,
      "about": "What Zcash is proposing rather than running: NU7, the coinholder vote on its scope, the issuance proposals and Project Tachyon."
    }
  ],
  "glossary": [
    {
      "term": "zatoshi",
      "definition": "The smallest unit: 1 ZEC = 100,000,000 zatoshis. Every amount field ending in \`Zat\` is an integer number of them."
    },
    {
      "term": "transparent",
      "definition": "Public addresses (t1…, t3…) and amounts, visible to anyone, as on Bitcoin. Transparent value sits in the transparent pool."
    },
    {
      "term": "shielded pool",
      "definition": "Where shielded value lives, with amounts, addresses and memos encrypted on-chain. Zcash has four: Sprout (2016-10-28), Sapling (2018-10-29), Orchard (2022-05-31) and Ironwood (2026-07-28). Sprout has been closed to new value since Canopy (ZIP 211) and Orchard since NU6.3, so new shielded value enters Sapling or Ironwood."
    }
  ],
  "asOf": 1791115200
}`,
      notes: [
        "With `topic`, the answer carries that topic's `entries`: each fact with its `source`, `href` and `verifiedOn`.",
        "A fact marked `inFlight` describes a process still running, such as NU7's deployment: it was true on `verifiedOn` and may not be now. `readDaysAgo` says how long ago that was, computed when you ask.",
      ],
    },
  ],
};
