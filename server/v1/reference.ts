import { Hono } from "hono";
import {
  REFERENCE_TOPIC_NAMES,
  REFERENCE_TOPICS,
  type ReferenceTopic,
  type ReferenceTopicName,
} from "../agent/reference";
import { DAY_MS } from "@/domain/time";
import { MAINNET_SITE_URL as SITE } from "@/lib/network";
import { coreRouteErrors, rejectUnknownParams, setCache } from "./http";
import { ParamError } from "./params";

/**
 * `/v1/reference`: what is true about Zcash, for an assistant whose training predates it (for
 * example the Ironwood pool, activated 2026-07-28). Two halves:
 *
 *  - the reference set the site's agent answers from (`server/agent/reference.ts`): facts
 *    transcribed from primary sources, each with its source and the day it was read; a fact about
 *    a process still running is marked in flight and carries how many days ago it was read,
 *    computed per request;
 *  - a glossary of this API's own vocabulary, so `kind`, `direction`, `valueBalanceZat` and
 *    `notes.atClose` are read the way they are meant.
 *
 * Committed text with no read at all, so it is served from memory and cached like the descriptor.
 */

export const GLOSSARY: readonly { term: string; definition: string }[] = [
  {
    term: "zatoshi",
    definition:
      "The smallest unit: 1 ZEC = 100,000,000 zatoshis. Every amount field ending in `Zat` is an integer number of them.",
  },
  {
    term: "transparent",
    definition:
      "Public addresses (t1…, t3…) and amounts, visible to anyone, as on Bitcoin. Transparent value sits in the transparent pool.",
  },
  {
    term: "shielded pool",
    definition:
      "Where shielded value lives, with amounts, addresses and memos encrypted on-chain. Zcash has four: Sprout (2016-10-28), Sapling (2018-10-29), Orchard (2022-05-31) and Ironwood (2026-07-28). Sprout has been closed to new value since Canopy (ZIP 211) and Orchard since NU6.3, so new shielded value enters Sapling or Ironwood.",
  },
  {
    term: "Ironwood",
    definition:
      "The fourth shielded pool, active since NU6.3 at block 3,428,143 on 2026-07-28. It uses the Orchard protocol: a payment to an Orchard-protocol receiver now lands in Ironwood, and Orchard value moves into it by pool migration.",
  },
  {
    term: "kind",
    definition:
      "What a transaction touched. `transparent`: no shielded pool. `shielded` (fully shielded): a shielded pool and no transparent input or output. `mixed`: a shielded pool and at least one transparent input or output. `coinbase`: a block's first transaction.",
  },
  {
    term: "direction",
    definition:
      "What a transaction did at the shielded boundary: `shielding` (transparent value entered a pool), `unshielding` (shielded value left to a transparent address), `shielded` (it stayed inside). Null for transparent and coinbase transactions, and for a mixed one whose pools moved in opposite directions, where naming one direction would be a guess.",
  },
  {
    term: "pool migration",
    definition:
      "A shielded transaction moving value from one pool to another, such as Orchard into Ironwood. Its amount is the destination pool's own published value balance, so naming it reveals nothing about the parties.",
  },
  {
    term: "value balance",
    definition:
      "A pool's `valueBalanceZat` on a transaction: what that pool gained, negative when value left it (the node's RPC uses the opposite sign). Public by design — it keeps every pool's total auditable while individual amounts stay encrypted.",
  },
  {
    term: "note",
    definition:
      "A shielded output, encrypted to its recipient. Each Sapling output, and each Orchard or Ironwood action, creates one.",
  },
  {
    term: "anonymity set",
    definition:
      "The notes a shielded spend could be spending. A spend proves its note is in the pool's note commitment tree without revealing which one, so the set is every note ever created in that pool — the tree size `/v1/analytics/pool-usage` reports as `notes.atClose`.",
  },
  {
    term: "nullifier",
    definition:
      "A value published when a note is spent, which stops it being spent twice without revealing which note it was.",
  },
  {
    term: "viewing key",
    definition:
      "A key that reveals a wallet's shielded transactions. Never paste one into a website; this explorer has no viewing-key feature, by design.",
  },
  {
    term: "unified address",
    definition:
      "An address (u1…) bundling receivers for several pools: Orchard-protocol, Sapling and transparent. The receivers are public; which one a payment used is not.",
  },
  {
    term: "coinbase",
    definition:
      "A block's first transaction, paying out the block subsidy and the block's fees. Since ZIP 213 a coinbase may pay into a shielded pool.",
  },
  {
    term: "block subsidy",
    definition:
      "New ZEC issued per block, halving on a fixed schedule; the next halving is at block 4,406,400. Since NU6.1 it is split 80% to the miner, 8% to a funding stream and 12% to the lockbox (ZIP 214, ZIP 271). `/v1/network/halving` reads the split in force from the node.",
  },
  {
    term: "lockbox",
    definition:
      "The value pool holding the deferred 12% of each block subsidy since NU6: mined but not circulating. No transaction spends from it; ZIP 271 released 78,750 ZEC from it once, at NU6.1, by consensus rule.",
  },
  {
    term: "conventional fee",
    definition:
      "ZIP 317: 5,000 zatoshis per logical action, with a minimum of two actions. `/v1/network/fees` gives the formula.",
  },
  {
    term: "unknowns",
    definition:
      "Beside a null, the reason it is null: `shielded` (encrypted on-chain, by design), `unmeasured` (no measurement right now), `omitted` (not in this view), `nonexistent` (did not exist), `indeterminate` (answering would need a guess). A null is never zero.",
  },
];

