import type { RpcBlock } from "../rpc-types";
import template from "./block-3426987.json";

/**
 * Mainnet block 3,146,400, the NU6.1 activation block, as the node returns it where it matters:
 * its hash, parent, time, and a coinbase-only block whose twelve outputs are the chain's own, in
 * their on-chain order: the miner's 1.25 ZEC, the FPF's 0.125 and ZIP 271's ten 7,875 ZEC chunks
 * to the key-holders' multisig. The remaining header and script fields come from a captured
 * block (3,426,987); nothing read from them differs between the two.
 */
export const NU61_MINER = "t1at7nVNsv6taLRrNRvnQdtfLNRDfsGc3Ak";
export const NU61_MULTISIG = "t3ev37Q2uL1sfTsiJQJiWJoFzQpDhmnUwYo";
export const NU61_HASH = "0000000000b98a7d8f390793fa113bf6755935f0c14ea817af07d2c16f2c3ef4";
export const NU61_FIRST_TXID = "525f440283b4c9ec30fa04a5796f3ddfa4ba1e1e48657a8d6f32313f36cf1381";

const captured = template as unknown as RpcBlock;
const coinbase = captured.tx[0]!;

const out = (n: number, valueZat: number, address: string, type: string) => ({
  ...coinbase.vout[0]!,
  n,
  value: valueZat / 1e8,
  valueZat,
  scriptPubKey: { ...coinbase.vout[0]!.scriptPubKey, type, addresses: [address] },
});

export const nu61Block: RpcBlock = {
  ...captured,
  height: 3_146_400,
  hash: NU61_HASH,
  previousblockhash: "0000000000124d0df882b6a3a7c7545960e4bf52fe6c15f16d1ea157f073ea45",
  time: 1_764_014_202,
  tx: [
    {
      ...coinbase,
      txid: NU61_FIRST_TXID,
      // The BIP-34 height push (3,146,400, little-endian) and nothing printable, as on chain.
      vin: [{ coinbase: "03a0023000", sequence: 4294967295 }],
      vout: [
        out(0, 125_000_000, NU61_MINER, "pubkeyhash"),
        out(1, 12_500_000, "t3cFfPt1Bcvgez9ZbMBFWeZsskxTkPzGCow", "scripthash"),
        ...Array.from({ length: 10 }, (_, i) =>
          out(2 + i, 787_500_000_000, NU61_MULTISIG, "scripthash"),
        ),
      ],
    },
  ],
};
