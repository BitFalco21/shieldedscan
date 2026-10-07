import { describe, expect, it } from "vitest";
import { DONATION_ADDRESS } from "@/lib/donation";
import { base58checkEncode } from "../encoding/base58check";
import { bech32Decode, bech32Encode, convertBits } from "../encoding/bech32";
import { f4jumble } from "../encoding/f4jumble";
import { decodeUnifiedAddress } from "../unified";
// Official vectors: github.com/zcash-hackworks/zcash-test-vectors,
// test-vectors/json/unified_address.json, fetched 2026-08-17. Rows 0–1 are headers;
// columns: p2pkh_bytes, p2sh_bytes, sapling_raw_addr, orchard_raw_addr,
// unknown_typecode, unknown_bytes, unified_addr, root_seed, account, div_index.
import vectors from "../__fixtures__/unified_address.json";

type Row = [
  string | null, // p2pkh_bytes (hex)
  string | null, // p2sh_bytes (hex)
  string | null, // sapling_raw_addr (hex)
  string | null, // orchard_raw_addr (hex)
  number | null, // unknown_typecode
  string | null, // unknown_bytes (hex)
  string, // unified_addr
  string,
  number,
  number,
];

const rows = (vectors as unknown as unknown[][]).slice(2) as Row[];

const toBytes = (h: string) =>
  Uint8Array.from({ length: h.length / 2 }, (_, i) => parseInt(h.slice(i * 2, i * 2 + 2), 16));

/** The standalone form our decoder should derive, built from the vector's own bytes. */
const expectedSapling = (raw: string) =>
  bech32Encode("zs", convertBits(toBytes(raw), 8, 5, true)!, "bech32");
const expectedP2pkh = (raw: string) =>
  base58checkEncode(Uint8Array.from([0x1c, 0xb8, ...toBytes(raw)]));
const expectedP2sh = (raw: string) =>
  base58checkEncode(Uint8Array.from([0x1c, 0xbd, ...toBytes(raw)]));

describe("decodeUnifiedAddress against every official ZIP 316 vector", () => {
  it("has the full vector set", () => {
    expect(rows.length).toBe(60);
  });

  it("decodes every vector to exactly the receivers the vector was built from", () => {
    for (const [p2pkh, p2sh, sapling, orchard, unknownTypecode, , address] of rows) {
      const decoded = decodeUnifiedAddress(address);
      expect(decoded, address).not.toBeNull();
      expect(decoded!.network).toBe("mainnet");

      const byKind = new Map(decoded!.receivers.map((r) => [r.kind, r]));
      expect(byKind.has("orchard")).toBe(orchard !== null);
      expect(byKind.has("sapling")).toBe(sapling !== null);
      expect(byKind.has("p2pkh")).toBe(p2pkh !== null);
      expect(byKind.has("p2sh")).toBe(p2sh !== null);
      expect(byKind.has("unknown")).toBe(unknownTypecode !== null);

      if (orchard) {
        const receiver = byKind.get("orchard");
        expect(receiver && "receiverHex" in receiver && receiver.receiverHex).toBe(orchard);
      }
      if (sapling) {
        const receiver = byKind.get("sapling");
        expect(receiver && "address" in receiver && receiver.address).toBe(
          expectedSapling(sapling),
        );
      }
      if (p2pkh) {
        const receiver = byKind.get("p2pkh");
        expect(receiver && "address" in receiver && receiver.address).toBe(expectedP2pkh(p2pkh));
      }
      if (p2sh) {
        const receiver = byKind.get("p2sh");
        expect(receiver && "address" in receiver && receiver.address).toBe(expectedP2sh(p2sh));
      }
      if (unknownTypecode !== null) {
        const receiver = byKind.get("unknown");
        expect(receiver && "typecode" in receiver && receiver.typecode).toBe(unknownTypecode);
      }
    }
  });

  it("decodes the site's own donation address — the real-world fixture", () => {
    const decoded = decodeUnifiedAddress(DONATION_ADDRESS);
    expect(decoded).not.toBeNull();
    expect(decoded!.network).toBe("mainnet");
    expect(decoded!.receivers.length).toBeGreaterThan(0);
    // A modern wallet-generated UA carries at least one shielded receiver by rule.
    expect(decoded!.receivers.some((r) => r.kind === "orchard" || r.kind === "sapling")).toBe(true);
  });
});