export const REFERENCE_TOPIC_LIST = ["glossary", ...REFERENCE_TOPIC_NAMES] as const;

/**
 * What each topic covers, in one public sentence. Not the topic's `note`, which is written to
 * the agent and names its own tools (`chain_status`, `zip_index`) that an MCP client does not
 * have. A `Record` so a new topic fails to compile until it is described here.
 */
const TOPIC_ABOUT: Readonly<Record<ReferenceTopicName, string>> = {
  ceremonies: "Zcash's trusted-setup ceremonies: who took part, and which pools needed one.",
  cryptography: "The proving system behind each shielded pool, and what changed between them.",
  history:
    "Dated past events: launch, the pool activations, the network upgrades and the 2018 counterfeiting vulnerability, with its fix.",
  addresses: "Zcash address types, and what an address does and does not reveal.",
  privacy: "The encrypted memo field, and what a viewing key exposes.",
  consensus:
    "How proof of work, the block target and network upgrades are defined: Equihash and its parameters, Blossom's 75-second blocks, activation by height.",
  economics:
    "How the block subsidy has been split between the miner, the funding streams and the lockbox, era by era.",
  governance: "How Zcash changes: the ZIP process and the organisations named in it.",
  roadmap:
    "What Zcash is proposing rather than running: NU7, the coinholder vote on its scope, the issuance proposals and Project Tachyon.",
};

const IN_FLIGHT_RULE =
  "An entry with inFlight: true describes a process still running: it was true on verifiedOn and may not be now, so state it with that day (readDaysAgo says how long ago that was).";

export function v1ReferenceRoutes(now: () => number = Date.now): Hono {
  const app = new Hono();
  app.onError(coreRouteErrors);
  app.get("/v1/reference", (c) => {
    rejectUnknownParams(c, ["topic"]);
    const topic = c.req.query("topic")?.trim().toLowerCase();
    setCache(c, "descriptor");
    const asOf = Math.floor(now() / 1000);
    if (topic === undefined || topic === "") {
      return c.json({
        topics: [
          { name: "glossary", entries: GLOSSARY.length, about: "This API's own vocabulary." },
          ...REFERENCE_TOPIC_NAMES.map((name) => ({
            name,
            entries: REFERENCE_TOPICS[name].entries.length,
            about: TOPIC_ABOUT[name],
          })),
        ],
        glossary: GLOSSARY,
        asOf,
      });
    }
    if (topic === "glossary") return c.json({ topic, entries: GLOSSARY, asOf });
    if (!(REFERENCE_TOPIC_NAMES as readonly string[]).includes(topic)) {
      throw new ParamError("invalid_parameter", `topic: ${REFERENCE_TOPIC_LIST.join(" | ")}`);
    }
    const name = topic as ReferenceTopicName;
    const t: ReferenceTopic = REFERENCE_TOPICS[name];
    const anyInFlight = t.entries.some((e) => e.inFlight === true);
    return c.json({
      topic,
      about: TOPIC_ABOUT[name],
      ...(anyInFlight ? { inFlightRule: IN_FLIGHT_RULE } : {}),
      basis:
        "committed in this explorer's source, each fact transcribed from the primary source named beside it on the day given; not measured from the chain",
      entries: t.entries.map((e) => {
        const read = Date.parse(`${e.verifiedOn}T00:00:00Z`);
        const days = Number.isNaN(read) ? null : Math.max(0, Math.floor((now() - read) / DAY_MS));
        return {
          id: e.id,
          fact: e.fact,
          source: e.source,
          // The agent's links are relative to this site; a public answer needs them absolute.
          href: e.href === undefined ? null : e.href.startsWith("/") ? `${SITE}${e.href}` : e.href,
          verifiedOn: e.verifiedOn,
          // A process still running: true when read, perhaps not now — state it with its day.
          inFlight: e.inFlight === true,
          readDaysAgo: e.inFlight === true ? days : null,
        };
      }),
      asOf,
    });
  });
  return app;
}
