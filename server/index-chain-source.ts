import {
  classifySearchQuery,
  classifyZcashAddress,
  type AddressInfo,
  type Block,
  type BlockSummary,
  type MempoolEntry,
  type MempoolStats,
  type PoolName,
  type ShieldedPool,
  type SupplyBreakdown,
  type Transaction,
  type TransparentAddress,
  type TxKindFilter,
  type UpgradeNetwork,
  type ValuePoolName,
} from "@/domain";
import { unspendablePools } from "@/domain/consensus";
import { POOL_NAMES, VALUE_POOL_NAMES } from "@/domain/pool";
import type { CursorPage, CursorQuery, Paginated } from "@/data/source";
import type { ChainIndexStore } from "./chain-index-store";
import { WINDOW_IO_ROWS } from "./address-extremes";
import { ADDRESS_TXIDS_CAP } from "./chain-source";
import { NodeRpcError, type RpcBlockSubsidy } from "./node-rpc";
import { clampPageSize } from "./page-size";

/**
 * The chain source of an API with a database and no node: a self-hosted copy of the open dataset.
 *
 * Every figure here is one the node reported when the block was stored, read back from the index
 * at the newest stored block, so the site and `/v1` state the chain as of that block, as they
 * would with a node that stopped there. What only a node can say (block headers, the mempool, the
 * subsidy schedule) rejects with `NoNodeError`: an outage, never "not found", because the index
 * cannot prove that something it does not hold does not exist. A block, transaction or address
 * the index does not hold is therefore an outage too, except where the index itself proves the
 * absence: a string that is no id at all, or an id the index holds as the other kind.
 */

/** The answer for a read that needs a node, on an API that has none. */
export class NoNodeError extends NodeRpcError {
  constructor(method: string) {
    super(method, "no node is configured");
    this.name = "NoNodeError";
  }
}

/** What the source reads from the index. `ChainIndexStore` in production. */
export type IndexChainReader = Pick<
  ChainIndexStore,
  | "tipHeight"
  | "blockAt"
  | "listChainTransactions"
  | "blockSummaries"
  | "blockHeightByHash"
  | "txBlocks"
  | "addressBalance"
  | "addressIoTotals"
  | "addressTxids"
>;

/**
 * The pools the node stated at a block, in one fixed order. NULL is a pool the node did not monitor
 * there (before its activation): omitted, never zero.
 */
function stated(
  pools: Readonly<Record<ValuePoolName, number | null>>,
): { pool: ValuePoolName; balanceZat: number }[] {
  return VALUE_POOL_NAMES.flatMap((pool) => {
    const zat = pools[pool];
    return zat === null ? [] : [{ pool, balanceZat: zat }];
  });
}

export class IndexChainSource {
  constructor(
    private readonly index: IndexChainReader,
    /** Which pools count as circulating depends on the network, as in `NodeChainSource`. */
    private readonly network: UpgradeNetwork = "mainnet",
  ) {}

