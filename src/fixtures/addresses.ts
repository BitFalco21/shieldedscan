import type { AddressInfo } from "@/domain";
import {
  ADDR_ALICE,
  ADDR_BOB,
  ADDR_FS_BOOTSTRAP,
  ADDR_FS_FOUNDATION,
  ADDR_FS_GRANTS,
  ADDR_MINER,
  ADDR_MINER_B,
  ADDR_MINER_C,
  ADDR_SAPLING,
  ADDR_VAULT,
  hex64,
} from "./ids";
import { transactions } from "./transactions";

/**
 * The pages for coinbase payees — the three pools and the three funding streams — are
 * derived from the coinbases that actually paid them rather than restated by hand, so a
 * miner's page can never disagree with the blocks the list page credits to it.
 *
 * Coinbase output only, and nothing spent: these fixture addresses exist to be the far end
 * of the blocks list's MINER column.
 */
function coinbasePayee(address: string): AddressInfo {
  const paid = transactions.filter(
    (tx) => tx.isCoinbase && tx.transparentOutputs.some((o) => o.address === address),
  );
  const receivedZat = paid.reduce(
    (total, tx) =>
      total +
      tx.transparentOutputs.reduce((sum, o) => (o.address === address ? sum + o.valueZat : sum), 0),
    0,
  );
  return {
    kind: "transparent",
    address,
    balanceZat: receivedZat,
    totalReceivedZat: receivedZat,
    totalSentZat: 0,
    txids: paid.map((tx) => tx.txid),
  };
}

export const addresses: AddressInfo[] = [
  {
    kind: "transparent",
    address: ADDR_ALICE,
    balanceZat: 4_120_090_000,
    totalReceivedZat: 9_800_000_000,
    totalSentZat: 5_679_910_000,
    txids: [hex64("77d10b12"), hex64("e09a44f7c21b88e0d3a6")],
  },
  {
    kind: "transparent",
    address: ADDR_BOB,
    balanceZat: 5_610_210_000,
    totalReceivedZat: 5_610_210_000,
    totalSentZat: 0,
    txids: [hex64("77d10b12"), hex64("c4de5512"), hex64("aa01")],
  },
  ...[
    ADDR_MINER,
    ADDR_MINER_B,
    ADDR_MINER_C,
    ADDR_FS_FOUNDATION,
    ADDR_FS_BOOTSTRAP,
    ADDR_FS_GRANTS,
  ].map(coinbasePayee),
  {
    kind: "transparent",
    address: ADDR_VAULT,
    balanceZat: 6_500_000_000,
    totalReceivedZat: 12_000_000_000,
    totalSentZat: 5_500_000_000,
    txids: [hex64("aa07"), hex64("aa01")],
  },
  { kind: "sapling", address: ADDR_SAPLING },
];
