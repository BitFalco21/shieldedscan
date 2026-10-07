import { describe, expect, it } from "vitest";
import type { CrossChainTransfer } from "@/domain";
import { venueName, venueTransferUrl } from "../venue-links";

const base: CrossChainTransfer = {
  id: "near-intents-fBhQxAEGhdMZoBaiixtnDRC9a8NNXj4Lvm8V3PbNXE5",
  direction: "in",
  protocol: "near-intents",
  counterpartChain: "SOL",
  counterpartAsset: "SOL",
  counterpartAmount: 5.037,
  counterpartIsSynthetic: false,
  counterpartTxHash: null,
  counterpartAddress: "3dcVdS1nmH8YR",
  zcashTxid: null,
  zcashAddress: null,
  zecAmountZat: 100_000_000,
  usdValueAtSwap: null,
  counterpartUsdAtSwap: null,
  venueDepositAddress: null,
  status: "completed",
  timestamp: 1_785_026_662,
};

/**
 * The far leg of a swap is the one figure on this site that cannot be checked against the
 * Zcash chain, so it links to the venue's own record, which makes a broken link worse than
 * none.
 *
 * NEAR Intents' explorer keys a transfer by its deposit address, not by the intent hash or
 * the deposit transaction hash. A unit test cannot check a third party's contract; it pins
 * the shape and the refusals, and the `@external` e2e spec loads the venue and reads the
 * rendered page.
 */
describe("venueTransferUrl", () => {
  it("links by the venue's deposit address, whichever way the swap ran", () => {
    // Direction is irrelevant: the venue has one record per swap, indexed by where funds
    // were deposited.
    const depositAddress = "0x42683Ac0d68cD836243984039c8caBb53Ab9AA26";
    const expected = `https://explorer.near-intents.org/transactions/${depositAddress}`;

    expect(
      venueTransferUrl({ ...base, direction: "in", venueDepositAddress: depositAddress }),
    ).toBe(expected);
    expect(
      venueTransferUrl({ ...base, direction: "out", venueDepositAddress: depositAddress }),
    ).toBe(expected);
  });

  it("carries a NEAR implicit account through unchanged", () => {
    // 64 hex with no `0x` prefix. It looks like a transaction hash and is not one; a
    // "normalise the hash" helper applied here would corrupt a working key.
    const implicitAccount = "8a93db70e11834b9a1cba65664f5ff9e8e98ffb6c39099b8345d492dd7d43b67";
    expect(venueTransferUrl({ ...base, venueDepositAddress: implicitAccount })).toBe(
      `https://explorer.near-intents.org/transactions/${implicitAccount}`,
    );
  });

  it("refuses to link when the venue published no deposit address", () => {
    // Older rows carry no deposit address. No link beats a dead one.
    expect(venueTransferUrl({ ...base, venueDepositAddress: null })).toBeNull();
    expect(venueTransferUrl({ ...base, venueDepositAddress: "" })).toBeNull();
  });

  it("survives a row from an API that has not shipped the field yet", () => {
    // Mid-deploy the key is absent rather than null. The type says that cannot happen; the
    // wire disagrees, and `undefined.length` would throw on a page the reader is looking at.
    const stale: Record<string, unknown> = { ...base };
    delete stale.venueDepositAddress;
    expect(venueTransferUrl(stale as unknown as CrossChainTransfer)).toBeNull();
  });

  it("never emits the 32-byte-hash key that 404'd in production", () => {
    // Same route, same venue: one key resolves and the other does not.
    //
    //   dead:    /transactions/0x28ef4800…ac1a87b   0x + 64 hex = 32-byte transaction hash
    //   working: /transactions/0x9D535aC8…9f63287   0x + 40 hex = 20-byte deposit address
    //
    // The builder does not validate the key's shape, and should not: it passes through
    // whatever the venue published, and a bare 64-hex string with no `0x` is a legitimate
    // NEAR implicit account. What is checkable is that the dead key cannot be derived: a row
    // carrying transaction hashes and no deposit address must produce no link.
    const deadKey = "0x28ef4800c49d84bf108f77f3c6fcaa510d2f32efb8472709e0e1bd429ac1a87b";
    const workingKey = "0x9D535aC8be0a9D04F95f338a99f78F26f9f63287";

    expect(venueTransferUrl({ ...base, venueDepositAddress: workingKey })).toBe(
      `https://explorer.near-intents.org/transactions/${workingKey}`,
    );
    expect(
      venueTransferUrl({
        ...base,
        venueDepositAddress: null,
        counterpartTxHash: deadKey,
        zcashTxid: deadKey.slice(2),
      }),
      "a row with only transaction hashes must produce no link at all",
    ).toBeNull();
  });

  it("never falls back to a transaction hash", () => {
    // A row rich in hashes but with no deposit address must produce nothing at all, not a
    // confidently broken link.
    expect(
      venueTransferUrl({
        ...base,
        venueDepositAddress: null,
        zcashTxid: "4fde4d94cfa822970aeeae0b61b8c0a67420dcf98eb4463d7409df676c77fdd7",
        counterpartTxHash: "0x877e3ae81750a1cf3bc43b34e524f9e34da1831af05c612e3735f5819eb267d5",
      }),
    ).toBeNull();
  });

  it("links a THORChain transfer by its inbound txid, as Maya's is", () => {
    const txid = "d35549ca7cb5fa7974bb1c07ba4206c9f808ec43b9aad6db896b6d3bcb168a7c";
    expect(venueTransferUrl({ ...base, protocol: "thorchain", id: `thorchain-${txid}` })).toBe(
      `https://thorchain.net/tx/${txid}`,
    );
    // An id that is not the venue-prefixed form keys nothing — no link, never a guessed one.
    expect(venueTransferUrl({ ...base, protocol: "thorchain", id: "thor-1" })).toBeNull();
  });

  it("names the venues it can link", () => {
    expect(venueName(base)).toBe("NEAR Intents explorer");
    expect(venueName({ ...base, protocol: "maya" })).toBe("MayaScan");
    expect(venueName({ ...base, protocol: "thorchain" })).toBe("THORChain Explorer");
  });
});