  /** The newest stored block's pools; an empty index is an outage, not a chain at height 0. */
  async #tipBlock() {
    const height = await this.index.tipHeight();
    const block = height === null ? undefined : await this.index.blockAt(height);
    if (block === undefined) throw new NoNodeError("getblockchaininfo");
    return block.pools;
  }

  async getTipHeight(): Promise<number> {
    return (await this.#tipBlock()).height;
  }

  async getTip(): Promise<{ height: number; hash: string }> {
    const tip = await this.#tipBlock();
    return { height: tip.height, hash: tip.hash };
  }

  /** As `NodeChainSource.getChainFacts`: circulating excludes the pools nothing can spend from. */
  async getChainFacts(): Promise<{
    height: number;
    bestBlockHash: string;
    lastBlockTimestamp: number;
    circulatingSupplyZat: number;
  }> {
    const tip = await this.#tipBlock();
    const unspendable = unspendablePools(this.network, tip.height);
    let circulating = 0;
    for (const { pool, balanceZat } of stated(tip.pools)) {
      if (!unspendable.includes(pool)) circulating += balanceZat;
    }
    return {
      height: tip.height,
      bestBlockHash: tip.hash,
      lastBlockTimestamp: tip.timestamp,
      circulatingSupplyZat: circulating,
    };
  }

  async getPools(): Promise<ShieldedPool[]> {
    const tip = await this.#tipBlock();
    const shielded: readonly ValuePoolName[] = POOL_NAMES;
    return stated(tip.pools).flatMap(({ pool, balanceZat }) =>
      shielded.includes(pool) ? [{ pool: pool as PoolName, balanceZat }] : [],
    );
  }

  /** `nsmZat` is not stored by the follower, so it is unknown here. */
  async getSupplyBreakdown(): Promise<SupplyBreakdown> {
    const tip = await this.#tipBlock();
    return { height: tip.height, pools: stated(tip.pools), nsmZat: null };
  }

  /** The dataset starts at genesis. */
  getOldestHeight(): Promise<number> {
    return Promise.resolve(0);
  }

  async listLatestTransactions(count: number): Promise<Transaction[]> {
    return (await this.index.listChainTransactions("all", { limit: clampPageSize(count) })).items;
  }

  listTransactions(
    query: CursorQuery,
    kind: TxKindFilter = "all",
  ): Promise<CursorPage<Transaction>> {
    return this.index.listChainTransactions(kind, query);
  }

  /**
   * A stored block as its list row: everything the node reported for it but the header fields
   * and the txid list, which the index does not store (`hasBlockHeader`). A height above the
   * newest stored block, or a hash the index holds as neither a block nor a transaction, may be a
   * block after it, so either is an outage.
   */
  async getBlock(idOrHeight: string): Promise<BlockSummary | undefined> {
    const id = classifySearchQuery(idOrHeight);
    let height: number | null;
    if (id.type === "height") {
      height = id.height;
    } else if (id.type === "hash64") {
      const hash = id.hash.toLowerCase();
      height = await this.index.blockHeightByHash(hash);
      // A transaction's id: a block hash equal to it would be a SHA-256d collision.
      if (height === null && (await this.index.txBlocks([hash])).has(hash)) return undefined;
    } else {
      // As the node: anything but a height or a hash names no block.
      return undefined;
    }
    const tip = await this.index.tipHeight();
    if (height === null || tip === null || height > tip) throw new NoNodeError("getblock");
    // Null when the stored rows cannot state the block exactly; never a partly filled row.
    const [row] = (await this.index.blockSummaries(height, height)) ?? [];
    if (row === undefined) throw new NoNodeError("getblock");
    return row;
  }

  // The block list pages from the index (`block-list.ts`); this is only its node top-up.
  blocksDescending(_top: number, _count: number): Promise<Block[]> {
    return Promise.reject(new NoNodeError("getblock"));
  }

  // The routes page a block's transactions from the index; this is the no-index fallback.
  getBlockTransactions(_height: number): Promise<Transaction[]> {
    return Promise.reject(new NoNodeError("getblock"));
  }

  /**
   * Callers ask the index first; reaching here means the index does not hold it. Not a
   * transaction: anything but a 64-hex id, and a stored block's hash (see `getBlock`).
   */
  async getTransaction(txid: string): Promise<Transaction | undefined> {
    const id = classifySearchQuery(txid);
    if (id.type !== "hash64") return undefined;
    if ((await this.index.blockHeightByHash(id.hash.toLowerCase())) !== null) return undefined;
    throw new NoNodeError("getrawtransaction");
  }

  /**
   * Balance, received and sent as of the newest stored block, which must be the height the stored
   * balances cover. A funded address is its `chain_address_balance` row. One the table does not
   * hold but that has rows up to the tip was emptied: balance zero, received and sent summed from
   * its rows, unless it has more rows than one read may walk. An address with no rows may have
   * been paid after the tip, so it is an outage, never "no such address".
   */
  async getAddressBalance(address: string): Promise<Omit<TransparentAddress, "txids"> | undefined> {
    // As the node: a string that is no transparent address has no balance.
    if (classifyZcashAddress(address) !== "transparent") return undefined;
    const [tip, stored] = await Promise.all([
      this.index.tipHeight(),
      this.index.addressBalance(address),
    ]);
    if (tip === null || stored.computedHeight !== tip) {
      throw new NoNodeError("getaddressbalance");
    }
    if (stored.held) {
      const { balanceZat, receivedZat } = stored.held;
      const sentZat = receivedZat - balanceZat;
      return {
        kind: "transparent",
        address,
        balanceZat,
        totalReceivedZat: receivedZat,
        totalSentZat: sentZat,
      };
    }
    const io = await this.index.addressIoTotals(address, tip, WINDOW_IO_ROWS);
    if (io.rows === 0 || io.rows > WINDOW_IO_ROWS) throw new NoNodeError("getaddressbalance");
    // Absent from the balances means spent to zero; rows that say otherwise are a broken index.
    if (io.receivedZat !== io.sentZat) {
      throw new Error(
        `index disagrees on ${address}: no balance row, rows net ${io.receivedZat - io.sentZat}`,
      );
    }
    return {
      kind: "transparent",
      address,
      balanceZat: 0,
      totalReceivedZat: io.receivedZat,
      totalSentZat: io.sentZat,
    };
  }

  /** `getAddressBalance` with the newest txids, capped as `NodeChainSource.getAddress` caps them. */
  async getAddress(address: string): Promise<AddressInfo | undefined> {
    const balance = await this.getAddressBalance(address);
    if (balance === undefined) return undefined;
    return { ...balance, txids: await this.index.addressTxids(address, ADDRESS_TXIDS_CAP) };
  }

  getMempoolStats(): Promise<MempoolStats> {
    return Promise.reject(new NoNodeError("getrawmempool"));
  }

  listMempool(_page: number, _pageSize: number): Promise<Paginated<MempoolEntry>> {
    return Promise.reject(new NoNodeError("getrawmempool"));
  }

  getBlockSubsidy(_height: number): Promise<RpcBlockSubsidy> {
    return Promise.reject(new NoNodeError("getblocksubsidy"));
  }
}