describe("decodeUnifiedAddress refuses every defect with null, never a partial answer", () => {
  const good = rows[0]![6];

  it("bad checksum", () => {
    const flipped = good.slice(0, -1) + (good.endsWith("a") ? "q" : "a");
    expect(decodeUnifiedAddress(flipped)).toBeNull();
  });

  it("wrong HRP variants and revision-2 HRPs", () => {
    expect(decodeUnifiedAddress("zs1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq")).toBeNull();
    // Re-encode a valid payload under zu/tu: structurally fine, out of scope → null.
    const decoded = bech32Decode(good)!;
    for (const hrp of ["zu", "tu", "uview"]) {
      expect(decodeUnifiedAddress(bech32Encode(hrp, decoded.data, "bech32m"))).toBeNull();
    }
  });

  it("bech32 (non-m) checksum on a unified HRP", () => {
    const decoded = bech32Decode(good)!;
    expect(decodeUnifiedAddress(bech32Encode("u", decoded.data, "bech32"))).toBeNull();
  });

  it("bad padding — the HRP tripwire", () => {
    // A mainnet payload re-encoded under the testnet HRP: checksum valid, padding
    // still says "u", so the padding check must refuse it.
    const decoded = bech32Decode(good)!;
    expect(decodeUnifiedAddress(bech32Encode("utest", decoded.data, "bech32m"))).toBeNull();
  });

  it("structural TLV defects, forged through the real pipeline", () => {
    const forge = (tlv: number[], hrp = "u") => {
      const padding = new Uint8Array(16);
      for (let i = 0; i < hrp.length; i++) padding[i] = hrp.charCodeAt(i);
      // Every caller builds a TLV that clears F4Jumble's 38-byte floor.
      const message = Uint8Array.from([...tlv, ...padding]);
      const jumbled = f4jumble(message)!;
      return bech32Encode(hrp, convertBits(jumbled, 8, 5, true)!, "bech32m");
    };
    const orchard = [0x03, 43, ...new Array(43).fill(9)];
    const sapling = [0x02, 43, ...new Array(43).fill(8)];
    const p2pkh = [0x00, 20, ...new Array(20).fill(7)];
    const p2sh = [0x01, 20, ...new Array(20).fill(6)];

    // A well-formed forge decodes — proving the forge harness itself works…
    expect(decodeUnifiedAddress(forge([...p2pkh, ...sapling, ...orchard]))).not.toBeNull();
    // …and each single defect flips it to null:
    expect(decodeUnifiedAddress(forge([...sapling, ...p2pkh, ...orchard]))).toBeNull(); // out of order
    expect(decodeUnifiedAddress(forge([...orchard, ...orchard]))).toBeNull(); // duplicate
    expect(decodeUnifiedAddress(forge([...p2pkh, ...p2sh, ...orchard]))).toBeNull(); // both transparent
    expect(decodeUnifiedAddress(forge([...p2pkh, ...p2sh.slice(0, 22)]))).toBeNull(); // no shielded
    expect(decodeUnifiedAddress(forge([...orchard, 0xe0, 4, 1, 2, 3, 4]))).toBeNull(); // MUST-understand
    expect(decodeUnifiedAddress(forge([0x03, 42, ...new Array(42).fill(9)]))).toBeNull(); // wrong length
    expect(decodeUnifiedAddress(forge([...orchard, 0x07]))).toBeNull(); // trailing bytes
  });

  it("garbage and empty input", () => {
    expect(decodeUnifiedAddress("")).toBeNull();
    expect(decodeUnifiedAddress("u1")).toBeNull();
    expect(decodeUnifiedAddress("not an address")).toBeNull();
  });
});