/**
 * Maya, keyed on the transfer id rather than a deposit address.
 *
 * Maya deposits into a shared vault, so there is no per-transfer address; a Midgard explorer
 * indexes by the swap's inbound txID, which `midgard.ts` already stores as the id.
 *
 * mayascan is a client-rendered app that answers HTTP 200 for a real hash and a fabricated
 * one alike, so the link was checked against rendered pages, never status codes.
 */
describe("venueTransferUrl — Maya", () => {
  const maya = (over: Partial<CrossChainTransfer> = {}): CrossChainTransfer => ({
    ...base,
    protocol: "maya",
    id: "maya-be6edbc1bd972e91775f0c5a3b07ea0975774ca37e5ee232f10ad6150700e2fd",
    venueDepositAddress: null,
    ...over,
  });

  it("links by the inbound txID the id already carries, in both directions", () => {
    const hash = "be6edbc1bd972e91775f0c5a3b07ea0975774ca37e5ee232f10ad6150700e2fd";
    const expected = `https://www.mayascan.org/tx/${hash}`;
    expect(venueTransferUrl(maya({ direction: "in" }))).toBe(expected);
    expect(venueTransferUrl(maya({ direction: "out" }))).toBe(expected);
  });

  it("needs no deposit address, which Maya never publishes", () => {
    // `venueDepositAddress` is always null for Maya: the vault is shared.
    expect(venueTransferUrl(maya({ venueDepositAddress: null }))).not.toBeNull();
  });

  it("refuses an id that is not the venue-prefixed form", () => {
    // A dead external link is worse than none on a page whose whole claim is checkability.
    expect(venueTransferUrl(maya({ id: "maya-" }))).toBeNull();
    expect(venueTransferUrl(maya({ id: "something-else" }))).toBeNull();
  });

  it("does not strip the prefix from a DIFFERENT venue's id", () => {
    // `near-intents-maya-…` is not a Maya row, and the protocol is what decides.
    expect(venueTransferUrl({ ...base, id: "maya-abc", protocol: "near-intents" })).toBeNull();
  });
});
