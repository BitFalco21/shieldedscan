import type { ZnsLookup, ZnsNameEvent, ZnsRegistration } from "@/domain";
import { parseZnsName } from "@/domain";
import { hex64, TIP_HEIGHT, TIP_TIME } from "./ids";

/**
 * Names from the real mainnet beta registry, on their real unified addresses so the address page
 * decodes their receivers. The evidence txids and heights are fixture transactions instead, so
 * every block and transaction link on the name page resolves on a fixture build rather than
 * 404ing in the link sweep.
 *
 * Each covers a state that would otherwise render nowhere before production:
 * - `zenith` — a plain claim.
 * - `abraham` — listed for sale, with an UPDATE as its last action, so the marketplace caution and
 *   a verb other than "claimed" both render. (On mainnet it is a plain CLAIM.)
 * - `kazecstan` — released: a history and no registration.
 * - `stalename` — a registry too far behind our chain to trust, the "unavailable" state.
 */
const ZENITH =
  "u175lny2wwmwzkhh83ef8weypdyfeacdq4up9pprqxsrsupcm8ag5fj3vtjakv32k6qus7fay4myqn3cvnlaa4hkdhnfgzdhmyyphma74kdz82ysqgm9urexdckg48x95q793xyy87h3833mpau9rtrl28w085lpvufglnvr6fus3eufeg";
const ABRAHAM_NOW =
  "u1gex2wm56xgveqx2hvxylwtla6nz03scyrpvyvhfccnvuv3kaetlnxe6x4d7ljf7cwqq7etj7m4p33064rsxft7se26yzgrs540trahn6ldp9cxe2d27wa98hml6a3mmn7ephyqagy8grr8z06ufqnnzy3c6e37kefazuf4k3nvchfh08";

/** A fixture block's timestamp — the formula `blocks.ts` dates the fixture chain with. */
const ts = (height: number): number => TIP_TIME - (TIP_HEIGHT - height) * 75;

const REGISTRATIONS: readonly ZnsRegistration[] = [
  {
    name: "zenith",
    address: ZENITH,
    txid: hex64("a3f29c4e"),
    height: TIP_HEIGHT,
    timestamp: ts(TIP_HEIGHT),
    lastAction: "CLAIM",
    listingPriceZat: null,
  },
  {
    name: "abraham",
    address: ABRAHAM_NOW,
    txid: hex64("22d8e411"),
    height: TIP_HEIGHT - 1,
    timestamp: ts(TIP_HEIGHT - 1),
    lastAction: "UPDATE",
    listingPriceZat: 250_000_000,
  },
];

/** Newest first, as the API sends them. */
const HISTORY: Readonly<Record<string, readonly ZnsNameEvent[]>> = {
  zenith: [
    {
      action: "CLAIM",
      txid: hex64("a3f29c4e"),
      height: TIP_HEIGHT,
      timestamp: ts(TIP_HEIGHT),
      address: ZENITH,
      priceZat: null,
    },
  ],
  abraham: [
    {
      action: "LIST",
      txid: hex64("77d10b12"),
      height: TIP_HEIGHT,
      timestamp: ts(TIP_HEIGHT),
      address: null,
      priceZat: 250_000_000,
    },
    {
      action: "UPDATE",
      txid: hex64("22d8e411"),
      height: TIP_HEIGHT - 1,
      timestamp: ts(TIP_HEIGHT - 1),
      address: ABRAHAM_NOW,
      priceZat: null,
    },
    {
      action: "CLAIM",
      txid: hex64("ea0a65f6"),
      height: TIP_HEIGHT - 2,
      timestamp: ts(TIP_HEIGHT - 2),
      address: ZENITH,
      priceZat: null,
    },
  ],
  kazecstan: [
    {
      action: "RELEASE",
      txid: hex64("750b0dc0"),
      height: TIP_HEIGHT - 3,
      timestamp: ts(TIP_HEIGHT - 3),
      address: null,
      priceZat: null,
    },
    {
      action: "CLAIM",
      txid: hex64("c4de5512"),
      height: TIP_HEIGHT - 5,
      timestamp: ts(TIP_HEIGHT - 5),
      address: ZENITH,
      priceZat: null,
    },
  ],
};

export const ZNS_FIXTURE_WITHHELD_NAME = "stalename";

export function getZnsName(raw: string): ZnsLookup {
  const name = parseZnsName(raw);
  if (name === null) throw new Error(`not a ZNS name: ${raw}`);
  const withheld = name === ZNS_FIXTURE_WITHHELD_NAME;
  return {
    query: name,
    registrations: withheld ? [] : REGISTRATIONS.filter((r) => r.name === name),
    history: withheld ? [] : [...(HISTORY[name] ?? [])],
    withheld,
    indexerHeight: withheld ? TIP_HEIGHT - 9_900 : TIP_HEIGHT,
    tipHeight: TIP_HEIGHT,
    asOf: TIP_TIME,
  };
}
